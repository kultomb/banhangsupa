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

  const verifySession = async (): Promise<{ sub: string; admin?: boolean } | null> => {
    const secret = (process.env.SUPABASE_JWT_SECRET || "").trim();
    if (!secret) return null;
    return verifySupabaseJwt(token, secret);
  };

  if (!(process.env.SUPABASE_JWT_SECRET || "").trim()) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[middleware] missing SUPABASE_JWT_SECRET", { path });
    }
    if (path.startsWith("/api/admin")) {
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }
    return new NextResponse(null, { status: 503 });
  }

  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[middleware] redirect login: missing session token", { path });
    }
    if (path.startsWith("/api/admin")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  const decoded = await verifySession();
  if (!decoded) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[middleware] redirect login: invalid/expired token", { path });
    }
    if (path.startsWith("/api/admin")) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  const isAdmin = decoded.admin === true || adminUidSet().has(decoded.sub);
  if (!isAdmin) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[middleware] admin access denied", { path, uid: decoded.sub });
    }
    if (path.startsWith("/api/admin")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.rewrite(new URL("/admin-unauthorized", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
