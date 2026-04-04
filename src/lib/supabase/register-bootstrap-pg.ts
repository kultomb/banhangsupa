import { emptyPosAppJsonPayload } from "@/lib/backend/pos-backup-normalize";
import { getShopKey } from "@/lib/backend/shop-paths";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

function pgErrMessage(e: { message?: string; details?: string | null; hint?: string | null }) {
  return [e.message, e.hint, e.details].filter(Boolean).join(" — ");
}

export async function registerBootstrapPostgres(params: {
  uid: string;
  emailTrimmed: string;
  slug: string;
  shopDisplayName: string;
  isTrial: boolean;
  paymentRef: string;
  trialExpiresAt: number;
}): Promise<
  { ok: true; shopSlug: string } | { error: string; status: number; message?: string }
> {
  const { uid, emailTrimmed, slug, shopDisplayName, isTrial, paymentRef, trialExpiresAt } = params;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: "server_error", status: 500, message: msg };
  }

  const shopKey = getShopKey(slug);

  const { data: dupShop } = await admin.from("shops").select("slug").eq("slug", slug).maybeSingle();
  const { data: dupTrial } = await admin.from("trial_shops").select("slug").eq("slug", slug).maybeSingle();
  if (dupShop || dupTrial) {
    return { error: "shop_exists", status: 409 };
  }

  const { data: existingProfile } = await admin.from("user_profiles").select("id").eq("id", uid).maybeSingle();
  if (existingProfile) {
    return { error: "profile_exists", status: 409 };
  }

  if (isTrial) {
    // pending + registration_trial: trigger INSERT cho phép (active + trial bị chặn nếu không nhận service_role trong trigger).
    const { error: pe } = await admin.from("user_profiles").insert({
      id: uid,
      email: emailTrimmed,
      payment_status: "pending",
      payment_ref: paymentRef,
      registration_trial: true,
      trial_expires_at: new Date(trialExpiresAt).toISOString(),
      shop_display_name: shopDisplayName || null,
    });
    if (pe) {
      console.error("[register-bootstrap-pg] user_profiles", pe.message, pe.code, pe.details);
      if (pe.code === "23505") return { error: "profile_exists", status: 409 };
      return { error: "server_error", status: 500, message: pgErrMessage(pe) };
    }

    const { error: te } = await admin.from("trial_shops").insert({
      slug,
      owner_id: uid,
      display_name: shopDisplayName || null,
      owner_email: emailTrimmed,
      trial: true,
      trial_shop: true,
      created_at: new Date().toISOString(),
      expires_at: new Date(trialExpiresAt).toISOString(),
    });
    if (te) {
      console.error("[register-bootstrap-pg] trial_shops", te.message, te.code, te.details);
      if (te.code === "23505") return { error: "shop_exists", status: 409 };
      return { error: "server_error", status: 500, message: pgErrMessage(te) };
    }

    const { error: be } = await admin.from("trial_pos_backups").insert({
      shop_key: shopKey,
      data: { app: emptyPosAppJsonPayload() },
    });
    if (be) {
      console.error("[register-bootstrap-pg] trial_pos_backups", be.message, be.code, be.details);
      return { error: "server_error", status: 500, message: pgErrMessage(be) };
    }
  } else {
    const { error: pe } = await admin.from("user_profiles").insert({
      id: uid,
      email: emailTrimmed,
      payment_status: "pending",
      payment_ref: paymentRef,
      registration_trial: false,
      shop_display_name: shopDisplayName || null,
    });
    if (pe) {
      console.error("[register-bootstrap-pg] user_profiles", pe.message, pe.code, pe.details);
      if (pe.code === "23505") return { error: "profile_exists", status: 409 };
      return { error: "server_error", status: 500, message: pgErrMessage(pe) };
    }

    const { error: se } = await admin.from("shops").insert({
      slug,
      owner_id: uid,
      display_name: shopDisplayName || null,
      owner_email: emailTrimmed,
      trial_shop: false,
    });
    if (se) {
      console.error("[register-bootstrap-pg] shops", se.message, se.code, se.details);
      if (se.code === "23505") return { error: "shop_exists", status: 409 };
      return { error: "server_error", status: 500, message: pgErrMessage(se) };
    }

    const { error: be } = await admin.from("pos_backups").insert({
      shop_key: shopKey,
      data: { app: emptyPosAppJsonPayload() },
    });
    if (be) {
      console.error("[register-bootstrap-pg] pos_backups", be.message, be.code, be.details);
      return { error: "server_error", status: 500, message: pgErrMessage(be) };
    }
  }

  return { ok: true, shopSlug: slug };
}
