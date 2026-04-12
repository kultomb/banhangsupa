import { getAdminAuthService } from "@/lib/db/server";
import { deleteSupabaseAccountWithRelatedRows } from "@/lib/supabase/delete-account-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Xóa tài khoản auth (Admin API). Client gửi access JWT sau khi đăng nhập.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string };
    const idToken = String(body?.idToken || "").trim();
    if (!idToken) {
      return Response.json({ error: "missing_token" }, { status: 400 });
    }
    const decoded = await getAdminAuthService().verifyIdToken(idToken).catch(() => null);
    if (!decoded?.uid) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }

    await deleteSupabaseAccountWithRelatedRows(decoded.uid);

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[delete-account]", e);
    // Không trả message nội bộ ra client (info leak).
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
