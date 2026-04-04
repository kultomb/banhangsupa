"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { getAuthClient } from "@/lib/db";
import LoginTurnstile, { type LoginTurnstileHandle } from "@/components/LoginTurnstile";
import { fetchUserProfileClient } from "@/lib/user-profile-client";
import {
  forceLogoutMissingShop,
  hasValidShopSlug,
  paymentAllowsAppAccess,
  postSessionCookieWithRetries,
} from "@/lib/client-auth";
import { isEffectiveTrialAccount, syncTrialUiSessionFlag } from "@/lib/trial-shop";
import { buildPasswordResetActionCodeSettings } from "@/lib/password-reset-email";

function shopAppPath(slug: string, registrationTrial: boolean | null) {
  const trial = isEffectiveTrialAccount(registrationTrial, slug);
  return trial ? `/${slug}?trial=1` : `/${slug}`;
}

function toPaymentRequiredPath(shopSlug?: string) {
  const shop = String(shopSlug || "").trim();
  return shop ? `/payment-required?shop=${encodeURIComponent(shop)}` : "/payment-required";
}

function getAuthErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  const codeMatch = raw.match(/auth\/[a-z-]+/i);
  const code = (codeMatch?.[0] || "").toLowerCase();

  switch (code) {
    case "auth/invalid-email":
      return "Email không hợp lệ.";
    case "auth/missing-password":
      return "Vui lòng nhập mật khẩu.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email hoặc mật khẩu không đúng.";
    case "auth/too-many-requests":
      return "Bạn thử sai quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.";
    case "auth/network-request-failed":
      return "Lỗi kết nối mạng. Vui lòng kiểm tra Internet và thử lại.";
    default:
      break;
  }

  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) {
    return "Email hoặc mật khẩu không đúng.";
  }
  if (lower.includes("email rate limit") || lower.includes("too many requests")) {
    return "Bạn thử sai quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.";
  }
  return "Đăng nhập thất bại. Vui lòng thử lại.";
}

