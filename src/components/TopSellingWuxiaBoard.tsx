"use client";

import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type WuxiaProduct = {
  name: string;
  sold: number;
};

type TopSellingWuxiaBoardProps = {
  products: WuxiaProduct[];
  period?: string;
  className?: string;
  style?: React.CSSProperties;
};

type RankTheme = {
  title: string;
  color: string;
  glow: string;
  gradFrom: string;
  gradTo: string;
  badge: string;
  trackBg: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Rank theme map
// ─────────────────────────────────────────────────────────────────────────────

function getRankTheme(rank: number): RankTheme {
  if (rank === 1)
    return {
      title: "Thiên Phẩm",
      color: "#FACC15",
      glow: "rgba(250,204,21,0.5)",
      gradFrom: "#FACC15",
      gradTo: "#F59E0B",
      badge: "👑",
      trackBg: "rgba(250,204,21,0.08)",
    };
  if (rank === 2)
    return {
      title: "Thần Phẩm",
      color: "#F87171",
      glow: "rgba(168,85,247,0.5)",
      gradFrom: "#EF4444",
      gradTo: "#A855F7",
      badge: "⚔️",
      trackBg: "rgba(239,68,68,0.07)",
    };
  if (rank === 3)
    return {
      title: "Huyền Phẩm",
      color: "#60A5FA",
      glow: "rgba(59,130,246,0.5)",
      gradFrom: "#3B82F6",
      gradTo: "#06B6D4",
      badge: "⚡",
      trackBg: "rgba(59,130,246,0.07)",
    };
  if (rank <= 5)
    return {
      title: "Ngọc Phẩm",
      color: "#4ADE80",
      glow: "rgba(34,197,94,0.35)",
      gradFrom: "#22C55E",
      gradTo: "#10B981",
      badge: "💎",
      trackBg: "rgba(34,197,94,0.06)",
    };
  return {
    title: "Thép Phẩm",
    color: "#9CA3AF",
    glow: "rgba(156,163,175,0.2)",
    gradFrom: "#9CA3AF",
    gradTo: "#6B7280",
    badge: "",
    trackBg: "rgba(156,163,175,0.05)",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spirit animal SVGs — lightweight, embedded inline
// ─────────────────────────────────────────────────────────────────────────────

function DragonSvg() {
  return (
    <svg
      viewBox="0 0 160 56"
      fill="none"
      aria-hidden="true"
      style={{
        position: "absolute",
        right: -8,
        top: "50%",
        transform: "translateY(-50%)",
        width: 130,
        height: 46,
        pointerEvents: "none",
      }}
    >
      {/* Body */}
      <path
        d="M148 28 C128 10 96 8 68 20 C48 28 28 34 12 28"
        stroke="#FACC15"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* Upper wing */}
      <path
        d="M88 20 L72 2 L104 18"
        stroke="#FACC15"
        strokeWidth="1.8"
        fill="rgba(250,204,21,0.12)"
        strokeLinejoin="round"
      />
      {/* Lower wing */}
      <path
        d="M88 22 L72 40 L104 24"
        stroke="#FACC15"
        strokeWidth="1.8"
        fill="rgba(250,204,21,0.10)"
        strokeLinejoin="round"
      />
      {/* Head */}
      <ellipse cx="148" cy="28" rx="8" ry="6" fill="rgba(250,204,21,0.18)" stroke="#FACC15" strokeWidth="1.5" />
      <circle cx="151" cy="26" r="2" fill="#FACC15" />
      {/* Horns */}
      <path d="M147 22 L144 16" stroke="#FACC15" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M151 22 L154 16" stroke="#FACC15" strokeWidth="1.2" strokeLinecap="round" />
      {/* Tail curl */}
      <path d="M12 28 C4 24 2 16 6 10" stroke="#FACC15" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      {/* Scales */}
      <path d="M60 22 L64 16 L68 22" stroke="#FACC15" strokeWidth="1" opacity="0.45" />
      <path d="M76 19 L80 13 L84 19" stroke="#FACC15" strokeWidth="1" opacity="0.35" />
      <path d="M112 14 L116 8 L120 14" stroke="#FACC15" strokeWidth="1" opacity="0.3" />
      {/* Fire breath */}
      <path d="M155 26 C162 22 166 18 164 14" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <path d="M155 28 C163 28 168 24 166 20" stroke="#FACC15" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

function PhoenixSvg() {
  return (
    <svg
      viewBox="0 0 160 60"
      fill="none"
      aria-hidden="true"
      style={{
        position: "absolute",
        right: -4,
        top: "50%",
        transform: "translateY(-50%)",
        width: 130,
        height: 48,
        pointerEvents: "none",
      }}
    >
      {/* Left wing */}
      <path d="M80 30 C60 12 30 15 16 28" stroke="#EF4444" strokeWidth="2.2" fill="rgba(239,68,68,0.08)" strokeLinecap="round" />
      <path d="M80 34 C56 48 24 44 16 28" stroke="#A855F7" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Wing feathers left */}
      <path d="M48 18 L38 6 L46 20" stroke="#EF4444" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M34 24 L22 12 L32 26" stroke="#F87171" strokeWidth="1" strokeLinecap="round" />
      {/* Right wing */}
      <path d="M80 30 C100 12 130 15 144 28" stroke="#EF4444" strokeWidth="2.2" fill="rgba(239,68,68,0.08)" strokeLinecap="round" />
      <path d="M80 34 C104 48 136 44 144 28" stroke="#A855F7" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Wing feathers right */}
      <path d="M112 18 L122 6 L114 20" stroke="#EF4444" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M126 24 L138 12 L128 26" stroke="#F87171" strokeWidth="1" strokeLinecap="round" />
      {/* Body */}
      <ellipse cx="80" cy="32" rx="12" ry="8" fill="rgba(239,68,68,0.15)" stroke="#EF4444" strokeWidth="1.5" />
      {/* Head */}
      <circle cx="80" cy="22" r="6" fill="rgba(239,68,68,0.18)" stroke="#EF4444" strokeWidth="1.5" />
      {/* Crest */}
      <path d="M80 16 L78 8 M80 16 L83 8 M80 16 L80 6" stroke="#FACC15" strokeWidth="1.2" strokeLinecap="round" />
      {/* Eye */}
      <circle cx="82" cy="21" r="1.5" fill="#FACC15" />
      {/* Tail plumes */}
      <path d="M74 38 L65 54 M80 40 L80 56 M86 38 L95 54" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M71 40 L60 52 M89 40 L100 52" stroke="#A855F7" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function SwordSvg() {
  return (
    <svg
      viewBox="0 0 160 60"
      fill="none"
      aria-hidden="true"
      style={{
        position: "absolute",
        right: -4,
        top: "50%",
        transform: "translateY(-50%)",
        width: 120,
        height: 45,
        pointerEvents: "none",
      }}
    >
      <defs>
        <linearGradient id="wuxiaSwordGrad" x1="148" y1="6" x2="24" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#60A5FA" />
          <stop offset="1" stopColor="#1D4ED8" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* Blade */}
      <path d="M148 6 L24 54" stroke="url(#wuxiaSwordGrad)" strokeWidth="3" strokeLinecap="round" />
      {/* Edge shine */}
      <path d="M146 8 L24 54" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeLinecap="round" />
      {/* Crossguard */}
      <path d="M74 37 L54 28 M74 37 L54 46" stroke="#3B82F6" strokeWidth="2.2" strokeLinecap="round" />
      {/* Hilt */}
      <rect x="48" y="44" width="14" height="7" rx="2.5" fill="rgba(59,130,246,0.25)" stroke="#60A5FA" strokeWidth="1.2" />
      <line x1="55" y1="44" x2="55" y2="51" stroke="#93C5FD" strokeWidth="1" />
      {/* Sword aura / energy wisps */}
      <path d="M130 12 C136 20 138 26 134 32" stroke="#06B6D4" strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
      <path d="M116 18 C122 26 124 32 120 38" stroke="#3B82F6" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      <path d="M100 26 C105 32 107 37 103 43" stroke="#06B6D4" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      {/* Tip glow */}
      <circle cx="148" cy="6" r="4" fill="rgba(255,255,255,0.3)" />
      <circle cx="148" cy="6" r="2" fill="white" opacity="0.8" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress bar with shine animation
// ─────────────────────────────────────────────────────────────────────────────

function WuxiaBar({
  pct,
  theme,
  animate,
}: {
  pct: number;
  theme: RankTheme;
  animate: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        height: 9,
        borderRadius: 99,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: animate ? `${pct}%` : "0%",
          borderRadius: 99,
          background: `linear-gradient(90deg, ${theme.gradFrom}, ${theme.gradTo})`,
          boxShadow: `0 0 10px ${theme.glow}`,
          transition: "width 1.3s cubic-bezier(0.22, 1, 0.36, 1)",
          overflow: "hidden",
        }}
      >
        <div className="wuxia-bar-shine" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single product row
// ─────────────────────────────────────────────────────────────────────────────

function ProductRow({
  product,
  rank,
  maxSold,
  animate,
}: {
  product: WuxiaProduct;
  rank: number;
  maxSold: number;
  animate: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const theme = getRankTheme(rank);
  const pct = maxSold > 0 ? Math.round((product.sold / maxSold) * 100) : 0;
  const isTop3 = rank <= 3;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: "11px 13px",
        borderRadius: 12,
        border: `1px solid ${hovered ? theme.color : "rgba(255,255,255,0.07)"}`,
        background: hovered ? theme.trackBg : rank === 1 ? "rgba(250,204,21,0.03)" : "transparent",
        transition: "border-color 0.22s, background 0.22s, box-shadow 0.22s",
        boxShadow: hovered ? `0 0 22px ${theme.glow}` : "none",
        marginBottom: 6,
        overflow: "hidden",
        cursor: "default",
      }}
    >
      {/* Spirit animal — top 3 only */}
      {isTop3 && (
        <div
          className={rank === 1 ? "wuxia-dragon" : rank === 2 ? "wuxia-phoenix" : "wuxia-sword"}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {rank === 1 && <DragonSvg />}
          {rank === 2 && <PhoenixSvg />}
          {rank === 3 && <SwordSvg />}
        </div>
      )}

      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, position: "relative" }}>
        {/* Rank badge */}
        <div
          style={{
            flexShrink: 0,
            width: 34,
            height: 34,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1.5px solid ${theme.color}`,
            background: `radial-gradient(circle, ${theme.glow} 0%, transparent 70%)`,
            boxShadow: `0 0 ${hovered ? 18 : 10}px ${theme.glow}`,
            fontSize: 13,
            fontWeight: 800,
            color: theme.color,
            fontFamily: "system-ui, sans-serif",
            transition: "box-shadow 0.22s",
          }}
        >
          {rank}
        </div>

        {/* Name + title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginBottom: 1,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.045em",
                color: theme.color,
                textTransform: "uppercase",
                textShadow: hovered ? `0 0 10px ${theme.glow}` : "none",
                transition: "text-shadow 0.22s",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "calc(100% - 28px)",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {product.name}
            </span>
            {theme.badge && (
              <span style={{ fontSize: 13, flexShrink: 0 }}>{theme.badge}</span>
            )}
          </div>
          <span
            style={{
              fontSize: 10,
              color: "rgba(156,163,175,0.65)",
              letterSpacing: "0.06em",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {theme.title}
          </span>
        </div>

        {/* Sold count */}
        <div
          style={{
            flexShrink: 0,
            fontSize: rank === 1 ? 22 : rank <= 3 ? 19 : 16,
            fontWeight: 800,
            color: theme.color,
            textShadow: `0 0 ${hovered ? 20 : 10}px ${theme.glow}`,
            transition: "text-shadow 0.22s, font-size 0.22s",
            fontFamily: "'SF Pro Display', system-ui, sans-serif",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {product.sold.toLocaleString("vi-VN")}
        </div>
      </div>

      <WuxiaBar pct={pct} theme={theme} animate={animate} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS keyframes (injected once via <style>)
// ─────────────────────────────────────────────────────────────────────────────

const WUXIA_CSS = `
  .wuxia-dragon { animation: wuxiaDragonFloat 6s ease-in-out infinite; }
  .wuxia-phoenix { animation: wuxiaPhoenixPulse 5s ease-in-out infinite; }
  .wuxia-sword { animation: wuxiaSwordGlow 4s ease-in-out infinite; }

  @keyframes wuxiaDragonFloat {
    0%,100% { opacity:0.12; transform:translateY(0) translateX(0); }
    33%     { opacity:0.18; transform:translateY(-3px) translateX(2px); }
    66%     { opacity:0.10; transform:translateY(2px) translateX(-1px); }
  }
  @keyframes wuxiaPhoenixPulse {
    0%,100% { opacity:0.12; }
    50%     { opacity:0.19; filter:brightness(1.15); }
  }
  @keyframes wuxiaSwordGlow {
    0%,100% { opacity:0.13; }
    50%     { opacity:0.22; filter:brightness(1.2) drop-shadow(0 0 4px #3B82F6); }
  }
  .wuxia-bar-shine {
    position:absolute; top:0; left:-70%; width:60%; height:100%;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,0.38),transparent);
    animation:wuxiaBarShine 2.6s linear infinite;
    border-radius:99px;
  }
  @keyframes wuxiaBarShine {
    0%   { left:-70%; }
    100% { left:130%; }
  }
  .wuxia-board-enter {
    animation: wuxiaBoardFadeIn 0.5s ease both;
  }
  @keyframes wuxiaBoardFadeIn {
    from { opacity:0; transform:translateY(12px); }
    to   { opacity:1; transform:none; }
  }
  @keyframes wuxiaAmbientPulse {
    0%,100% { opacity:0.5; }
    50%     { opacity:0.8; }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export default function TopSellingWuxiaBoard({
  products,
  period,
  className = "",
  style,
}: TopSellingWuxiaBoardProps) {
  const [animate, setAnimate] = useState(false);
  const [entered, setEntered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Trigger bar fill + entrance animation on first viewport visibility
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setEntered(true);
          // Stagger bar animation after entrance
          const t = window.setTimeout(() => setAnimate(true), 120);
          io.disconnect();
          return () => window.clearTimeout(t);
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const sorted = [...products].sort((a, b) => b.sold - a.sold);
  const maxSold = sorted[0]?.sold ?? 1;

  return (
    <>
      <style>{WUXIA_CSS}</style>

      <div
        ref={ref}
        className={`${entered ? "wuxia-board-enter" : ""} ${className}`.trim()}
        style={{
          position: "relative",
          background:
            "linear-gradient(145deg, rgba(15,23,42,0.97) 0%, rgba(17,24,39,0.95) 50%, rgba(10,18,34,0.97) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: 18,
          border: "1px solid rgba(250,204,21,0.14)",
          boxShadow:
            "0 24px 64px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,255,255,0.04)",
          padding: "20px 18px 18px",
          overflow: "hidden",
          fontFamily: "system-ui, -apple-system, sans-serif",
          ...style,
        }}
      >
        {/* Top ambient glow */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -48,
            left: "25%",
            right: "25%",
            height: 90,
            background:
              "radial-gradient(ellipse, rgba(250,204,21,0.10) 0%, transparent 70%)",
            pointerEvents: "none",
            animation: "wuxiaAmbientPulse 4s ease-in-out infinite",
          }}
        />

        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 14,
            position: "relative",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 3,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "#FACC15",
                  textShadow: "0 0 18px rgba(250,204,21,0.55)",
                }}
              >
                ⚔️ Thần Binh Phổ
              </h3>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(156,163,175,0.6)",
                letterSpacing: "0.04em",
              }}
            >
              Top sản phẩm bán chạy{period ? ` · ${period}` : ""}
            </div>
          </div>

          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.09em",
              color: "rgba(250,204,21,0.65)",
              border: "1px solid rgba(250,204,21,0.2)",
              borderRadius: 6,
              padding: "3px 8px",
              background: "rgba(250,204,21,0.04)",
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            BẢNG XẾP HẠNG
          </div>
        </div>

        {/* ── Gold divider ── */}
        <div
          aria-hidden="true"
          style={{
            height: 1,
            marginBottom: 14,
            background:
              "linear-gradient(90deg, transparent 0%, rgba(250,204,21,0.35) 30%, rgba(168,85,247,0.2) 70%, transparent 100%)",
          }}
        />

        {/* ── Product list ── */}
        {sorted.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "28px 0",
              color: "rgba(156,163,175,0.4)",
              fontSize: 13,
            }}
          >
            Chưa có dữ liệu trong kỳ này
          </div>
        ) : (
          sorted.map((p, idx) => (
            <ProductRow
              key={p.name}
              product={p}
              rank={idx + 1}
              maxSold={maxSold}
              animate={animate}
            />
          ))
        )}

        {/* ── Bottom ambient ── */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: -24,
            left: "20%",
            right: "20%",
            height: 60,
            background:
              "radial-gradient(ellipse, rgba(59,130,246,0.08) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />
      </div>
    </>
  );
}
