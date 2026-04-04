import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeShopSlug, resolveUserShopContext } from "@/lib/backend/userShopSlug";
import { getAdminAuthService } from "@/lib/db/server";
import { isEffectiveTrialAccount } from "@/lib/trial-shop";

const SESSION_COOKIE = "ha_session_token";

/**
 * Nếu đã có phiên hợp lệ, ép URL /[shop] khớp shopSlug trong CSDL — trước khi HTML/iframe legacy chạy.
 * Tránh phụ thuộc bundle JS cũ hoặc chậm hydrate khiến /abc vẫn tải kho sai và spam ghi RTDB.
 */
export async function redirectIfShopUrlMismatch(pathShopFromUrl: string): Promise<void> {
  const raw = String(pathShopFromUrl || "").trim();
  if (!raw) return;

  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value?.trim();
    if (!token) return;

    const decoded = await getAdminAuthService().verifyIdToken(token).catch(() => null);
    if (!decoded?.uid) return;

    const ctx = await resolveUserShopContext(decoded.uid);
    const canonical = ctx.shopSlug;
    if (!canonical) return;

    let decodedSeg = raw;
    try {
      decodedSeg = decodeURIComponent(raw);
    } catch {
      // giữ raw
    }

    if (normalizeShopSlug(decodedSeg) === normalizeShopSlug(canonical)) return;

    const trialQs = isEffectiveTrialAccount(ctx.registrationTrial, canonical) ? "?trial=1" : "";
    redirect(`/${encodeURIComponent(canonical)}${trialQs}`);
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest?: unknown }).digest) : "";
    if (digest.startsWith("NEXT_REDIRECT")) throw e;
    console.error("[redirectIfShopUrlMismatch]", e);
  }
}
