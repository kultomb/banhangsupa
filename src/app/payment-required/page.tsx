"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { forceLogoutMissingShop, hasValidShopSlug, postSessionCookieWithRetries } from "@/lib/client-auth";
import { getAuthClient } from "@/lib/db";
import { fetchUserProfileClient } from "@/lib/user-profile-client";
import {
  isEffectiveTrialAccount,
  isProfilePaidForAppAccess,
  syncTrialUiSessionFlag,
} from "@/lib/trial-shop";

const BANK_BIN = process.env.NEXT_PUBLIC_BANK_BIN || "970422";
const BANK_ACCOUNT = process.env.NEXT_PUBLIC_BANK_ACCOUNT || "0000000000";
const BANK_NAME = process.env.NEXT_PUBLIC_BANK_NAME || "CHU TAI KHOAN";
const PAYMENT_AMOUNT = Number(process.env.NEXT_PUBLIC_PAYMENT_AMOUNT || 299000);

function PaymentRequiredContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialShop = String(searchParams.get("shop") || "");
  const [shop, setShop] = useState(initialShop);
  const [isUpgradePay, setIsUpgradePay] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [forcingLogout, setForcingLogout] = useState(false);

  const qrUrl = useMemo(() => {
    const addInfo = encodeURIComponent(paymentRef || `THANH TOAN ${shop || "SHOP"}`);
    const accountName = encodeURIComponent(BANK_NAME);
    return `https://img.vietqr.io/image/${BANK_BIN}-${BANK_ACCOUNT}-compact2.png?amount=${PAYMENT_AMOUNT}&addInfo=${addInfo}&accountName=${accountName}`;
  }, [paymentRef, shop]);

  const checkStatus = useCallback(async (uid: string) => {
    let profile: {
      shopSlug?: string;
      paymentStatus?: string;
      paymentRef?: string;
      registrationTrial?: unknown;
      upgradeTargetSlug?: string;
    } = {};

    try {
      const u = getAuthClient().getCurrentUser();
      const token = u ? await u.getIdToken() : "";
      const res = await fetch("/api/auth/payment-status", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (res.ok) {
        const j = (await res.json()) as {
          paid?: boolean;
          paymentStatus?: string;
          shopSlug?: string;
          paymentRef?: string;
          registrationTrial?: unknown;
          upgradeTargetSlug?: string;
        };
        profile = {
          shopSlug: j.shopSlug,
          paymentStatus: j.paymentStatus,
          paymentRef: j.paymentRef,
          registrationTrial: j.registrationTrial,
          upgradeTargetSlug: j.upgradeTargetSlug,
        };
      }
    } catch {
      /* fallback RTDB client */
    }

    if (!profile.paymentStatus && !profile.shopSlug) {
      try {
        const p = await fetchUserProfileClient(uid);
        profile = {
          shopSlug: p.shopSlug,
          paymentStatus: p.paymentStatus,
          paymentRef: p.paymentRef,
          registrationTrial: p.registrationTrial,
          upgradeTargetSlug: p.upgradeTargetSlug,
        };
      } catch {
        setMessage((m) => m || "Không đọc được trạng thái tài khoản. Thử đăng xuất và đăng nhập lại.");
        return false;
      }
    }

    const resolvedShop = String(profile.shopSlug || "");
    const upgradeTarget = String(profile.upgradeTargetSlug || "").trim();
    const rt = profile.registrationTrial;
    const reg =
      rt === true || rt === "true" ? true : rt === false || rt === "false" ? false : null;
    const paymentStatus = String(profile.paymentStatus || "").trim();
    const paid = isProfilePaidForAppAccess({
      paymentStatus,
      registrationTrial: reg,
    });
    /** pending_upgrade vẫn được vào POS nhưng phải ở lại trang CK nâng cấp — không auto về shop. */
    const skipPaymentWall = paid && paymentStatus !== "pending_upgrade";
    if (!hasValidShopSlug(resolvedShop)) {
      if (!forcingLogout) {
        setForcingLogout(true);
        await forceLogoutMissingShop();
      }
      return false;
    }
    if (upgradeTarget) {
      setIsUpgradePay(true);
      setShop((prev) => `${resolvedShop || prev || initialShop} → ${upgradeTarget}`);
    } else {
      setIsUpgradePay(false);
      if (resolvedShop) setShop(resolvedShop);
    }
    setPaymentRef(String(profile.paymentRef || ""));
    if (!resolvedShop && !initialShop) {
      setMessage(
        "Tài khoản chưa có tên cửa hàng. Nếu bạn vừa đăng ký, hãy thử đăng ký lại; nếu đã dùng lâu, vui lòng liên hệ hỗ trợ.",
      );
    }
    if (skipPaymentWall) {
      const slug = String(resolvedShop || "").trim();
      if (!slug) return false;
      const u = getAuthClient().getCurrentUser();
      if (u) {
        const token = await u.getIdToken();
        await postSessionCookieWithRetries(token, { shopSlug: slug });
      }
      syncTrialUiSessionFlag({ shopSlug: slug, registrationTrial: reg });
      const path =
        isEffectiveTrialAccount(reg, slug) ? `/${slug}?trial=1` : `/${slug}`;
      router.replace(path);
      return true;
    }
    return false;
  }, [forcingLogout, initialShop, router]);

  useEffect(() => {
    let disposed = false;
    const unsub = getAuthClient().onAuthStateChanged(async (user) => {
      if (!user) {
        window.setTimeout(() => {
          if (disposed) return;
          const restoredUser = getAuthClient().getCurrentUser();
          if (!restoredUser) {
            router.replace("/login");
            return;
          }
          void checkStatus(restoredUser.uid).finally(() => {
            if (!disposed) setChecking(false);
          });
        }, 350);
        return;
      }
      await checkStatus(user.uid);
      if (!disposed) setChecking(false);
    });
    return () => {
      disposed = true;
      unsub();
    };
  }, [checkStatus, router]);

  useEffect(() => {
    if (checking) return;
    const timer = window.setInterval(() => {
      const user = getAuthClient().getCurrentUser();
      if (!user) return;
      void checkStatus(user.uid);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [checking, checkStatus]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleIHavePaid() {
    const user = getAuthClient().getCurrentUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    if (checkingPayment) return;
    setCheckingPayment(true);
    setMessage("Đang kiểm tra thanh toán...");
    try {
      const paid = await checkStatus(user.uid);
      if (!paid) {
        setCooldownSeconds(12);
        setMessage(
          "Đang xử lý thanh toán. Hệ thống sẽ tự cập nhật trong giây lát.",
        );
      }
    } finally {
      setCheckingPayment(false);
    }
  }

  async function handleLogout() {
    await getAuthClient().signOut();
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    router.replace("/login");
  }

  if (checking) {
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
        Đang kiểm tra trạng thái thanh toán...
      </main>
    );
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
      <section
        style={{
          width: "100%",
          maxWidth: 520,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 16,
          border: "1px solid rgba(16,185,129,0.22)",
          boxShadow: "0 16px 40px rgba(5,150,105,0.18)",
          padding: 22,
          display: "grid",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, color: "#065f46", fontSize: 24, textAlign: "center" }}>
          {isUpgradePay ? "Thanh toán nâng cấp tài khoản" : "Kích hoạt tài khoản"}
        </h1>
        <p style={{ margin: 0, color: "#475569", textAlign: "center", fontSize: 14 }}>
          {isUpgradePay ? (
            <>
              Chuyển khoản để chuyển dữ liệu sang shop chính thức (cùng tài khoản đăng nhập):{" "}
              <strong>{shop || "-"}</strong>
            </>
          ) : (
            <>
              Hoàn tất chuyển khoản để mở khóa gian hàng: <strong>{shop || "-"}</strong>
            </>
          )}
        </p>

        <div style={{ textAlign: "center", fontSize: 14, color: "#0f172a" }}>
          <div>
            Số tiền: <strong>{PAYMENT_AMOUNT.toLocaleString("vi-VN")} VND</strong>
          </div>
          <div>
            Nội dung: <strong>{paymentRef || `THANH TOAN ${shop || "SHOP"}`}</strong>
          </div>
        </div>

        <div style={{ display: "grid", placeItems: "center", padding: 8 }}>
          <img
            src={qrUrl}
            alt="QR thanh toán"
            style={{ width: 280, maxWidth: "100%", borderRadius: 12, border: "1px solid #d1fae5" }}
          />
        </div>

        {message ? (
          <div style={{ display: "grid", gap: 8 }}>
            <style>
              {`@keyframes paymentLoadingSlide {
                0% { transform: translateX(-120%); }
                100% { transform: translateX(360%); }
              }`}
            </style>
            <div
              style={{
                height: 8,
                width: "100%",
                background: "#e2e8f0",
                borderRadius: 999,
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "28%",
                  background: "linear-gradient(90deg, #059669 0%, #10b981 100%)",
                  borderRadius: 999,
                  animation: "paymentLoadingSlide 1.2s linear infinite",
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: "#475569", textAlign: "center" }}>{message}</div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleIHavePaid}
          disabled={checkingPayment}
          style={{
            border: "none",
            borderRadius: 10,
            background: checkingPayment
              ? "#6b7280"
              : "linear-gradient(135deg, #047857 0%, #059669 50%, #10b981 100%)",
            color: "white",
            padding: "12px 14px",
            fontWeight: 700,
            cursor: checkingPayment ? "not-allowed" : "pointer",
            opacity: checkingPayment ? 0.95 : 1,
          }}
        >
          {checkingPayment ? "Đang kiểm tra thanh toán..." : "Tôi đã chuyển khoản - Kiểm tra lại"}
        </button>
        {cooldownSeconds > 0 ? (
          <div style={{ textAlign: "center", fontSize: 13, color: "#475569" }}>
            Vui lòng chờ {cooldownSeconds}s
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <Link
            href="/login"
            style={{
              border: "1px solid #a7f3d0",
              background: "#ecfdf5",
              color: "#065f46",
              borderRadius: 8,
              padding: "8px 12px",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Về đăng nhập
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              border: "1px solid rgba(239,68,68,0.35)",
              background: "#ef4444",
              color: "white",
              borderRadius: 8,
              padding: "8px 12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Đăng xuất
          </button>
        </div>
      </section>
    </main>
  );
}

export default function PaymentRequiredPage() {
  return (
    <Suspense fallback={null}>
      <PaymentRequiredContent />
    </Suspense>
  );
}