function resetTurnstile(ref: RefObject<LoginTurnstileHandle | null>) {
  ref.current?.reset();
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const submittingRef = useRef(false);
  const turnstileRef = useRef<LoginTurnstileHandle | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetSuccess, setResetSuccess] = useState("");
  const [resetError, setResetError] = useState("");
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();
  const isPasswordChangedNotice = String(searchParams.get("reason") || "") === "password-changed";

  useEffect(() => {
    const reason = String(searchParams.get("reason") || "");
    if (reason === "missing-shop") {
      setNotice(
        "Cửa hàng gắn với tài khoản không còn trên hệ thống. Bạn đã được đăng xuất để bảo vệ dữ liệu.",
      );
      return;
    }
    if (reason === "password-changed") {
      setNotice("Vui lòng đăng nhập lại bằng mật khẩu mới.");
      return;
    }
    setNotice("");
  }, [searchParams]);

  async function resolveUserProfile(uid: string) {
    return fetchUserProfileClient(uid);
  }

  useEffect(() => {
    let active = true;
    /** Tunnel (ngrok) / mạng chặn có thể làm authStateReady() không bao giờ resolve — không kẹt spinner vô hạn. */
    const capMs = 8000;
    void (async () => {
      try {
        await Promise.race([
          getAuthClient().authStateReady().catch(() => undefined),
          new Promise<void>((r) => setTimeout(r, capMs)),
        ]);
      } finally {
        if (!active) return;
        if (!getAuthClient().getCurrentUser()) setAuthBootstrapping(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let forcingLogout = false;
    const unsub = getAuthClient().onAuthStateChanged((user) => {
      if (submittingRef.current) return;
      if (!user) {
        setAuthBootstrapping(false);
        return;
      }
      setAuthBootstrapping(true);
      /** signOut / redirect có thể treo qua ngrok — luôn tắt spinner sau tối đa ~20s. */
      const safetyMs = 20000;
      const safetyId = window.setTimeout(() => setAuthBootstrapping(false), safetyMs);
      void (async () => {
        try {
          const profile = await resolveUserProfile(user.uid);
          if (!hasValidShopSlug(profile.shopSlug)) {
            if (forcingLogout) return;
            forcingLogout = true;
            await Promise.race([
              forceLogoutMissingShop(),
              new Promise<void>((r) => setTimeout(r, 12000)),
            ]);
            return;
          }
          syncTrialUiSessionFlag({
            shopSlug: profile.shopSlug,
            registrationTrial: profile.registrationTrial,
          });
          if (!paymentAllowsAppAccess(profile.paymentStatus, profile.registrationTrial)) {
            router.replace(toPaymentRequiredPath(profile.shopSlug));
            return;
          }
          if (profile.shopSlug) router.replace(shopAppPath(profile.shopSlug, profile.registrationTrial));
          else router.replace("/account");
        } catch {
          // Mạng / tunnel: cho phép đăng nhập lại tay
        } finally {
          window.clearTimeout(safetyId);
          window.setTimeout(() => setAuthBootstrapping(false), 250);
        }
      })();
    });
    return () => unsub();
  }, [router]);

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const emailTrimmed = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError("Email không đúng định dạng (ví dụ: ten@domain.com).");
      setLoading(false);
      return;
    }

    if (turnstileSiteKey && !turnstileToken.trim()) {
      setError("Vui lòng hoàn tất xác minh bảo vệ đăng nhập.");
      setLoading(false);
      return;
    }

    submittingRef.current = true;
    try {
      const preCtrl = new AbortController();
      const preTimer = window.setTimeout(() => preCtrl.abort(), 15000);
      let preRes: Response;
      try {
        preRes = await fetch("/api/auth/login-precheck", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: emailTrimmed,
            turnstileToken: turnstileSiteKey ? turnstileToken : "",
          }),
          signal: preCtrl.signal,
        });
      } finally {
        window.clearTimeout(preTimer);
      }

      const preJson = (await preRes.json().catch(() => ({}))) as {
        error?: string;
        retryAfterSec?: number;
      };

      if (preRes.status === 429) {
        const sec = typeof preJson.retryAfterSec === "number" ? preJson.retryAfterSec : 60;
        setError(`Đăng nhập tạm khóa do thử quá nhiều lần. Thử lại sau khoảng ${sec} giây.`);
        resetTurnstile(turnstileRef);
        return;
      }
      if (!preRes.ok) {
        resetTurnstile(turnstileRef);
        if (preJson.error === "captcha_failed") {
          setError(
            "Mã xác minh đã hết hạn hoặc đã dùng. Vui lòng hoàn tất ô xác minh lại rồi đăng nhập.",
          );
        } else if (preJson.error === "invalid_email") {
          setError("Email không hợp lệ.");
        } else if (preJson.error === "server_error" || preRes.status >= 500) {
          setError("Máy chủ tạm thời không kiểm tra được đăng nhập. Thử lại sau vài giây.");
        } else {
          setError("Không thể xác minh bước đăng nhập. Thử lại sau giây lát.");
        }
        return;
      }

      const cred = await getAuthClient().signInWithEmailAndPassword(emailTrimmed, password);
      const profile = await resolveUserProfile(cred.uid);
      if (!hasValidShopSlug(profile.shopSlug)) {
        await forceLogoutMissingShop();
        resetTurnstile(turnstileRef);
        setError("Cửa hàng không còn trên hệ thống. Bạn đã được đăng xuất.");
        return;
      }
      const idToken = await cred.getIdToken();
      const sessionOk = await postSessionCookieWithRetries(idToken, {
        shopSlug: profile.shopSlug,
      });
      if (!sessionOk) {
        resetTurnstile(turnstileRef);
        setError("Chưa đăng nhập xong. Kiểm tra mạng rồi thử bấm Đăng nhập lại.");
        return;
      }
      syncTrialUiSessionFlag({
        shopSlug: profile.shopSlug,
        registrationTrial: profile.registrationTrial,
      });
      if (!paymentAllowsAppAccess(profile.paymentStatus, profile.registrationTrial)) {
        router.replace(toPaymentRequiredPath(profile.shopSlug));
        return;
      }
      if (profile.shopSlug) router.replace(shopAppPath(profile.shopSlug, profile.registrationTrial));
      else router.replace("/account");
    } catch (err: unknown) {
      resetTurnstile(turnstileRef);
      if (err instanceof Error && err.name === "AbortError") {
        setError("Hết thời gian chờ máy chủ. Kiểm tra mạng và thử lại.");
      } else {
        setError(getAuthErrorMessage(err));
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  async function handleSendPasswordReset() {
    setResetSuccess("");
    setResetError("");
    const target = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setResetError("Vui lòng nhập email đúng định dạng (ví dụ: ten@domain.com).");
      return;
    }
    setResetSending(true);
    try {
      const actionSettings = buildPasswordResetActionCodeSettings();
      await getAuthClient().sendPasswordResetEmail(target, actionSettings);
      setResetSuccess(
        "Đã gửi email đặt lại mật khẩu. Nếu không thấy, hãy mở mục Thư rác / Spam.",
      );
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err || "");
      const lower = raw.toLowerCase();
      if (
        lower.includes("auth/unauthorized-continue-uri") ||
        lower.includes("auth/invalid-continue-uri") ||
        lower.includes("redirect") ||
        lower.includes("redirect_uri")
      ) {
        setResetError(
          "Không gửi được email: thêm URL trang /reset-password vào Redirect URLs trong Supabase Auth, hoặc liên hệ kỹ thuật.",
        );
      } else {
        setResetError("Không gửi được email đặt lại mật khẩu. Thử lại sau giây lát.");
      }
    } finally {
      setResetSending(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(1200px 600px at 20% -10%, rgba(16,185,129,0.35), transparent 55%), radial-gradient(900px 500px at 90% 110%, rgba(5,150,105,0.28), transparent 55%), linear-gradient(160deg, #ecfdf5 0%, #d1fae5 45%, #a7f3d0 100%)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(6px)",
          borderRadius: 16,
          padding: 24,
          border: "1px solid rgba(16,185,129,0.22)",
          boxShadow: "0 16px 40px rgba(5,150,105,0.18)",
          display: "grid",
          gap: 14,
        }}
      >
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 6, justifyItems: "center", textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 26, color: "#065f46" }}>
            {forgotPasswordMode ? "Đặt lại mật khẩu" : "Đăng nhập"}
          </h1>
        </div>
        <p style={{ margin: 0, color: "#4b5563", fontSize: 14, textAlign: "center" }}>
          {forgotPasswordMode
            ? "Nhập email đã đăng ký. Chúng tôi gửi link đặt lại mật khẩu qua email."
            : "Đăng nhập để vào hệ thống bán hàng."}
        </p>

        {notice ? (
          <div
            style={{
              background: isPasswordChangedNotice
                ? "linear-gradient(180deg, rgba(236,253,245,0.98) 0%, rgba(209,250,229,0.95) 100%)"
                : "linear-gradient(180deg, rgba(239,246,255,0.95) 0%, rgba(219,234,254,0.95) 100%)",
              border: isPasswordChangedNotice ? "1px solid #6ee7b7" : "1px solid #93c5fd",
              color: isPasswordChangedNotice ? "#166534" : "#1d4ed8",
              borderRadius: 12,
              padding: "11px 12px",
              fontSize: 13,
              lineHeight: 1.45,
              boxShadow: isPasswordChangedNotice
                ? "0 8px 18px rgba(5,150,105,0.14)"
                : "0 8px 18px rgba(37,99,235,0.12)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              {isPasswordChangedNotice ? "Đổi mật khẩu thành công" : "Thông báo hệ thống"}
            </div>
            <div style={{ whiteSpace: "pre-line" }}>{notice}</div>
          </div>
        ) : null}

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Email</span>
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            required={!forgotPasswordMode}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              border: "1px solid #a7f3d0",
              borderRadius: 10,
              padding: "11px 12px",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>

        {authBootstrapping ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              justifyItems: "center",
              textAlign: "center",
              padding: "8px 0",
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                border: "3px solid #bbf7d0",
                borderTopColor: "#059669",
                animation: "spin 0.9s linear infinite",
              }}
            />
            <div style={{ color: "#065f46", fontSize: 14, fontWeight: 600 }}>
              Đang khôi phục phiên đăng nhập…
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : forgotPasswordMode ? (
          <>
            {resetError ? (
              <div
                style={{
                  background: "#fef2f2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                }}
              >
                {resetError}
              </div>
            ) : null}
            {resetSuccess ? (
              <div
                style={{
                  background: "#ecfdf5",
                  color: "#166534",
                  border: "1px solid #86efac",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                }}
              >
                {resetSuccess}
              </div>
            ) : null}
            <button
              type="button"
              disabled={resetSending}
              onClick={handleSendPasswordReset}
              style={{
                border: "1px solid #93c5fd",
                borderRadius: 10,
                background: resetSending ? "#e5e7eb" : "#eff6ff",
                color: "#1d4ed8",
                fontWeight: 700,
                padding: "11px 14px",
                cursor: resetSending ? "not-allowed" : "pointer",
                fontSize: 14,
              }}
            >
              {resetSending ? "Đang gửi…" : "Gửi link đặt lại mật khẩu"}
            </button>
            <button
              type="button"
              onClick={() => {
                setForgotPasswordMode(false);
                setResetError("");
                setResetSuccess("");
                resetTurnstile(turnstileRef);
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "#047857",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                padding: "4px 0",
                justifySelf: "center",
              }}
            >
              ← Quay lại đăng nhập
            </button>
          </>
        ) : (
          <form
            onSubmit={handleLogin}
            style={{
              display: "grid",
              gap: 14,
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Mật khẩu</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  border: "1px solid #a7f3d0",
                  borderRadius: 10,
                  padding: "11px 12px",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </label>

            {turnstileSiteKey ? (
              <LoginTurnstile ref={turnstileRef} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
            ) : null}

            {error ? (
              <div
                style={{
                  background: "#fef2f2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              style={{
                border: "none",
                borderRadius: 10,
                background: loading
                  ? "#6b7280"
                  : "linear-gradient(135deg, #047857 0%, #059669 50%, #10b981 100%)",
                color: "#fff",
                fontWeight: 700,
                padding: "12px 14px",
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: loading ? "none" : "0 10px 22px rgba(5,150,105,0.28)",
              }}
            >
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setResetError("");
                setResetSuccess("");
                resetTurnstile(turnstileRef);
                setForgotPasswordMode(true);
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "#047857",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                padding: "2px 0 0 0",
                justifySelf: "center",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              Quên mật khẩu?
            </button>
          </form>
        )}
      </div>

        <div style={{ textAlign: "center", fontSize: 14, color: "#4b5563", display: "grid", gap: 10 }}>
          <div>
            Chưa có tài khoản?{" "}
            <Link
              href="/register"
              style={{
                color: "#065f46",
                fontWeight: 800,
                textDecoration: "none",
                background: "#ecfdf5",
                border: "1px solid #a7f3d0",
                borderRadius: 999,
                padding: "4px 10px",
                display: "inline-block",
              }}
            >
              Đăng ký
            </Link>
          </div>
          <div>
            <Link href="/" style={{ color: "#6b7280", fontSize: 13 }}>
              ← Trang chủ
            </Link>
            {" · "}
            <Link href="/trial" style={{ color: "#6b7280", fontSize: 13 }}>
              Dùng thử
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function LoginSuspenseFallback() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)",
        color: "#4b5563",
        fontSize: 15,
      }}
    >
      Đang tải trang đăng nhập…
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSuspenseFallback />}>
      <LoginContent />
    </Suspense>
  );
}
