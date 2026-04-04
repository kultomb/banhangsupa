import { adminAuth, adminDb } from "@/lib/backend/server";
import { adminFirestore } from "@/lib/firebase-admin";
import { getShopPaths } from "@/lib/backend/shop-paths";
import { resolveUserShopContext } from "@/lib/backend/userShopSlug";
import { getDbProvider } from "@/lib/db/provider";
import { deleteSupabaseAccountWithRelatedRows } from "@/lib/supabase/delete-account-pg";
import { isEffectiveTrialAccount } from "@/lib/trial-shop";

export class AdminDeleteUserError extends Error {
  constructor(
    message: string,
    readonly code: "self_delete_forbidden" | "delete_failed",
  ) {
    super(message);
    this.name = "AdminDeleteUserError";
  }
}

/**
 * Xóa dữ liệu liên quan rồi xóa user Auth.
 * Không cho phép actor tự xóa chính mình.
 */
export async function deleteUserAccountAndRelatedData(targetUid: string, actorUid: string): Promise<void> {
  if (targetUid === actorUid) {
    throw new AdminDeleteUserError("Không thể xóa tài khoản đang đăng nhập.", "self_delete_forbidden");
  }

  const ctx = await resolveUserShopContext(targetUid);
  const slug = ctx.shopSlug;
  const isTrial = isEffectiveTrialAccount(ctx.registrationTrial, slug);

  if (getDbProvider() === "supabase") {
    try {
      await deleteSupabaseAccountWithRelatedRows(targetUid);
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error("[admin-delete] supabase", e);
      throw new AdminDeleteUserError(err?.message || "Không xóa được tài khoản Auth.", "delete_failed");
    }
    return;
  }

  const db = adminDb();

  if (slug) {
    const { shop, backup } = getShopPaths(slug, isTrial);
    await db.ref(backup).remove().catch((e) => console.warn("[admin-delete] backup", e));
    await db.ref(shop).remove().catch((e) => console.warn("[admin-delete] shop", e));
  }
  await db.ref(`users/${targetUid}`).remove().catch((e) => console.warn("[admin-delete] users", e));

  try {
    const fs = adminFirestore();
    const uref = fs.collection("users").doc(targetUid);
    const snap = await uref.get();
    if (snap.exists) {
      const shopId = String(snap.data()?.shopId || "").trim();
      if (shopId) {
        await fs.collection("shops").doc(shopId).delete().catch((e) => console.warn("[admin-delete] fs shop", e));
      }
      await uref.delete().catch((e) => console.warn("[admin-delete] fs user", e));
    }
  } catch (e) {
    console.warn("[admin-delete] firestore", e);
  }

  try {
    await adminAuth().deleteUser(targetUid);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "auth/user-not-found") return;
    console.error("[admin-delete] auth", e);
    throw new AdminDeleteUserError(err?.message || "Không xóa được tài khoản Auth.", "delete_failed");
  }
}
