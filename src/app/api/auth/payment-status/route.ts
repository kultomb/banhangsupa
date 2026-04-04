import { cookies } from "next/headers";
import { isProfilePaidForAppAccess } from "@/lib/trial-shop";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "ha_session_token";

/**
 * Đọc paymentStatus / shopSlug từ Postgres `user_profiles`.
 */
export async function GET(request: Request) {
  let idToken = "";
  const h = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const m = h.match(/^\s*Bearer\s+(\S+)\s*$/i);
  if (m?.[1]) idToken = m[1].trim();
  if (!idToken) {
    const jar = await cookies();
    idToken = String(jar.get(COOKIE_NAME)?.value || "").trim();
  }
  if (!idToken) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: userData, error: userErr } = await admin.auth.getUser(idToken);
  if (userErr || !userData.user) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
  const uid = userData.user.id;
  const { data: row, error: rowErr } = await admin
    .from("user_profiles")
    .select("shop_slug, payment_status, payment_ref, registration_trial, upgrade_target_slug")
    .eq("id", uid)
    .maybeSingle();
  if (rowErr) {
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  const paymentStatus = String(row?.payment_status || "").trim();
  const registrationTrial = row?.registration_trial ?? null;
  const paid = isProfilePaidForAppAccess({ paymentStatus, registrationTrial });
  return Response.json({
    paid,
    paymentStatus,
    shopSlug: String(row?.shop_slug || "").trim(),
    paymentRef: String(row?.payment_ref || "").trim(),
    registrationTrial,
    upgradeTargetSlug: String(row?.upgrade_target_slug || "").trim(),
  });
}
