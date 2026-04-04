import { getShopKey } from "@/lib/backend/shop-paths";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

/**
 * Tương đương migrateTrialShopToProduction (RTDB): copy backup trial → pro, stub trial_shops, tạo shops.
 */
export async function migrateTrialShopToProductionPg(params: {
  uid: string;
  fromSlug: string;
  toSlug: string;
  ownerEmail: string;
}): Promise<void> {
  const { uid, fromSlug, toSlug, ownerEmail } = params;
  const admin = createSupabaseAdminClient();
  const fromKey = getShopKey(fromSlug);
  const toKey = getShopKey(toSlug);

  const { data: trialRow } = await admin
    .from("trial_pos_backups")
    .select("id, data")
    .eq("shop_key", fromKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let tree: Record<string, unknown> = {};
  if (trialRow?.data && typeof trialRow.data === "object" && !Array.isArray(trialRow.data)) {
    tree = trialRow.data as Record<string, unknown>;
  } else {
    const { data: proLegacy } = await admin
      .from("pos_backups")
      .select("data")
      .eq("shop_key", fromKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (proLegacy?.data && typeof proLegacy.data === "object" && !Array.isArray(proLegacy.data)) {
      tree = proLegacy.data as Record<string, unknown>;
    }
  }

  await admin.from("pos_backups").insert({ shop_key: toKey, data: tree });

  await admin.from("trial_pos_backups").delete().eq("shop_key", fromKey);
  await admin.from("pos_backups").delete().eq("shop_key", fromKey);

  await admin
    .from("trial_shops")
    .update({ upgraded_to: toSlug })
    .eq("slug", fromSlug)
    .eq("owner_id", uid);

  await admin.from("shops").insert({
    slug: toSlug,
    owner_id: uid,
    owner_email: String(ownerEmail || "").trim(),
    display_name: null,
    trial_shop: false,
  });
}
