import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import {
  getTrialShopPrefix,
  isEffectiveTrialAccount,
  productionSlugFromTrialSlug,
} from "@/lib/trial-shop";

export async function upgradePreparePostgres(params: {
  uid: string;
  ctx: {
    shopSlug: string;
    registrationTrial: boolean | null;
    shopDisplayName: string | null;
    trialExpiresAt: number | null;
    createdAt: number | null;
  };
  createPaymentRef: (targetSlug: string) => string;
}): Promise<
  | { ok: true; fromSlug: string; targetSlug: string; paymentRef: string; email: string }
  | { error: string; status: number }
> {
  const { uid, ctx, createPaymentRef } = params;
  const fromSlug = ctx.shopSlug;
  const p = getTrialShopPrefix();
  if (!fromSlug || !isEffectiveTrialAccount(ctx.registrationTrial, fromSlug, p)) {
    return { error: "not_trial", status: 403 };
  }

  const targetSlug = normalizeShopSlug(productionSlugFromTrialSlug(fromSlug, p));
  if (!/^[a-z0-9-]{3,30}$/.test(targetSlug)) {
    return { error: "slug_too_short_after_strip", status: 400 };
  }
  if (targetSlug.startsWith(`${p}-`)) {
    return { error: "no_trial_prefix", status: 400 };
  }
  if (targetSlug === fromSlug) {
    return { error: "same_slug", status: 400 };
  }

  const admin = createSupabaseAdminClient();
  const { data: shopHit } = await admin.from("shops").select("slug").eq("slug", targetSlug).maybeSingle();
  const { data: trialHit } = await admin.from("trial_shops").select("slug").eq("slug", targetSlug).maybeSingle();
  if (shopHit || trialHit) {
    return { error: "slug_taken", status: 409 };
  }

  const { data: prof } = await admin.from("user_profiles").select("email").eq("id", uid).maybeSingle();
  const paymentRef = createPaymentRef(targetSlug);

  const { error } = await admin
    .from("user_profiles")
    .update({
      payment_status: "pending_upgrade",
      payment_ref: paymentRef,
      upgrade_target_slug: targetSlug,
      upgrade_from_slug: fromSlug,
    })
    .eq("id", uid);

  if (error) {
    console.error("[upgrade-prepare-pg]", error);
    return { error: "server_error", status: 500 };
  }

  return {
    ok: true,
    fromSlug,
    targetSlug,
    paymentRef,
    email: String(prof?.email || "").trim(),
  };
}
