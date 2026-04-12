import { cookies } from "next/headers";

import { idTokenFromApiRequest } from "@/lib/backend/admin-api-auth";
import { getAdminAuthService } from "@/lib/db/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "ha_session_token";

/**
 * Heartbeat mỗi 5s từ client:
 * - Cập nhật `user_profiles.last_seen`
 * - Cập nhật `device_sessions.last_seen_at` cho thiết bị này
 * - Nếu device_id không còn trong `device_sessions` (bị kick) → trả `{ kicked: true }`
 *   Client nhận được sẽ tự đăng xuất và chuyển về /login
 */
export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const token = idTokenFromApiRequest(request, jar.get(COOKIE_NAME)?.value ?? "");
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const decoded = await getAdminAuthService()
      .verifyIdToken(token)
      .catch(() => null);
    if (!decoded?.uid) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const now = Date.now();
    const admin = createSupabaseAdminClient();

    // Đọc deviceId từ body (client mới gửi JSON body)
    let deviceId = "";
    try {
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = (await request.json()) as { deviceId?: string };
        deviceId = String(body?.deviceId || "").trim().slice(0, 128);
      }
    } catch {
      // Không có body hoặc parse lỗi — bỏ qua, tương thích ngược
    }

    if (deviceId) {
      // Kiểm tra xem thiết bị có còn trong device_sessions không
      const { data: session } = await admin
        .from("device_sessions")
        .select("device_id")
        .eq("user_id", decoded.uid)
        .eq("device_id", deviceId)
        .maybeSingle();

      if (!session) {
        // Thiết bị đã bị kick (record bị xóa khi thiết bị thứ 3 đăng nhập)
        return new Response(JSON.stringify({ kicked: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      // Cập nhật last_seen_at để thiết bị không bị coi là stale
      await admin
        .from("device_sessions")
        .update({ last_seen_at: new Date(now).toISOString() })
        .eq("user_id", decoded.uid)
        .eq("device_id", deviceId);
    }

    // Luôn cập nhật last_seen trong user_profiles
    await admin
      .from("user_profiles")
      .update({ last_seen: new Date(now).toISOString() })
      .eq("id", decoded.uid);

    return new Response(JSON.stringify({ ok: true, lastSeen: now }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
