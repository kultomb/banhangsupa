import { cookies } from "next/headers";
import { resetLoginRateForEmail } from "@/lib/backend/login-rate-limit";
import { getAdminAuthService, getUserShopServerService } from "@/lib/db/server";
import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "ha_session_token";
const SHOP_COOKIE_NAME = "ha_shop_slug";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string; shopSlug?: string };
    const idToken = String(body?.idToken || "").trim();
    if (!idToken) {
      return new Response("Missing token", { status: 400 });
    }
    const decoded = await getAdminAuthService().verifyIdToken(idToken).catch(() => null);
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
    const isHttps = request.headers.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";

    const jar = await cookies();
    jar.set(COOKIE_NAME, idToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      // JWT (Firebase ID token hoặc Supabase access_token) ngắn hạn — cookie gần với TTL token tránh lặp 401.
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
    return new Response("OK");
  } catch {
    return new Response("Invalid request", { status: 400 });
  }
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  jar.delete(SHOP_COOKIE_NAME);
  return new Response("OK");
}
