"use client";

import { getAuthClient } from "@/lib/db";
import type { AuthSessionUser } from "@/lib/db/types";
import type { UserProfileClient } from "@/lib/user-profile-client";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { fetchUserProfileClient } from "@/lib/user-profile-client";
import {
  forceLogoutMissingShop,
  hasValidShopSlug,
  normalizeShopSlugClient,
  paymentAllowsAppAccess,
  postSessionCookieWithRetries,
} from "@/lib/client-auth";
import { PRESENCE_HEARTBEAT_MS } from "@/lib/presence-config";
import { isEffectiveTrialAccount, syncTrialUiSessionFlag } from "@/lib/trial-shop";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getDeviceId } from "@/lib/device-id";

// ---------------------------------------------------------------------------
// Profile cache — tránh gọi Supabase lại trên mỗi F5 / token refresh
// TTL 5 phút; backup vào sessionStorage để sống qua F5.
// ---------------------------------------------------------------------------
const PROFILE_CACHE_KEY = "ha_pcache";
const PROFILE_CACHE_TTL = 5 * 60 * 1000;

type ProfileCacheEntry = { uid: string; profile: UserProfileClient; cachedAt: number };
let _memProfileCache: ProfileCacheEntry | null = null;

function getProfileCache(uid: string): UserProfileClient | null {
  const check = (e: ProfileCacheEntry | null) =>
    e && e.uid === uid && Date.now() - e.cachedAt < PROFILE_CACHE_TTL ? e.profile : null;
  if (_memProfileCache) {
    const hit = check(_memProfileCache);
    if (hit) return hit;
  }
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProfileCacheEntry;
      const hit = check(parsed);
      if (hit) { _memProfileCache = parsed; return hit; }
    }
  } catch { /* ignore */ }
  return null;
}

function setProfileCache(uid: string, profile: UserProfileClient) {
  const entry: ProfileCacheEntry = { uid, profile, cachedAt: Date.now() };
  _memProfileCache = entry;
  try { sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(entry)); } catch { /* ignore */ }
}

function clearProfileCache() {
  _memProfileCache = null;
  try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
}

function toPaymentRequiredPath(shopSlug?: string) {
  const shop = String(shopSlug || "").trim();
  return shop ? `/payment-required?shop=${encodeURIComponent(shop)}` : "/payment-required";
}

type RequireAuthProps = {
  children?: ReactNode;
  /**
   * Route /[shop]: render với `shopSlug` từ hồ sơ người dùng — không dùng segment URL (tránh hiển thị slug rác
   * trong khi `/api/rtdb` vẫn map đúng kho).
   */
  renderShop?: (ctx: { shopSlug: string }) => ReactNode;
  /**
   * Khi có (route /[shop]), bắt buộc khớp với shopSlug trong hồ sơ — tránh mở POS tại /src, /12345…
   * vẫn dùng cookie/iframe của shop khác.
   */
  pathShopFromUrl?: string;
};

function redirectIfUrlShopMismatch(
  pathShopFromUrl: string | undefined,
  profileSlug: string,
  reg: boolean | null,
): boolean {
  if (pathShopFromUrl === undefined) return false;
  const seg = String(pathShopFromUrl).trim();
  if (!seg) return false;
  if (normalizeShopSlugClient(seg) === normalizeShopSlugClient(profileSlug)) return false;
  const trialQs = isEffectiveTrialAccount(reg, profileSlug) ? "?trial=1" : "";
  const target = `/${encodeURIComponent(profileSlug)}${trialQs}`;
  try {
    if (window.top && window.top !== window) {
      window.top.location.replace(target);
      return true;
    }
  } catch {
    // Ignore.
  }
  window.location.replace(target);
  return true;
}

