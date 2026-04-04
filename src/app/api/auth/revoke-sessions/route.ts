import { adminAuth } from "@/lib/backend/server";
import { getAdminAuthService } from "@/lib/db/server";
import { getDbProvider } from "@/lib/db/provider";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thu hồi mọi phiên của user (mọi thiết bị). Gọi sau đổi/đặt lại mật khẩu khi client còn JWT hợp lệ.
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
    if (getDbProvider() === "supabase") {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.auth.admin.signOut(idToken, "global");
      if (error) {
        console.error("[revoke-sessions] supabase signOut", error);
        return Response.json({ error: "revoke_failed" }, { status: 500 });
      }
    } else {
      await adminAuth().revokeRefreshTokens(decoded.uid);
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[revoke-sessions]", e);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
