import type { IUserProfileClientService } from "@/lib/db/interfaces/IUsers";
import type { UserProfileClient } from "@/lib/db/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

export class SupabaseUserProfileClient implements IUserProfileClientService {
  async fetchProfile(uid: string): Promise<UserProfileClient> {
    const sb = getSupabaseBrowserClient();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    // Bọc bằng Promise.race để hỗ trợ abort timeout (PostgrestBuilder không có .finally)
    const query = sb
      .from("user_profiles")
      .select(
        "shop_slug, payment_status, registration_trial, shop_display_name, trial_expires_at, created_at, upgrade_target_slug, payment_ref",
      )
      .eq("id", uid)
      .abortSignal(ctrl.signal)
      .maybeSingle();
    let res: Awaited<typeof query>;
    try {
      res = await query;
    } finally {
      clearTimeout(timer);
    }
    const { data, error } = res!;

    if (error) throw error;
    if (!data) {
      return {
        shopSlug: "",
        paymentStatus: "",
        registrationTrial: null,
        shopDisplayName: "",
        trialExpiresAtMs: null,
        createdAtMs: null,
        upgradeTargetSlug: "",
        paymentRef: "",
      };
    }

    const rt = data.registration_trial;
    const registrationTrial: boolean | null =
      rt === true ? true : rt === false ? false : null;

    const trialRaw = data.trial_expires_at;
    const trialExpiresAtMs =
      typeof trialRaw === "string" && trialRaw
        ? (() => {
            const x = Date.parse(trialRaw);
            return Number.isFinite(x) ? x : null;
          })()
        : null;
    const createdRaw = data.created_at;
    const createdAtMs =
      typeof createdRaw === "string" && createdRaw
        ? (() => {
            const x = Date.parse(createdRaw);
            return Number.isFinite(x) ? x : null;
          })()
        : null;

    return {
      shopSlug: String(data.shop_slug || "").trim(),
      paymentStatus: String(data.payment_status || "").trim(),
      registrationTrial,
      shopDisplayName: String(data.shop_display_name || "").trim(),
      trialExpiresAtMs,
      createdAtMs,
      upgradeTargetSlug: String(data.upgrade_target_slug || "").trim(),
      paymentRef: String(data.payment_ref || "").trim(),
    };
  }
}
