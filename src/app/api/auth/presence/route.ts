import { cookies } from "next/headers";

import { idTokenFromApiRequest } from "@/lib/backend/admin-api-auth";
import { adminDb } from "@/lib/backend/server";
import { getDbProvider } from "@/lib/db/provider";
import { getAdminAuthService } from "@/lib/db/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "ha_session_token";

/** Cập nhật `users/{uid}/lastSeen` (RTDB) hoặc `user_profiles.last_seen` (Supabase) — admin online. */
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
    if (getDbProvider() === "supabase") {
      const admin = createSupabaseAdminClient();
      await admin
        .from("user_profiles")
        .update({ last_seen: new Date(now).toISOString() })
        .eq("id", decoded.uid);
    } else {
      await adminDb().ref(`users/${decoded.uid}/lastSeen`).set(now);
    }
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
