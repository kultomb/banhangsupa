import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { verifySupabaseJwt } from "@/lib/edge-supabase-jwt";

function adminUidSet(): Set<string> {
  return new Set(
    (process.env.ADMIN_UIDS || "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const token = request.cookies.get("ha_session_token")?.value?.trim() ?? "";

  const isAdminPath = path.startsWith("/admin") || path.startsWith("/api/admin");

  const verifySession = async (): Promise<{ sub: string; admin?: boolean } | null> => {
    const secret = (process.env.SUPABASE_JWT_SECRET || "").trim();
    return verifySupabaseJwt(token, secret);
  };

  if (!(process.env.SUPABASE_JWT_SECRET || "").trim() && process.env.NODE_ENV !== "production") {
    console.warn(
      "[middleware] SUPABASE_JWT_SECRET trống — token HS256 legacy sẽ không verify; token ES256 (Signing Keys) dùng JWKS.",
    );
  }

  // --- Chưa có token → redirect về login ngay ---
  if (!token) {
    if (path.startsWith("/api/admin")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  // --- Verify token (JWT, không cần mạng) ---
  const decoded = await verifySession();
  if (!decoded) {
    if (path.startsWith("/api/admin")) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    // Xóa cookie hết hạn để tránh vòng lặp khi Supabase refresh thành công nhưng cookie cũ vẫn được gửi
    const res = NextResponse.redirect(login);
    res.cookies.delete("ha_session_token");
    return res;
  }

  // --- Chỉ kiểm tra quyền admin cho route /admin* ---
  if (isAdminPath) {
    const isAdmin = decoded.admin === true || adminUidSet().has(decoded.sub);
    if (!isAdmin) {
      if (path.startsWith("/api/admin")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.rewrite(new URL("/admin-unauthorized", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Admin routes
    "/admin",
    "/admin/:path*",
    "/api/admin/:path*",
    // Protected app routes (có session mới vào được)
    "/account",
    "/account/:path*",
    "/upgrade",
    "/upgrade/:path*",
    "/account-embed",
    "/account-embed/:path*",
  ],
};
