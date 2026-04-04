import { requireAdminFromRequest } from "@/lib/backend/admin-api-auth";
import { adminDb } from "@/lib/backend/server";
import { resolveUserShopContext } from "@/lib/backend/userShopSlug";
import { getDbProvider } from "@/lib/db/provider";
import { getAdminAuthService } from "@/lib/db/server";
import { PRESENCE_ONLINE_MS } from "@/lib/presence-config";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isEffectiveTrialAccount } from "@/lib/trial-shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lastSeenMsFromProfile(lastSeen: string | null | undefined): number | null {
  if (!lastSeen) return null;
  const n = Date.parse(lastSeen);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request) {
  const gate = await requireAdminFromRequest(request);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const maxResults = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const pageToken = url.searchParams.get("pageToken") || undefined;

  try {
    const list = await getAdminAuthService().listUsers(maxResults, pageToken);

    if (getDbProvider() === "supabase") {
      const admin = createSupabaseAdminClient();
      const uids = list.users.map((u) => u.uid);
      const { data: profRows } =
        uids.length > 0
          ? await admin
              .from("user_profiles")
              .select("id, payment_status, last_seen")
              .in("id", uids)
          : { data: [] as { id: string; payment_status: string; last_seen: string | null }[] };
      const profById = new Map((profRows || []).map((r) => [r.id, r]));

      const users = await Promise.all(
        list.users.map(async (u) => {
          const ctx = await resolveUserShopContext(u.uid);
          const slug = ctx.shopSlug || "";
          const isTrial = isEffectiveTrialAccount(ctx.registrationTrial, slug);
          const row = profById.get(u.uid);
          const paymentStatus = String(row?.payment_status || "").trim();
          const accountType = isTrial ? "trial" : paymentStatus === "active" ? "production" : "pending_payment";
          const lastSeen = lastSeenMsFromProfile(row?.last_seen);
          const now = Date.now();
          const online = lastSeen != null && now - lastSeen <= PRESENCE_ONLINE_MS;

          return {
            uid: u.uid,
            email: u.email ?? null,
            emailVerified: u.emailVerified,
            disabled: u.disabled,
            accountType,
            paymentStatus: paymentStatus || null,
            shopName: ctx.shopDisplayName || null,
            shopSlug: slug || null,
            registrationTrial: ctx.registrationTrial,
            trialExpiresAt: ctx.trialExpiresAt,
            lastSeen,
            online,
            lastSignInTime: u.metadata.lastSignInTime || null,
            creationTime: u.metadata.creationTime || null,
          };
        }),
      );

      return new Response(
        JSON.stringify({
          users,
          pageToken: list.pageToken || null,
          viewerUid: gate.uid,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }

    const db = adminDb();

    const users = await Promise.all(
      list.users.map(async (u) => {
        const ctx = await resolveUserShopContext(u.uid);
        const slug = ctx.shopSlug || "";
        const isTrial = isEffectiveTrialAccount(ctx.registrationTrial, slug);
        const paySnap = await db.ref(`users/${u.uid}/paymentStatus`).get();
        const paymentStatus = String(paySnap.val() || "").trim();
        const accountType = isTrial ? "trial" : paymentStatus === "active" ? "production" : "pending_payment";
        const lastSnap = await db.ref(`users/${u.uid}/lastSeen`).get();
        const raw = lastSnap.val();
        const lastSeen = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
        const now = Date.now();
        const online = lastSeen != null && now - lastSeen <= PRESENCE_ONLINE_MS;

        return {
          uid: u.uid,
          email: u.email ?? null,
          emailVerified: u.emailVerified,
          disabled: u.disabled,
          accountType,
          paymentStatus: paymentStatus || null,
          shopName: ctx.shopDisplayName || null,
          shopSlug: slug || null,
          registrationTrial: ctx.registrationTrial,
          trialExpiresAt: ctx.trialExpiresAt,
          lastSeen,
          online,
          lastSignInTime: u.metadata.lastSignInTime || null,
          creationTime: u.metadata.creationTime || null,
        };
      }),
    );

    return new Response(
      JSON.stringify({
        users,
        pageToken: list.pageToken || null,
        viewerUid: gate.uid,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  } catch (e) {
    console.error("[admin/users]", e);
    return new Response(JSON.stringify({ error: "list_failed", message: "Không đọc được danh sách tài khoản." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
