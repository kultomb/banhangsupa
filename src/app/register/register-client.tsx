"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { getAuthClient } from "@/lib/db";
import { postSessionCookieWithRetries } from "@/lib/client-auth";
import { SIGNUP_PASSWORD_HINT, validateSignupPassword } from "@/lib/password-policy";
import { applyTrialPrefixToSlug, getTrialShopPrefix } from "@/lib/trial-shop";

function getAuthErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  const codeMatch = raw.match(/auth\/[a-z-]+/i);
  const code = (codeMatch?.[0] || "").toLowerCase();
  const normalized = raw.toLowerCase();

  if (
    normalized.includes("permission_denied") ||
    normalized.includes("database/permission-denied") ||
    normalized.includes("insufficient permissions")
  ) {
    return "Đăng ký không hoàn tất được do lỗi hệ thống. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.";
  }
  if (normalized.includes("app_check") || normalized.includes("app check")) {
    return "Hệ thống từ chối kết nối tạm thời. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.";
  }

  switch (code) {
    case "auth/invalid-email":
      return "Email không hợp lệ.";
    case "auth/email-already-in-use":
      return "Email này đã được đăng ký.";
    case "auth/weak-password":
      return "Mật khẩu quá yếu. Vui lòng đặt mật khẩu mạnh hơn.";
    case "auth/network-request-failed":
      return "Lỗi kết nối mạng. Vui lòng kiểm tra Internet và thử lại.";
    case "auth/too-many-requests":
      return "Thao tác quá nhanh hoặc quá nhiều lần. Vui lòng thử lại sau.";
    default:
      return "Đăng ký thất bại. Vui lòng kiểm tra thông tin và thử lại.";
  }
}

export default function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isTrial = searchParams.get("trial") === "1";
  const trialPrefix = useMemo(() => getTrialShopPrefix(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [shopSlug, setShopSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const slug = applyTrialPrefixToSlug(shopSlug, isTrial);
    const emailTrimmed = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError("Email không đúng định dạng (ví dụ: ten@domain.com).");
      return;
    }

    const pwCheck = validateSignupPassword(password, emailTrimmed);
    if (!pwCheck.ok) {
      setError(pwCheck.message);
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    if (isTrial) {
      const suffix = slug.startsWith(`${trialPrefix}-`) ? slug.slice(trialPrefix.length + 1) : "";
      const core = suffix.replace(/[^a-z0-9]/gi, "");
      if (core.length < 2) {
        setError("Tên gian hàng thử quá ngắn. Vui lòng nhập ít nhất 2 ký tự (chữ thường hoặc số).");
        return;
      }
    }

    if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
      setError("Tên shop chỉ gồm a-z, số, dấu -, độ dài 3-30 ký tự.");
      return;
    }

    setLoading(true);
    try {
      const cred = await getAuthClient().createUserWithEmailAndPassword(emailTrimmed, password);
      const idToken = await cred.getIdToken();

      await new Promise<void>((resolve) => {
        let done = false;
        const timer = window.setTimeout(() => {
          if (done) return;
          done = true;
          resolve();
        }, 3000);
        const unsub = getAuthClient().onAuthStateChanged((u) => {
          if (done) return;
          if (!u || u.uid !== cred.uid) return;
          done = true;
          window.clearTimeout(timer);
          unsub();
          resolve();
        });
      });

      const bootRes = await fetch("/api/auth/register-bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idToken,
          email: emailTrimmed,
          shopSlugInput: shopSlug,
          isTrial,
        }),
      });
      const bootJson = (await bootRes.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        shopSlug?: string;
      };

      if (!bootRes.ok) {
        try {
          await getAuthClient().deleteUser(cred);
        } catch {
          await getAuthClient().signOut().catch(() => undefined);
        }
        if (bootJson.error === "profile_exists") {
          setError("Tài khoản đã có hồ sơ. Hãy đăng nhập hoặc xóa user trong Supabase nếu đang test lại.");
        } else if (bootRes.status === 409 || bootJson.error === "shop_exists") {
          setError("Tên shop đã tồn tại. Vui lòng chọn tên khác.");
        } else if (bootJson.error === "shop_name_short") {
          setError("Tên gian hàng thử quá ngắn. Vui lòng nhập ít nhất 2 ký tự (chữ thường hoặc số).");
        } else if (bootJson.error === "invalid_shop") {
          setError("Tên shop chỉ gồm a-z, số, dấu -, độ dài 3-30 ký tự.");
        } else if (bootRes.status === 401) {
          setError("Đăng nhập không hợp lệ. Vui lòng thử lại.");
        } else if (bootJson.message) {
          setError(`Không tạo được cửa hàng: ${bootJson.message}`);
        } else {
          setError("Không tạo được cửa hàng. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.");
        }
        setLoading(false);
        return;
      }

      const finalSlug = String(bootJson.shopSlug || slug).trim() || slug;

      const sessionOk = await postSessionCookieWithRetries(idToken, { shopSlug: finalSlug });
      if (!sessionOk) {
        setError("Chưa đăng nhập xong. Kiểm tra mạng rồi thử lại.");
        setLoading(false);
        return;
      }

      if (isTrial) {
        router.replace(`/${finalSlug}?trial=1`);
      } else {
        router.replace(`/payment-required?shop=${encodeURIComponent(finalSlug)}`);
      }
    } catch (err: unknown) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
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
      <form
        onSubmit={handleRegister}
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
        <h1 style={{ margin: 0, fontSize: 26, color: "#065f46", textAlign: "center" }}>
          {isTrial ? "Đăng ký dùng thử" : "Đăng ký tài khoản"}
        </h1>
        <p style={{ margin: 0, color: "#4b5563", fontSize: 14, textAlign: "center" }}>
          {isTrial
            ? "Miễn phí, không cần thanh toán. Sau đăng ký bạn vào POS ngay."
            : "Tạo tài khoản để vào hệ thống bán hàng."}
        </p>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{isTrial ? "Tên gian hàng" : "Tên shop"}</span>
          <input
            type="text"
            required
            value={shopSlug}
            onChange={(e) => setShopSlug(e.target.value)}
            placeholder=""
            style={{
              border: "1px solid #a7f3d0",
              borderRadius: 10,
              padding: "11px 12px",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Email</span>
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            required
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

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Mật khẩu</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
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
          <span style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.45 }}>{SIGNUP_PASSWORD_HINT}</span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Xác nhận mật khẩu</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{
              border: "1px solid #a7f3d0",
              borderRadius: 10,
              padding: "11px 12px",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>

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
          {loading ? "Đang tạo tài khoản..." : "Đăng ký"}
        </button>

        <div style={{ textAlign: "center", fontSize: 14, color: "#4b5563", display: "grid", gap: 10 }}>
          <div>
            Đã có tài khoản?{" "}
            <Link
              href="/login"
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
              Đăng nhập
            </Link>
          </div>
          <div>
            <Link href="/" style={{ color: "#6b7280", fontSize: 13 }}>
              ← Trang chủ
            </Link>
            {" · "}
            <Link href="/trial" style={{ color: "#6b7280", fontSize: 13 }}>
              Dùng thử là gì?
            </Link>
          </div>
        </div>
      </form>
    </main>
  );
}
