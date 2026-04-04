"use client";

import { getAuthClient } from "@/lib/db";
import type { AuthSessionUser } from "@/lib/db/types";
import { ReactNode, useEffect, useState } from "react";
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

function toPaymentRequiredPath(shopSlug?: string) {
  const shop = String(shopSlug || "").trim();
  return shop ? `/payment-required?shop=${encodeURIComponent(shop)}` : "/payment-required";
}

type RequireAuthProps = {
  children?: ReactNode;
  /**
   * Route /[shop]: render với `shopSlug` từ hồ sơ Firebase — không dùng segment URL (tránh hiển thị slug rác
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
      if (process.env.NODE_ENV !== "production") {
        console.info("[RequireAuth] redirect -> /login");
      }
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
      const first = await fetchUserProfileClient(uid);
      if (hasValidShopSlug(first.shopSlug)) return first;
      await new Promise((r) => setTimeout(r, 450));
      return fetchUserProfileClient(uid);
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

        setSessionBridgeFailed(false);
        let cookieOk = await syncIdTokenToCookie(shopSlug);
        if (!cookieOk) {
          await new Promise((r) => setTimeout(r, 500));
          cookieOk = await syncIdTokenToCookie(shopSlug);
        }
        if (!cookieOk) {
          if (disposed) return;
          setSessionBridgeFailed(true);
          setResolvedShopSlug(shopSlug);
          setAuthed(true);
          setReady(true);
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
            // Ignore cross-frame redirect issues.
          }
          window.location.href = target;
          return;
        }

        if (disposed) return;
        setResolvedShopSlug(shopSlug);
        setAuthed(true);
        setReady(true);
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

      /** Trang chỉ bọc children (vd. /upgrade, /account): đã đăng nhập Firebase thì hiện UI ngay; đồng bộ cookie / RTDB chạy nền. */
      const simpleClientGate = !renderShop && pathShopFromUrl === undefined;
      const bootUser = authClient.getCurrentUser();

      unsub = authClient.onIdTokenChanged((user) => {
        settled = true;
        if (logoutDebounce !== undefined) {
          window.clearTimeout(logoutDebounce);
          logoutDebounce = undefined;
        }

        if (!user) {
          // Tránh đăng xuất nhầm khi Firebase tạm trả null (refresh token / tab ngủ / mạng chập).
          logoutDebounce = window.setTimeout(() => {
            logoutDebounce = undefined;
            if (disposed) return;
            if (getAuthClient().getCurrentUser()) return;
            setSessionBridgeFailed(false);
            setAuthed(false);
            setReady(true);
            void clearServerSession();
            redirectToLogin();
          }, 2500);
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
    }, 1800);

    return () => {
      disposed = true;
      if (logoutDebounce !== undefined) window.clearTimeout(logoutDebounce);
      window.clearTimeout(fallbackTimer);
      unsub?.();
    };
  }, [pathShopFromUrl, bridgeRetryNonce]);

  useEffect(() => {
    if (!ready || !authed || sessionBridgeFailed) return;
    const ping = () => {
      void fetch("/api/auth/presence", { method: "POST", credentials: "include" });
    };
    ping();
    const id = window.setInterval(ping, PRESENCE_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [ready, authed, sessionBridgeFailed]);

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
              Chưa thiết lập phiên đồng bộ
            </h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#475569", margin: "0 0 18px" }}>
              Đăng nhập Firebase đã OK; cần thêm cookie phiên cho <code style={{ fontSize: 13 }}>/api/rtdb</code>. Thử{" "}
              <strong>Tải lại trang</strong>, tab thường, bật cookie cho domain chuẩn (www hoặc non-www như cấu hình).
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
    return <>{renderShop({ shopSlug: resolvedShopSlug })}</>;
  }
  return <>{children}</>;
}
