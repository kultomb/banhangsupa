import { cookies } from "next/headers";

import { getAdminAuthService } from "@/lib/db/server";

const COOKIE_NAME = "ha_session_token";

export function parseAdminUidSet(): Set<string> {
  const raw = process.env.ADMIN_UIDS || "";
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function idTokenFromApiRequest(request: Request, cookieValue: string): string {
  const fromCookie = String(cookieValue || "").trim();
  if (fromCookie) return fromCookie;
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const m = String(h).match(/^\s*Bearer\s+(\S+)\s*$/i);
  return m?.[1]?.trim() ?? "";
}

export async function requireAdminFromRequest(request: Request): Promise<
  { ok: true; uid: string; email?: string } | { ok: false; response: Response }
> {
  const jar = await cookies();
  const token = idTokenFromApiRequest(request, jar.get(COOKIE_NAME)?.value ?? "");
  if (!token) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized", message: "Thiếu phiên đăng nhập." }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    };
  }
  const decoded = await getAdminAuthService().verifyIdToken(token).catch(() => null);
  if (!decoded?.uid) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "invalid_token", message: "Phiên không hợp lệ." }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    };
  }
  const admins = parseAdminUidSet();
  const isAdmin = decoded.admin === true || admins.has(decoded.uid);
  if (!isAdmin) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "forbidden", message: "Không đủ quyền quản trị." }), {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    };
  }
  return { ok: true, uid: decoded.uid, email: decoded.email };
}
