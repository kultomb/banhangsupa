"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { getAuthClient, getDbProvider } from "@/lib/db";
import { SIGNUP_PASSWORD_HINT, validateSignupPassword } from "@/lib/password-policy";
import { revokeAllFirebaseSessionsThenSignOut } from "@/lib/client-auth";

export default function ResetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const oobCode = searchParams.get("oobCode");
  const recoveryCode = searchParams.get("code") || oobCode;
  const recoveryType = searchParams.get("type");
  const isValidLink =
    getDbProvider() === "supabase"
      ? Boolean(recoveryCode && recoveryType === "recovery")
      : mode === "resetPassword" && Boolean(oobCode);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const title = useMemo(
    () => (isValidLink ? "Đặt lại mật khẩu" : "Liên kết không hợp lệ"),
    [isValidLink],
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    const code = getDbProvider() === "supabase" ? recoveryCode : oobCode;
    if (!code) {
      setError("Thiếu mã xác thực đặt lại mật khẩu.");
      return;
    }
    const pwCheck = validateSignupPassword(password);
    if (!pwCheck.ok) {
      setError(pwCheck.message);
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    setLoading(true);
    try {
      const authClient = getAuthClient();
      if (getDbProvider() === "supabase") {
        await authClient.confirmPasswordReset(code, password);
      } else {
        await authClient.verifyPasswordResetCode(code);
        await authClient.confirmPasswordReset(code, password);
      }
      setPassword("");
      setConfirmPassword("");
      setMessage("Đổi mật khẩu thành công.");
      await new Promise((r) => window.setTimeout(r, 2000));
      await revokeAllFirebaseSessionsThenSignOut();
      router.replace("/login?reason=password-changed");
    } catch {
      setError("Link đổi mật khẩu không hợp lệ hoặc đã hết hạn.");
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
        background: "#f4f6fb",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
          display: "grid",
          gap: 14,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>{title}</h1>

        {!isValidLink ? (
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
            Link không đúng định dạng. Vui lòng mở lại link từ email hệ thống.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Mật khẩu mới</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu mới"
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 14,
                }}
              />
              <span style={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>{SIGNUP_PASSWORD_HINT}</span>
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
                placeholder="Nhập lại mật khẩu mới"
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 14,
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

            {message ? (
              <div
                style={{
                  background: "#ecfdf5",
                  color: "#166534",
                  border: "1px solid #86efac",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                  whiteSpace: "pre-line",
                }}
              >
                {message}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              style={{
                border: "none",
                borderRadius: 8,
                background: loading ? "#94a3b8" : "#059669",
                color: "#fff",
                fontWeight: 700,
                padding: "11px 14px",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Đang xử lý…" : "Cập nhật mật khẩu"}
            </button>
          </form>
        )}

        <Link href="/login" style={{ textAlign: "center", fontSize: 14 }}>
          Quay lại đăng nhập
        </Link>
      </div>
    </main>
  );
}
