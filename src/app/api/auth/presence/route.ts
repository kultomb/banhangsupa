import { cookies } from "next/headers";

import { idTokenFromApiRequest } from "@/lib/backend/admin-api-auth";
import { getAdminAuthService } from "@/lib/db/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "ha_session_token";

/** Cập nhật `user_profiles.last_seen`. */
export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const token = idTokenFromApiRequest(request, jar.get(COOKIE_NAME)?.value ?? "");
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const decoded = await getAdminAuthService().verifyIdToken(token).catch(() => null);
    if (!decoded?.uid) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const now = Date.now();
    const admin = createSupabaseAdminClient();
    await admin
      .from("user_profiles")
      .update({ last_seen: new Date(now).toISOString() })
      .eq("id", decoded.uid);
    return new Response(JSON.stringify({ ok: true, lastSeen: now }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
