import { cookies } from "next/headers";
import { resetLoginRateForEmail } from "@/lib/backend/login-rate-limit";
import { getAdminAuthService, getUserShopServerService } from "@/lib/db/server";
import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "ha_session_token";
const SHOP_COOKIE_NAME = "ha_shop_slug";
const DEVICE_COOKIE_NAME = "ha_device_id";

/** Tối đa 2 thiết bị đăng nhập đồng thời. Thiết bị thứ 3 → kick thiết bị ít hoạt động nhất. */
const MAX_DEVICES = 2;
/** Phiên thiết bị không ping trong 24h → coi như offline, xóa khỏi slot trước khi đếm. */
const STALE_SESSION_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string; shopSlug?: string; deviceId?: string };
    const idToken = String(body?.idToken || "").trim();
    if (!idToken) {
      return new Response("Missing token", { status: 400 });
    }

    const decoded = await getAdminAuthService()
      .verifyIdToken(idToken)
      .catch(() => null);
    if (!decoded?.uid) {
      return new Response("Invalid token", { status: 401 });
    }

    const email = String(decoded.email || "").trim().toLowerCase();
    if (email) {
      void resetLoginRateForEmail(request, email);
    }

    const profileShopSlug = await getUserShopServerService().resolveUserShopSlugWithHeal(decoded.uid);
    const requestShopSlug = normalizeShopSlug(String(body?.shopSlug || ""));
    const shopSlug = profileShopSlug || requestShopSlug;

    /** Chỉ Secure khi thực sự HTTPS. */
    const forwarded = (request.headers.get("x-forwarded-proto") || "")
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    const isHttps = forwarded === "https";

    const jar = await cookies();
    jar.set(COOKIE_NAME, idToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 55,
    });
    if (shopSlug) {
      jar.set(SHOP_COOKIE_NAME, shopSlug, {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    const deviceId = String(body?.deviceId || "").trim().slice(0, 128);
    let kickedDeviceId: string | null = null;

    if (deviceId) {
      // Lưu deviceId vào cookie để DELETE endpoint có thể dọn record khi user logout
      jar.set(DEVICE_COOKIE_NAME, deviceId, {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });

      try {
        const admin = createSupabaseAdminClient();
        const uid = decoded.uid;
        const now = new Date().toISOString();
        const staleThreshold = new Date(Date.now() - STALE_SESSION_MS).toISOString();

        // 1. Xóa các phiên đã stale (không ping > 24h) để giải phóng slot
        await admin
          .from("device_sessions")
          .delete()
          .eq("user_id", uid)
          .lt("last_seen_at", staleThreshold);

        // 2. Upsert phiên của thiết bị này
        await admin.from("device_sessions").upsert(
          { user_id: uid, device_id: deviceId, last_seen_at: now },
          { onConflict: "user_id,device_id" },
        );

        // 3. Đếm số thiết bị đang active, sắp xếp theo last_seen_at tăng dần (ít dùng nhất đầu tiên)
        const { data: sessions } = await admin
          .from("device_sessions")
          .select("device_id, last_seen_at")
          .eq("user_id", uid)
          .order("last_seen_at", { ascending: true });

        if (sessions && sessions.length > MAX_DEVICES) {
          // 4. Kick thiết bị ít hoạt động nhất (đứng đầu danh sách), ưu tiên kick thiết bị khác
          const toKick = sessions.find((s) => s.device_id !== deviceId) ?? sessions[0];
          if (toKick && toKick.device_id !== deviceId) {
            kickedDeviceId = toKick.device_id as string;
            await admin
              .from("device_sessions")
              .delete()
              .eq("user_id", uid)
              .eq("device_id", toKick.device_id);
          }
        }
      } catch {
        // Device session management non-critical — không chặn đăng nhập
      }
    }

    return new Response(JSON.stringify({ ok: true, kickedDeviceId }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response("Invalid request", { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const jar = await cookies();
  const deviceId = jar.get(DEVICE_COOKIE_NAME)?.value ?? "";
  const token = jar.get(COOKIE_NAME)?.value ?? "";

  // Xóa record device_sessions của thiết bị này khi user chủ động logout
  if (deviceId && token) {
    try {
      const decoded = await getAdminAuthService()
        .verifyIdToken(token)
        .catch(() => null);
      if (decoded?.uid) {
        const admin = createSupabaseAdminClient();
        await admin
          .from("device_sessions")
          .delete()
          .eq("user_id", decoded.uid)
          .eq("device_id", deviceId);
      }
    } catch {
      // Non-critical
    }
  }

  jar.delete(COOKIE_NAME);
  jar.delete(SHOP_COOKIE_NAME);
  jar.delete(DEVICE_COOKIE_NAME);
  return new Response("OK");
}