export default function RequireAuth({ children, renderShop, pathShopFromUrl }: RequireAuthProps) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [resolvedShopSlug, setResolvedShopSlug] = useState<string | null>(null);
  const [sessionBridgeFailed, setSessionBridgeFailed] = useState(false);
  const [bridgeRetryNonce, setBridgeRetryNonce] = useState(0);
  const [newDeviceToast, setNewDeviceToast] = useState(false);
  const authedUidRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let forcingLogout = false;
    let unsub: (() => void) | undefined;
    let settled = false;
    let logoutDebounce: number | undefined;
    let processingUid = "";
    let redirecting = false;

    const redirectToLogin = () => {
      if (redirecting) return;
      redirecting = true;
      try {
        if (window.top && window.top !== window) {
          window.top.location.href = "/login";
          return;
        }
      } catch {
        // Ignore cross-frame redirect issues.
      }
      window.location.href = "/login";
    };

    const clearServerSession = async () => {
      try {
        await fetch("/api/auth/session", { method: "DELETE" });
      } catch {
        // Ignore.
      }
    };

    const syncIdTokenToCookie = async (shopSlug: string): Promise<boolean> => {
      try {
        const user = getAuthClient().getCurrentUser();
        if (!user) return false;
        const slug = String(shopSlug || "").trim();
        let token = await user.getIdToken();
        let ok = await postSessionCookieWithRetries(token, slug ? { shopSlug: slug } : undefined);
        if (!ok) {
          token = await user.getIdToken(true);
          ok = await postSessionCookieWithRetries(token, slug ? { shopSlug: slug } : undefined);
        }
        return ok;
      } catch {
        return false;
      }
    };

    const resolveProfileWithRetry = async (uid: string) => {
      // Dùng cache trước — tránh round-trip Supabase trên mỗi F5 / token refresh
      const cached = getProfileCache(uid);
      if (cached) return cached;
      const first = await fetchUserProfileClient(uid);
      if (hasValidShopSlug(first.shopSlug)) { setProfileCache(uid, first); return first; }
      await new Promise((r) => setTimeout(r, 450));
      const second = await fetchUserProfileClient(uid);
      if (hasValidShopSlug(second.shopSlug)) setProfileCache(uid, second);
      return second;
    };

    const processSignedInUser = async (user: AuthSessionUser) => {
      if (processingUid === user.uid) return;
      processingUid = user.uid;
      try {
        const profile = await resolveProfileWithRetry(user.uid);
        const shopSlug = String(profile.shopSlug || "");
        const reg = profile.registrationTrial;

        if (!hasValidShopSlug(shopSlug)) {
          if (forcingLogout) return;
          forcingLogout = true;
          await forceLogoutMissingShop();
          return;
        }

        syncTrialUiSessionFlag({ shopSlug, registrationTrial: reg });

        if (redirectIfUrlShopMismatch(pathShopFromUrl, shopSlug, reg)) {
          return;
        }

        if (!paymentAllowsAppAccess(profile.paymentStatus, profile.registrationTrial)) {
          const target = toPaymentRequiredPath(shopSlug);
          try {
            if (window.top && window.top !== window) {
              window.top.location.href = target;
              return;
            }
          } catch {
            // Ignore.
          }
          window.location.href = target;
          return;
        }

        if (disposed) return;
        // Hiển thị UI ngay sau khi có profile — không chờ cookie sync.
        // Cookie còn hợp lệ từ middleware nên iframe hoạt động bình thường.
        setSessionBridgeFailed(false);
        authedUidRef.current = user.uid;
        setResolvedShopSlug(shopSlug);
        setAuthed(true);
        setReady(true);

        // Cookie sync chạy ngầm — không block UI
        void (async () => {
          let ok = await syncIdTokenToCookie(shopSlug);
          if (!ok) {
            await new Promise((r) => setTimeout(r, 500));
            ok = await syncIdTokenToCookie(shopSlug);
          }
          if (!ok && !disposed) {
            setSessionBridgeFailed(true);
          }
        })();
      } catch {
        if (disposed) return;
        setAuthed(false);
        setReady(true);
        redirectToLogin();
      } finally {
        processingUid = "";
      }
    };

    void (async () => {
      const authClient = getAuthClient();
      await authClient.authStateReady();
      if (disposed) return;

      /** Trang chỉ bọc children (vd. /upgrade, /account): đã đăng nhập thì hiện UI ngay; đồng bộ cookie / RTDB chạy nền. */
      const simpleClientGate = !renderShop && pathShopFromUrl === undefined;
      const bootUser = authClient.getCurrentUser();

      unsub = authClient.onIdTokenChanged((user) => {
        settled = true;
        if (logoutDebounce !== undefined) {
          window.clearTimeout(logoutDebounce);
          logoutDebounce = undefined;
        }

        if (!user) {
          // Tránh đăng xuất nhầm khi Supabase tạm trả null (refresh token / tab ngủ / mạng chập).
          logoutDebounce = window.setTimeout(() => {
            logoutDebounce = undefined;
            if (disposed) return;
            if (getAuthClient().getCurrentUser()) return;
            clearProfileCache();
            setSessionBridgeFailed(false);
            setAuthed(false);
            setReady(true);
            void clearServerSession();
            redirectToLogin();
          }, 800);
          return;
        }

        void processSignedInUser(user);
      });

      settled = true;
      if (bootUser && simpleClientGate) {
        setReady(true);
        setAuthed(true);
      }
      if (bootUser) {
        void processSignedInUser(bootUser);
      }
    })();

    const fallbackTimer = window.setTimeout(() => {
      if (settled || disposed) return;
      const user = getAuthClient().getCurrentUser();
      if (!user) {
        setAuthed(false);
        setReady(true);
        redirectToLogin();
        return;
      }
      void processSignedInUser(user);
    }, 600);

    return () => {
      disposed = true;
      if (logoutDebounce !== undefined) window.clearTimeout(logoutDebounce);
      window.clearTimeout(fallbackTimer);
      unsub?.();
    };
  }, [pathShopFromUrl, bridgeRetryNonce]);

  useEffect(() => {
    if (!ready || !authed || sessionBridgeFailed) return;

    const ping = async () => {
      try {
        const deviceId = getDeviceId();
        const res = await fetch("/api/auth/presence", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(deviceId ? { deviceId } : {}),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { kicked?: boolean };
        if (data.kicked) {
          // Thiết bị bị kick: KHÔNG gọi signOut() ở đây vì nó trigger onIdTokenChanged → double-redirect.
          // Chỉ xóa server cookie; login page sẽ tự signOut() khi đọc reason=device_limit.
          clearProfileCache();
          await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
          try { sessionStorage.clear(); } catch { /* ignore */ }
          const loginUrl = "/login?reason=device_limit";
          try {
            if (window.top && window.top !== window) { window.top.location.href = loginUrl; return; }
          } catch { /* ignore */ }
          window.location.href = loginUrl;
        }
      } catch {
        // Mạng lỗi — bỏ qua, ping lại sau
      }
    };

    void ping();
    const id = window.setInterval(() => { void ping(); }, PRESENCE_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [ready, authed, sessionBridgeFailed]);

  // Auto-retry khi sessionBridgeFailed — thường do mạng chập hoặc server cold start.
  useEffect(() => {
    if (!sessionBridgeFailed) return;
    const id = window.setTimeout(() => {
      setSessionBridgeFailed(false);
      setReady(false);
      setAuthed(false);
      setResolvedShopSlug(null);
      setBridgeRetryNonce((n) => n + 1);
    }, 4000);
    return () => window.clearTimeout(id);
  }, [sessionBridgeFailed]);

  // Multi-device notification via Supabase Realtime Presence
  const showNewDeviceToast = useCallback(() => setNewDeviceToast(true), []);
  useEffect(() => {
    if (!ready || !authed) return;
    const uid = authedUidRef.current;
    if (!uid) return;
    let sb: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try { sb = getSupabaseBrowserClient(); } catch { return; }
    const myJoinedAt = Date.now();
    // Dùng getDeviceId() (localStorage, persistent) thay sessionStorage để nhận diện đúng thiết bị
    const deviceId = getDeviceId() || Math.random().toString(36).slice(2);

    const channel = sb.channel(`da-presence-${uid}`, { config: { presence: { key: deviceId } } });
    channel.on("presence", { event: "join" }, ({ newPresences }) => {
      for (const p of newPresences as Array<{ deviceId?: string; joinedAt?: number }>) {
        // Thiết bị mới đăng nhập sau khi chúng ta đã vào ít nhất 4 giây
        if (p.deviceId && p.deviceId !== deviceId && typeof p.joinedAt === "number" && p.joinedAt > myJoinedAt + 4000) {
          showNewDeviceToast();
          break;
        }
      }
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ deviceId, joinedAt: myJoinedAt });
      }
    });
    return () => {
      void channel.untrack().catch(() => undefined);
      void sb!.removeChannel(channel).catch(() => undefined);
    };
  }, [ready, authed, showNewDeviceToast]);

  // Auto-dismiss toast sau 8 giây
  useEffect(() => {
    if (!newDeviceToast) return;
    const id = window.setTimeout(() => setNewDeviceToast(false), 8000);
    return () => window.clearTimeout(id);
  }, [newDeviceToast]);

  if (!ready) {
    return (
      <div
        style={{
          minHeight: "40vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          color: "#6b7280",
          fontSize: 15,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Đang kiểm tra phiên đăng nhập…
      </div>
    );
  }
  if (!authed) {
    return (
      <div
        style={{
          minHeight: "40vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          color: "#6b7280",
          fontSize: 15,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Đang chuyển hướng…
      </div>
    );
  }
  if (renderShop) {
    if (!resolvedShopSlug) {
      return (
        <div
          style={{
            minHeight: "40vh",
            display: "grid",
            placeItems: "center",
            padding: 24,
            color: "#6b7280",
            fontSize: 15,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Đang tải cửa hàng…
        </div>
      );
    }
    if (sessionBridgeFailed) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: 24,
            background: "linear-gradient(165deg, #ecfdf5 0%, #d1fae5 45%, #a7f3d0 100%)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              background: "rgba(255,255,255,0.95)",
              borderRadius: 20,
              padding: "32px 28px",
              boxShadow: "0 20px 50px rgba(5, 150, 105, 0.18)",
              border: "1px solid rgba(167, 243, 208, 0.9)",
            }}
          >
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 12px" }}>
              Kết nối không ổn định
            </h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#475569", margin: "0 0 18px" }}>
              Đã xác thực tài khoản nhưng không đồng bộ được phiên làm việc — thường do mạng chậm hoặc server đang khởi động. Nhấn <strong>Thử lại</strong> hoặc <strong>Tải lại trang</strong>.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setSessionBridgeFailed(false);
                  setReady(false);
                  setAuthed(false);
                  setResolvedShopSlug(null);
                  setBridgeRetryNonce((n) => n + 1);
                }}
                style={{
                  padding: "12px 22px",
                  borderRadius: 12,
                  border: "none",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  color: "#fff",
                  background: "linear-gradient(135deg, #047857 0%, #059669 55%, #10b981 100%)",
                  boxShadow: "0 8px 20px rgba(5, 150, 105, 0.35)",
                }}
              >
                Thử lại
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: "12px 22px",
                  borderRadius: 12,
                  border: "2px solid #059669",
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: "pointer",
                  color: "#047857",
                  background: "#fff",
                }}
              >
                Tải lại trang
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <>
        {newDeviceToast && <NewDeviceToast onClose={() => setNewDeviceToast(false)} />}
        {renderShop({ shopSlug: resolvedShopSlug })}
      </>
    );
  }
  return (
    <>
      {newDeviceToast && <NewDeviceToast onClose={() => setNewDeviceToast(false)} />}
      {children}
    </>
  );
}

function NewDeviceToast({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 99999,
        maxWidth: 340,
        background: "#1e293b",
        color: "#f1f5f9",
        borderRadius: 14,
        padding: "14px 18px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        lineHeight: 1.5,
        animation: "slideUpToast 0.3s ease",
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>🔔</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Đăng nhập trên thiết bị khác</div>
        <div style={{ color: "#94a3b8", fontSize: 13 }}>
          Tài khoản vừa được đăng nhập từ một thiết bị khác.
        </div>
      </div>
      <button
        type="button"
        aria-label="Đóng"
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
        }}
      >
        ×
      </button>
      <style>{`@keyframes slideUpToast { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }`}</style>
    </div>
  );
}
