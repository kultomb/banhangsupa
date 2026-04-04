import { adminDb } from "@/lib/backend/server";
import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
import { getDbProvider } from "@/lib/db/provider";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

/** Khớp quy tắc đăng ký slug (3–30 ký tự a-z, số, gạch ngang). */
const SLUG_PATTERN = /^[a-z0-9-]{3,30}$/;

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function readShopExistsFirebase(slug: string): Promise<boolean> {
  const db = adminDb();
  const [pro, trial] = await Promise.all([
    db.ref(`shops/${slug}`).get(),
    db.ref(`trialShops/${slug}`).get(),
  ]);
  return pro.exists() || trial.exists();
}

async function readShopExistsSupabase(slug: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const [pro, trial] = await Promise.all([
    admin.from("shops").select("slug").eq("slug", slug).maybeSingle(),
    admin.from("trial_shops").select("slug").eq("slug", slug).maybeSingle(),
  ]);
  return !!(pro.data || trial.data);
}

/**
 * Có ít nhất một bản ghi shop (chính thức hoặc dùng thử).
 * Dùng trước khi render `/[shop]` để URL rác trả 404 thay vì vào shell POS.
 */
export async function rtdbShopSlugExists(rawSlug: string): Promise<boolean> {
  const slug = normalizeShopSlug(String(rawSlug || ""));
  if (!slug || !SLUG_PATTERN.test(slug)) return false;

  try {
    const read = getDbProvider() === "supabase" ? readShopExistsSupabase : readShopExistsFirebase;
    let ok = await read(slug);
    if (!ok) {
      await delay(280);
      ok = await read(slug);
    }
    return ok;
  } catch (e) {
    console.error("[rtdbShopSlugExists]", slug, e);
    return true;
  }
}
