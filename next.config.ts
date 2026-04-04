import type { NextConfig } from "next";

/**
 * Chuẩn hóa www ↔ apex: xem `src/middleware.ts` (bỏ qua `/api/*` để tránh mất Bearer/cookie khi redirect).
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  /**
   * `next dev` + tunnel (ngrok, cloudflared, …): HMR WebSocket gửi Origin là host tunnel.
   * Không khai báo → console lỗi web-socket.js / treo tải dev. Wildcard theo CSRF helper của Next.
   * Thêm host cố định: NEXT_DEV_EXTRA_ORIGINS=host1.example.com,host2.example.com
   */
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.ngrok.app",
    "*.ngrok-free.dev",
    "*.trycloudflare.com",
    "*.loca.lt",
    ...(process.env.NEXT_DEV_EXTRA_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ],
  async redirects() {
    return [
      /** Lỗi đánh máy phổ biến — tránh [shop] coi "upgarde" là slug cửa hàng → 404. */
      { source: "/upgarde", destination: "/upgrade", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
