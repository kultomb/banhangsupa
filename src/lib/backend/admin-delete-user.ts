import { deleteSupabaseAccountWithRelatedRows } from "@/lib/supabase/delete-account-pg";

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
 * Xóa dữ liệu liên quan rồi xóa user Auth (Supabase).
 * Không cho phép actor tự xóa chính mình.
 */
export async function deleteUserAccountAndRelatedData(targetUid: string, actorUid: string): Promise<void> {
  if (targetUid === actorUid) {
    throw new AdminDeleteUserError("Không thể xóa tài khoản đang đăng nhập.", "self_delete_forbidden");
  }

  try {
    await deleteSupabaseAccountWithRelatedRows(targetUid);
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error("[admin-delete] supabase", e);
    throw new AdminDeleteUserError(err?.message || "Không xóa được tài khoản Auth.", "delete_failed");
  }
}
