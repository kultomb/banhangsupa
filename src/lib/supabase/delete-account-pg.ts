import { getShopKey } from "@/lib/backend/shop-paths";
import { getAdminAuthService } from "@/lib/db/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

/**
 * Xóa backup POS (không CASCADE theo auth.users), rồi xóa user Auth.
 * user_profiles / shops / trial_shops CASCADE từ auth.users — không DELETE tay.
 */
export async function deleteSupabaseAccountWithRelatedRows(uid: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const slugs = new Set<string>();

  const { data: proShops, error: proErr } = await admin.from("shops").select("slug").eq("owner_id", uid);
  if (proErr) console.warn("[delete-account-pg] shops", proErr.message);
  for (const r of proShops || []) {
    const s = String((r as { slug?: string }).slug || "").trim();
    if (s) slugs.add(s);
  }

  const { data: triShops, error: triErr } = await admin
    .from("trial_shops")
    .select("slug")
    .eq("owner_id", uid);
  if (triErr) console.warn("[delete-account-pg] trial_shops", triErr.message);
  for (const r of triShops || []) {
    const s = String((r as { slug?: string }).slug || "").trim();
    if (s) slugs.add(s);
  }

  const { data: prof, error: profErr } = await admin
    .from("user_profiles")
    .select("shop_slug")
    .eq("id", uid)
    .maybeSingle();
  if (profErr) console.warn("[delete-account-pg] user_profiles", profErr.message);
  const fromProfile = String(prof?.shop_slug || "").trim();
  if (fromProfile) slugs.add(fromProfile);

  for (const slug of slugs) {
    const shopKey = getShopKey(slug);
    const pb = await admin.from("pos_backups").delete().eq("shop_key", shopKey);
    if (pb.error) console.warn("[delete-account-pg] pos_backups", shopKey, pb.error.message);
    const tb = await admin.from("trial_pos_backups").delete().eq("shop_key", shopKey);
    if (tb.error) console.warn("[delete-account-pg] trial_pos_backups", shopKey, tb.error.message);
  }

  try {
    await getAdminAuthService().deleteUser(uid);
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    if (/not\s*found|user_not_found|User not found/i.test(m)) return;
    throw e;
  }
}
