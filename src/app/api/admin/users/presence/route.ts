import { requireAdminFromRequest } from "@/lib/backend/admin-api-auth";
import { PRESENCE_ONLINE_MS } from "@/lib/presence-config";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UIDS = 500;

/**
 * Đọc lastSeen (RTDB hoặc user_profiles.last_seen) — refresh online/offline admin.
 */
export async function GET(request: Request) {
  const gate = await requireAdminFromRequest(request);
  if (!gate.ok) return gate.response;

  const raw = new URL(request.url).searchParams.get("uids") || "";
  const uids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_UIDS);

  if (uids.length === 0) {
    return new Response(JSON.stringify({ presence: {} }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  try {
    const now = Date.now();
    const presence: Record<string, { lastSeen: number | null; online: boolean }> = {};

    const admin = createSupabaseAdminClient();
    const { data: rows } = await admin.from("user_profiles").select("id, last_seen").in("id", uids);
    const byId = new Map((rows || []).map((r) => [r.id, r.last_seen]));
    for (const uid of uids) {
      const iso = byId.get(uid) as string | null | undefined;
      const n = iso ? Date.parse(iso) : NaN;
      const lastSeen = Number.isFinite(n) ? n : null;
      presence[uid] = {
        lastSeen,
        online: lastSeen != null && now - lastSeen <= PRESENCE_ONLINE_MS,
      };
    }

    return new Response(JSON.stringify({ presence }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    console.error("[admin/users/presence]", e);
    return new Response(JSON.stringify({ error: "presence_failed" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
