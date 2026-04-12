/**
 * Proxy POS backup cho legacy Hangho: client gọi `/api/rtdb/backups/…` — server map sang Postgres
 * (`pos_backups` / `trial_pos_backups`) theo hồ sơ user.
 *
 * - Auth: cookie HttpOnly `ha_session_token` hoặc `Authorization: Bearer <access_token>`.
 * - 403: missing_shop_slug, trial_slug_mismatch, production_trial_prefix_forbidden, trial_expired,
 *   trial_backup_required, production_backup_required.
 */
import { cookies } from "next/headers";
import { getAdminAuthService } from "@/lib/db/server";
import { proxyPosBackupPostgres } from "@/lib/supabase/pos-backup-pg";
import { getBackupDbRoot } from "@/lib/backend/shop-paths";
import { resolveUserShopContext, type UserShopContext } from "@/lib/backend/userShopSlug";
import { getEffectiveTrialExpiresAt, getTrialShopPrefix, isEffectiveTrialAccount } from "@/lib/trial-shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const COOKIE_NAME = "ha_session_token";

function idTokenFromRequest(request: Request, cookieValue: string): string {
  const fromCookie = String(cookieValue || "").trim();
  if (fromCookie) return fromCookie;
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const m = String(h).match(/^\s*Bearer\s+(\S+)\s*$/i);
  return m?.[1]?.trim() ?? "";
}

function normalizePathSegments(pathValue: string) {
  return pathValue
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/\.json$/i, ""));
}

function jsonError(status: number, error: string, message: string) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Một dòng JSON — bật: dev, hoặc production + RTDB_PROXY_DEBUG=1. */
function logRtdb(event: string, data: Record<string, unknown>) {
  const enabled =
    process.env.NODE_ENV !== "production" || String(process.env.RTDB_PROXY_DEBUG || "").trim() === "1";
  if (!enabled) return;
  try {
    console.log(JSON.stringify({ source: "rtdb_proxy", event, ts: Date.now(), ...data }));
  } catch {
    // ignore
  }
}

function assertTrialProductionRtdbAccess(ctx: UserShopContext): Response | null {
  const { shopSlug, registrationTrial, trialExpiresAt, createdAt } = ctx;
  if (!shopSlug) return null;

  const p = getTrialShopPrefix();
  const slugLooksTrial = shopSlug.startsWith(`${p}-`);
  const isTrial = isEffectiveTrialAccount(registrationTrial, shopSlug, p);

  if (isTrial && !slugLooksTrial) {
    return jsonError(
      403,
      "trial_slug_mismatch",
      "Tài khoản dùng thử và địa chỉ cửa hàng hiện không khớp. Hãy đăng xuất, đăng nhập lại, hoặc liên hệ hỗ trợ.",
    );
  }
  if (!isTrial && slugLooksTrial) {
    return jsonError(
      403,
      "production_trial_prefix_forbidden",
      "Tên cửa hàng không phù hợp với tài khoản đã kích hoạt. Vui lòng liên hệ hỗ trợ.",
    );
  }
  const effectiveTrialExpiresAt = getEffectiveTrialExpiresAt(trialExpiresAt, createdAt);
  if (isTrial && effectiveTrialExpiresAt != null && Date.now() > effectiveTrialExpiresAt) {
    return jsonError(
      403,
      "trial_expired",
      "Thời hạn dùng thử đã hết. Vui lòng nâng cấp tài khoản và thanh toán chuyển khoản (trang Nâng cấp → thanh toán).",
    );
  }
  return null;
}

async function proxy(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const method = request.method.toUpperCase();
  const { path } = await context.params;
  const fullPath = (path || []).join("/");

  const jar = await cookies();
  const token = idTokenFromRequest(request, jar.get(COOKIE_NAME)?.value || "");
  if (!token) {
    logRtdb("auth_missing_token", { method, path: fullPath || "/" });
    return new Response("Unauthorized", { status: 401 });
  }

  const decoded = await getAdminAuthService()
    .verifyIdToken(token)
    .catch(() => null);
  if (!decoded?.uid) {
    logRtdb("auth_invalid_token", { method, path: fullPath || "/" });
    return new Response("Unauthorized", { status: 401 });
  }
  if (!fullPath.startsWith("backups/")) {
    return new Response("Forbidden path", { status: 403 });
  }

  const segments = normalizePathSegments(fullPath);
  if (segments.length < 2 || segments[0] !== "backups") {
    return new Response("Forbidden path", { status: 403 });
  }
  const userCtx = await resolveUserShopContext(decoded.uid);
  const trialBlock = assertTrialProductionRtdbAccess(userCtx);
  if (trialBlock) return trialBlock;

  const userShopSlug = userCtx.shopSlug;
  const allowedShopKey = userShopSlug ? `shop_${userShopSlug}` : "";
  if (!allowedShopKey) {
    return jsonError(
      403,
      "missing_shop_slug",
      "Tài khoản của bạn chưa được gắn với một cửa hàng. Hãy hoàn tất bước đăng ký hoặc liên hệ hỗ trợ. Hiện chưa thể lưu hoặc tải dữ liệu bán hàng.",
    );
  }

  segments[1] = allowedShopKey;
  const pfx = getTrialShopPrefix();
  const trialUser = isEffectiveTrialAccount(userCtx.registrationTrial, userShopSlug, pfx);
  segments[0] = getBackupDbRoot(trialUser);
  const backupRoot = segments[0];
  if (trialUser && backupRoot !== "trial_backups") {
    return jsonError(
      403,
      "trial_backup_required",
      "Dữ liệu cửa hàng chưa mở được với tài khoản dùng thử này. Thử đăng nhập lại hoặc liên hệ hỗ trợ.",
    );
  }
  if (!trialUser && backupRoot !== "backups") {
    return jsonError(
      403,
      "production_backup_required",
      "Dữ liệu cửa hàng chưa mở được. Thử đăng nhập lại hoặc liên hệ hỗ trợ.",
    );
  }
  const targetPath = segments.join("/");
  logRtdb("request", {
    method,
    uid: decoded.uid,
    shop: allowedShopKey,
    path: targetPath,
    trial: trialUser,
  });

  return proxyPosBackupPostgres({
    method,
    segments,
    allowedShopKey,
    trialUser,
    uid: decoded.uid,
    request,
  });
}

function makeErrorResponse() {
  return new Response(
    JSON.stringify({ error: "internal_error", message: "Lỗi hệ thống, vui lòng thử lại." }),
    { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
}

function safeProxy(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const isGet = request.method.toUpperCase() === "GET";

  return proxy(request, context).catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err ?? "unknown");

    // Retry GET requests once — they are idempotent and safe to replay.
    // PUT body is consumed by proxy() so cannot be safely retried here.
    if (isGet) {
      logRtdb("retry_after_error", { message: msg });
      await new Promise<void>((r) => setTimeout(r, 700));
      return proxy(request, context).catch((err2: unknown) => {
        const msg2 = err2 instanceof Error ? err2.message : String(err2 ?? "unknown");
        logRtdb("unhandled_error", { message: msg2, attempt: 2 });
        return makeErrorResponse();
      });
    }

    logRtdb("unhandled_error", { message: msg });
    return makeErrorResponse();
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return safeProxy(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return safeProxy(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return safeProxy(request, context);
}
