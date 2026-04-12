import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

/** Khớp quy tắc đăng ký slug (3–30 ký tự a-z, số, gạch ngang). */
const SLUG_PATTERN = /^[a-z0-9-]{3,30}$/;

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function readShopExists(slug: string): Promise<boolean> {
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
    let ok = await readShopExists(slug);
    if (!ok) {
      await delay(280);
      ok = await readShopExists(slug);
    }
    return ok;
  } catch (e) {
    // Lỗi DB/mạng tạm thời → fail-open để tránh 404 oan cho shop hợp lệ.
    // Bảo mật thực sự nằm ở RequireAuth (client) + /api/rtdb (server enforce shop ownership).
    console.error("[rtdbShopSlugExists] DB error, failing open to avoid false 404:", slug, e);
    return true;
  }
}
