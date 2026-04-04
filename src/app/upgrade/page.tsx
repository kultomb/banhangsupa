"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import { postSessionCookieWithRetries } from "@/lib/client-auth";
import { getAuthClient } from "@/lib/db";
import { fetchUserProfileClient } from "@/lib/user-profile-client";
import { isEffectiveTrialAccount } from "@/lib/trial-shop";

function UpgradeForm() {
  const router = useRouter();
  const [currentShop, setCurrentShop] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = getAuthClient().onAuthStateChanged((user) => {
      if (!user) return;
      void fetchUserProfileClient(user.uid)
        .then((p) => {
          const slug = String(p.shopSlug || "");
          setCurrentShop(slug);
          const reg = p.registrationTrial;
          if (!slug) {
            router.replace("/");
            return;
          }
          if (!isEffectiveTrialAccount(reg, slug)) {
            router.replace(`/${slug}`);
            return;
          }
          if (p.paymentStatus === "pending_upgrade" && p.upgradeTargetSlug) {
            router.replace(`/payment-required?shop=${encodeURIComponent(slug)}`);
          }
        })
        .catch(() => undefined);
    });
    return () => unsub();
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = getAuthClient().getCurrentUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const idToken = await user.getIdToken();
      const res = await fetch("/api/upgrade/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (data.error === "slug_taken") {
          setError(
            "Tên shop sau khi bỏ tiền tố dùng thử đã có người dùng. Vui lòng liên hệ hỗ trợ hoặc đăng ký tài khoản mới với tên shop khác.",
          );
        } else if (data.error === "slug_too_short_after_strip") {
          setError(
            "Sau khi bỏ tiền tố dùng thử, tên shop còn quá ngắn (cần 3–30 ký tự). Vui lòng đăng ký tài khoản mới với tên shop đủ dài.",
          );
        } else if (data.error === "not_trial") setError("Chỉ tài khoản dùng thử mới nâng cấp tại đây.");
        else setError("Không tạo được yêu cầu nâng cấp. Thử lại sau.");
        return;
      }
      const sessionOk = await postSessionCookieWithRetries(idToken, { shopSlug: currentShop });
      if (!sessionOk) {
        setError("Chưa lưu được phiên đăng nhập. Thử lại sau vài giây.");
        return;
      }
      router.replace(`/payment-required?shop=${encodeURIComponent(currentShop)}`);
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
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 16,
          padding: 24,
          border: "1px solid rgba(16,185,129,0.22)",
          boxShadow: "0 16px 40px rgba(5,150,105,0.18)",
          display: "grid",
          gap: 14,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, color: "#065f46", textAlign: "center" }}>
          Nâng cấp lên bản chính thức
        </h1>
        <p style={{ margin: 0, color: "#475569", fontSize: 14, lineHeight: 1.55 }}>
          Giữ nguyên email và mật khẩu. Sau khi chuyển khoản, hệ thống copy dữ liệu POS sang địa chỉ chính thức
          tương ứng.
        </p>

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
            background: loading ? "#6b7280" : "linear-gradient(135deg, #047857 0%, #10b981 100%)",
            color: "#fff",
            fontWeight: 700,
            padding: "12px 14px",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Đang xử lý..." : "Tiếp tục — thanh toán nâng cấp"}
        </button>

        <div style={{ textAlign: "center" }}>
          <Link href={currentShop ? `/${currentShop}?trial=1` : "/"} style={{ color: "#047857", fontSize: 14 }}>
            ← Quay lại POS
          </Link>
        </div>
      </form>
    </main>
  );
}

export default function UpgradePage() {
  return (
    <RequireAuth>
      <Suspense fallback={null}>
        <UpgradeForm />
      </Suspense>
    </RequireAuth>
  );
}
