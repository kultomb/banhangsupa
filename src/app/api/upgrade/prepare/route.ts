import { getShopPaths } from "@/lib/backend/shop-paths";
import { normalizeShopSlug, resolveUserShopContext } from "@/lib/backend/userShopSlug";
import { randomBytes } from "crypto";
import {
  getTrialShopPrefix,
  isEffectiveTrialAccount,
  productionSlugFromTrialSlug,
} from "@/lib/trial-shop";

import { adminDb } from "@/lib/backend/server";
import { getDbProvider } from "@/lib/db/provider";
import { upgradePreparePostgres } from "@/lib/supabase/upgrade-prepare-pg";
import { getAdminAuthService } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createUpgradePaymentRef(targetSlug: string) {
  const slugPart = String(targetSlug || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8)
    .padEnd(4, "X");
  const nonce = randomBytes(8).toString("hex").toUpperCase();
  return `PAY-${slugPart}-${nonce}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string };
    const idToken = String(body?.idToken || "").trim();

    if (!idToken) {
      return Response.json({ error: "missing_token" }, { status: 400 });
    }

    const decoded = await getAdminAuthService().verifyIdToken(idToken).catch(() => null);
    if (!decoded?.uid) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }
    const uid = decoded.uid;

    const ctx = await resolveUserShopContext(uid);
    const fromSlug = ctx.shopSlug;
    const p = getTrialShopPrefix();
    if (!fromSlug || !isEffectiveTrialAccount(ctx.registrationTrial, fromSlug, p)) {
      return Response.json({ error: "not_trial" }, { status: 403 });
    }

    const targetSlug = normalizeShopSlug(productionSlugFromTrialSlug(fromSlug, p));
    if (!/^[a-z0-9-]{3,30}$/.test(targetSlug)) {
      return Response.json({ error: "slug_too_short_after_strip" }, { status: 400 });
    }
    if (targetSlug.startsWith(`${p}-`)) {
      return Response.json({ error: "no_trial_prefix" }, { status: 400 });
    }
    if (targetSlug === fromSlug) {
      return Response.json({ error: "same_slug" }, { status: 400 });
    }

    if (getDbProvider() === "supabase") {
      const r = await upgradePreparePostgres({ uid, ctx, createPaymentRef: createUpgradePaymentRef });
      if ("error" in r) {
        return Response.json({ error: r.error }, { status: r.status });
      }
      return Response.json({
        ok: true,
        fromSlug: r.fromSlug,
        targetSlug: r.targetSlug,
        paymentRef: r.paymentRef,
        email: r.email,
      });
    }

    const db = adminDb();
    const [shopSnap, trialSnap] = await Promise.all([
      db.ref(getShopPaths(targetSlug, false).shop).get(),
      db.ref(getShopPaths(targetSlug, true).shop).get(),
    ]);
    if (shopSnap.exists() || trialSnap.exists()) {
      return Response.json({ error: "slug_taken" }, { status: 409 });
    }

    const userSnap = await db.ref(`users/${uid}`).get();
    const u = (userSnap.val() || {}) as { email?: string };
    const paymentRef = createUpgradePaymentRef(targetSlug);

    await db.ref(`users/${uid}`).update({
      paymentStatus: "pending_upgrade",
      paymentRef,
      upgradeTargetSlug: targetSlug,
      upgradeFromSlug: fromSlug,
    });

    return Response.json({
      ok: true,
      fromSlug,
      targetSlug,
      paymentRef,
      email: String(u.email || "").trim(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upgrade/prepare]", msg);
    return Response.json(
      { error: "server_error", message: process.env.NODE_ENV !== "production" ? msg : undefined },
      { status: 500 },
    );
  }
}
