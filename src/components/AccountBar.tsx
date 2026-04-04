"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getAuthClient } from "@/lib/db";
import { fetchUserProfileClient } from "@/lib/user-profile-client";

type AccountBarProps = {
  shop?: string;
  /** Gắn trong layout flex (không fixed) — ít dùng */
  docked?: boolean;
};

export default function AccountBar({ shop, docked = false }: AccountBarProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const [shopDisplayName, setShopDisplayName] = useState("");

  useEffect(() => {
    const unsub = getAuthClient().onAuthStateChanged(async (user) => {
      setEmail(user?.email || "");
      if (user?.uid) {
        try {
          const p = await fetchUserProfileClient(user.uid);
          setShopDisplayName(p.shopDisplayName || "");
        } catch {
          setShopDisplayName("");
        }
      } else {
        setShopDisplayName("");
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const updateMobile = () => setIsMobile(window.innerWidth <= 768);
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rootDoc = el.ownerDocument;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    rootDoc.addEventListener("mousedown", onDocClick);
    rootDoc.addEventListener("keydown", onEsc);
    return () => {
      rootDoc.removeEventListener("mousedown", onDocClick);
      rootDoc.removeEventListener("keydown", onEsc);
    };
  }, []);

  const displayShop = useMemo(() => {
    if (shopDisplayName) return shopDisplayName;
    if (!shop) return "Tài khoản";
    return shop;
  }, [shop, shopDisplayName]);

  async function handleLogout() {
    await getAuthClient().signOut();
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    router.replace("/login");
  }

  /** Trang shop: dùng portal vào iframe (#next-account-slot) — không dùng strip này */
  const shopTopStripStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minHeight: 52,
    paddingTop: "max(10px, env(safe-area-inset-top))",
    paddingBottom: 10,
    paddingLeft: isMobile ? 16 : 20,
    paddingRight: isMobile ? 16 : 20,
    boxSizing: "border-box",
    pointerEvents: "none",
  };

  const shellStyle: CSSProperties = docked
    ? {
        position: "relative",
        flexShrink: 0,
        zIndex: 20,
      }
    : {
        position: "relative",
        pointerEvents: "auto",
      };

  const accountControls = (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Mở menu tài khoản"
        aria-label="Mở menu tài khoản"
        style={{
          width: "auto",
          maxWidth: isMobile ? "min(210px, calc(100vw - 24px))" : 240,
          height: isMobile ? 36 : 40,
          borderRadius: 10,
          border: "1px solid rgba(4,120,87,0.35)",
          background: "rgba(255,255,255,0.94)",
          color: "white",
          fontSize: isMobile ? 12 : 13,
          cursor: "pointer",
          boxShadow: docked ? "0 2px 10px rgba(5,150,105,0.12)" : "0 2px 12px rgba(5,150,105,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          padding: isMobile ? "0 8px" : "0 10px",
          colorScheme: "light",
          borderStyle: "solid",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: isMobile ? 22 : 24,
            height: isMobile ? 22 : 24,
            borderRadius: 999,
            background: "linear-gradient(135deg, #047857 0%, #059669 50%, #10b981 100%)",
            color: "white",
            fontSize: isMobile ? 11 : 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
          aria-hidden
        >
          👤
        </span>
        <span
          style={{
            minWidth: 0,
            maxWidth: isMobile ? 140 : 160,
            color: "#065f46",
            fontWeight: 700,
            fontSize: isMobile ? 12 : 13,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "left",
          }}
          title={`${displayShop || "Tài khoản"}${email ? ` • ${email}` : ""}${loading ? " — Đang đồng bộ..." : ""}`}
        >
          {displayShop}
        </span>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: isMobile ? "min(280px, calc(100vw - 20px))" : 300,
            background: "white",
            color: "#0f172a",
            borderRadius: 14,
            padding: 12,
            border: "1px solid rgba(5,150,105,0.35)",
            boxShadow: "0 16px 40px rgba(2,6,23,0.22)",
            fontSize: 13,
            display: "grid",
            gap: 10,
            zIndex: 25,
          }}
        >
          {email ? (
            <>
              <Link
                href={shop ? `/${shop}/account` : "/account"}
                style={{
                  textAlign: "center",
                  border: "1px solid rgba(5,150,105,0.35)",
                  background: "#ecfdf5",
                  color: "#065f46",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                Tài khoản / Đổi mật khẩu
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                style={{
                  width: "100%",
                  border: "1px solid rgba(239,68,68,0.35)",
                  background: "#ef4444",
                  color: "white",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Đăng xuất
              </button>
            </>
          ) : (
            <Link
              href="/login"
              style={{
                textAlign: "center",
                border: "1px solid rgba(5,150,105,0.35)",
                background: "linear-gradient(135deg, #047857 0%, #059669 50%, #10b981 100%)",
                color: "white",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Đăng nhập
            </Link>
          )}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      {open ? (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: docked ? "fixed" : "absolute",
            inset: 0,
            zIndex: docked ? 15 : 99,
            background: "transparent",
          }}
        />
      ) : null}
      {!docked ? (
        <div style={shopTopStripStyle}>
          <div ref={rootRef} style={shellStyle}>
            {accountControls}
          </div>
        </div>
      ) : (
        <div ref={rootRef} style={shellStyle}>
          {accountControls}
        </div>
      )}
    </>
  );
}
