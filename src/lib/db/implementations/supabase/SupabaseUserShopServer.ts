import { normalizeShopSlug } from "@/lib/backend/shop-slug-normalize";
import type { IUserShopServerService } from "@/lib/db/interfaces/IUsers";
import type { UserShopContext } from "@/lib/db/types";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

function toMillis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

export class SupabaseUserShopServer implements IUserShopServerService {
  async resolveUserShopContext(uid: string): Promise<UserShopContext> {
    const admin = createSupabaseAdminClient();

    const { data: profile, error: pErr } = await admin
      .from("user_profiles")
      .select(
        "shop_slug, shop_display_name, registration_trial, trial_expires_at, created_at, email",
      )
      .eq("id", uid)
      .maybeSingle();

    if (pErr) {
      console.warn("[SupabaseUserShopServer] user_profiles", pErr);
    }

    let shopSlug = normalizeShopSlug(String(profile?.shop_slug || ""));
    const shopDisplayName = String(profile?.shop_display_name || "").trim() || null;

    const rt = profile?.registration_trial;
    const registrationTrial: boolean | null =
      rt === true ? true : rt === false ? false : null;

    let trialExpiresAt = toMillis(profile?.trial_expires_at ?? null);
    const createdAt = toMillis(profile?.created_at ?? null);

    async function slugFromShopsTable(): Promise<string> {
      const { data, error } = await admin
        .from("shops")
        .select("slug")
        .eq("owner_id", uid)
        .limit(1)
        .maybeSingle();
      if (error) console.warn("[SupabaseUserShopServer] shops", error.message);
      return normalizeShopSlug(String(data?.slug || ""));
    }

    async function slugFromTrialShopsTable(): Promise<string> {
      const { data, error } = await admin
        .from("trial_shops")
        .select("slug, expires_at")
        .eq("owner_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) console.warn("[SupabaseUserShopServer] trial_shops", error.message);
      if (data?.expires_at && !trialExpiresAt) {
        trialExpiresAt = toMillis(data.expires_at);
      }
      return normalizeShopSlug(String(data?.slug || ""));
    }

    if (!shopSlug) {
      shopSlug = await slugFromShopsTable();
    }
    if (!shopSlug) {
      shopSlug = await slugFromTrialShopsTable();
    }

    if (shopSlug && profile && !normalizeShopSlug(String(profile.shop_slug || ""))) {
      const { error: healErr } = await admin
        .from("user_profiles")
        .update({ shop_slug: shopSlug })
        .eq("id", uid);
      if (healErr) console.warn("[SupabaseUserShopServer] heal shop_slug", healErr.message);
    }

    return {
      shopSlug,
      shopDisplayName,
      registrationTrial,
      trialExpiresAt,
      createdAt,
    };
  }

  async resolveUserShopSlugWithHeal(uid: string): Promise<string> {
    const ctx = await this.resolveUserShopContext(uid);
    return ctx.shopSlug;
  }
}
