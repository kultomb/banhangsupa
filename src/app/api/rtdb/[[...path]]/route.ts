/**
 * Proxy RTDB cho legacy app Hangho.com (bundle POS / FirebaseStorage).
 *
 * Mô hình dữ liệu (tương đương tinh thần “Auth riêng, data trên server”):
 * - Firebase Auth: đăng nhập; cookie HttpOnly `ha_session_token` **hoặc** header `Authorization: Bearer <idToken>`
 *   (iframe legacy gửi Bearer khi một số trình duyệt không kèm cookie trong request từ iframe, dù cùng site).
 * - `users/{uid}`: hồ sơ tài khoản (shopSlug, paymentStatus, …) — không lưu toàn bộ products/orders tại đây.
 * - Dữ liệu nghiệp vụ shop: RTDB `backups/shop_{slug}/…` (pro) hoặc `trial_backups/shop_{slug}/…` (dùng thử).
 *   Client legacy vẫn gọi `/api/rtdb/backups/…`; server map trial → `trial_backups` theo hồ sơ user.
 * - GET `…/app` và `…/data`: chuẩn hóa JSON (node null / thiếu customers|products → mảng rỗng) để POS không lỗi khi RTDB trống.
 * - Client legacy gửi URL có thể kèm key cũ; server luôn ép `segments[1] = shop_{slug}` theo `users/{uid}/shopSlug`
 *   (resolve + tự ghi lại nếu chỉ tìm thấy qua `shops/` hoặc `trialShops/`) để không đọc/ghi nhầm kho.
 * - 403 JSON: `missing_shop_slug`, `trial_slug_mismatch`, `production_trial_prefix_forbidden`, `trial_expired`,
 *   `trial_backup_required`, `production_backup_required`.
 * - 400 JSON: `missing_write_version` nếu PUT `app` thiếu `meta.clientBaseWriteVersion` (số hợp lệ).
 * - 403 JSON: `delete_forbidden` — DELETE chỉ whitelist `…/snapshots/{timestamp}`.
 * - 409 JSON: `demo_seed_forbidden`; nếu transaction RTDB hủy thì trả `transaction_aborted`.
 *
 * Khác ví dụ Firestore (doc users/{uid} với field products[]): đây là RTDB + một file JSON backup; hành vi đúng
 * vẫn là: chỉ seed demo khi cloud thật sự trống và user xác nhận (xem initAsync trong app.js).
 */
import { cookies } from "next/headers";
import { adminDb } from "@/lib/backend/server";
import { getDbProvider } from "@/lib/db/provider";
import { getAdminAuthService } from "@/lib/db/server";
import { proxyPosBackupPostgres } from "@/lib/supabase/pos-backup-pg";
import { getBackupDbRoot } from "@/lib/backend/shop-paths";
import { normalizePosBackupJsonForGet } from "@/lib/backend/pos-backup-normalize";
import { liftLegacyTrialBackupToTrialBackups } from "@/lib/backend/trialUpgrade";
import { resolveUserShopContext, type UserShopContext } from "@/lib/backend/userShopSlug";
import { getEffectiveTrialExpiresAt, getTrialShopPrefix, isEffectiveTrialAccount } from "@/lib/trial-shop";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function toShallowObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.keys(value as Record<string, unknown>).reduce<Record<string, boolean>>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
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

/** Chỉ cho phép xóa từng file snapshot rolling (legacy), không xóa app/data cả nhánh. */
function isAllowedBackupDeletePath(segments: string[], allowedShopKey: string): boolean {
  if (segments.length !== 4) return false;
  const [root, shopKey, bucket, snapLeaf] = segments;
  if (root !== "backups" && root !== "trial_backups") return false;
  if (shopKey !== allowedShopKey) return false;
  if (bucket !== "snapshots") return false;
  if (!/^\d+$/.test(String(snapLeaf || ""))) return false;
  return true;
}

/** Một dòng JSON — dễ grep log hosting (uid / shop / path). */
function logRtdb(event: string, data: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ source: "rtdb_proxy", event, ts: Date.now(), ...data }));
  } catch {
    // ignore
  }
}

/** Chặn ghi demo đè dữ liệu thật (PUT app có meta.isDemoSeed). */
function shouldRejectDemoSeedOverwrite(existingVal: unknown): boolean {
  const norm = normalizePosBackupJsonForGet(existingVal) as {
    data?: { orders?: unknown };
    meta?: Record<string, unknown>;
  };
  const orders = norm?.data?.orders;
  if (Array.isArray(orders) && orders.length > 0) return true;
  const m = norm?.meta;
  if (m && String(m.cloud_initialized) === "true") return true;
  return false;
}

function stripDemoSeedFlagFromPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const meta = (value as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return value;
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const mc = copy.meta as Record<string, unknown>;
  delete mc.isDemoSeed;
  return copy;
}

/**
 * Chặn cross-mode: trial ↔ slug có tiền tố; hết hạn trial.
 * Dùng isEffectiveTrialAccount (cờ true/false ưu tiên, chưa set thì suy từ slug).
 */
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
  // Expected: backups/{shopKey}/...
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

  // Force per-user storage namespace even if old client sends stale keys like "12345".
  segments[1] = allowedShopKey;
  const pfx = getTrialShopPrefix();
  const trialUser = isEffectiveTrialAccount(userCtx.registrationTrial, userShopSlug, pfx);
  // Trial → trial_backups; pro → backups (URL client luôn backups/…)
  segments[0] = getBackupDbRoot(trialUser);
  const backupRoot = segments[0];
  // Không tin client: ép kho theo hồ sơ; chặn nếu mapping không khớp loại tài khoản (phòng sửa code sai / bypass).
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
  if (getDbProvider() === "supabase") {
    return proxyPosBackupPostgres({
      method,
      segments,
      allowedShopKey,
      trialUser,
      uid: decoded.uid,
      request,
    });
  }
  const db = adminDb();
  if (trialUser) {
    await liftLegacyTrialBackupToTrialBackups(db, allowedShopKey);
  }
  const dbRef = db.ref(targetPath);
  if (method === "GET") {
    const snap = await dbRef.get();
    const reqUrl = new URL(request.url);
    const shallow = reqUrl.searchParams.get("shallow") === "true";
    const rawVal = snap.val();
    const value = shallow ? toShallowObject(rawVal) : rawVal;
    const leaf = segments[segments.length - 1] || "";
    const payload =
      !shallow && (leaf === "app" || leaf === "data")
        ? normalizePosBackupJsonForGet(value)
        : value;
    return new Response(JSON.stringify(payload ?? null), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (method === "PUT") {
    const MAX_BODY = 6 * 1024 * 1024;
    const raw = await request.text();
    if (raw.length > MAX_BODY) {
      return jsonError(413, "payload_too_large", "Payload vượt giới hạn cho phép.");
    }
    let value: unknown = null;
    if (raw) {
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        return jsonError(400, "invalid_json", "Body không phải JSON hợp lệ.");
      }
    }
    const leaf = segments[segments.length - 1] || "";
    let valueToSet = value;
    if (leaf === "app" && value && typeof value === "object" && !Array.isArray(value)) {
      let working = value as Record<string, unknown>;
      const meta0 = working.meta;
      const clientBase =
        meta0 && typeof meta0 === "object" && !Array.isArray(meta0)
          ? (meta0 as { clientBaseWriteVersion?: unknown }).clientBaseWriteVersion
          : undefined;
      if (typeof clientBase !== "number" || !Number.isFinite(clientBase)) {
        logRtdb("MISSING_WRITE_VERSION", { uid: decoded.uid, shop: allowedShopKey, path: targetPath });
        return jsonError(
          400,
          "missing_write_version",
          "Thiếu phiên bản đồng bộ. Vui lòng tải lại trang rồi lưu lại.",
        );
      }

      const isDemoSeed = !!(
        meta0 &&
        typeof meta0 === "object" &&
        !Array.isArray(meta0) &&
        (meta0 as { isDemoSeed?: unknown }).isDemoSeed === true
      );
      if (isDemoSeed) {
        working = stripDemoSeedFlagFromPayload(working) as Record<string, unknown>;
      }

      let rejectCode: "demo_seed_forbidden" | null = null;
      let rejectServerWriteVersion = 0;
      const tx = await dbRef.transaction((current) => {
        const srvNorm = normalizePosBackupJsonForGet(current) as { meta?: Record<string, unknown> };
        const srvWrite = Number(srvNorm?.meta?.writeVersion);
        const safeSrvWrite = Number.isFinite(srvWrite) ? srvWrite : 0;
        rejectServerWriteVersion = safeSrvWrite;

        if (isDemoSeed && shouldRejectDemoSeedOverwrite(current)) {
          rejectCode = "demo_seed_forbidden";
          return;
        }
        const merged = JSON.parse(JSON.stringify(working)) as Record<string, unknown>;
        const existingMeta =
          srvNorm.meta && typeof srvNorm.meta === "object" && !Array.isArray(srvNorm.meta)
            ? { ...srvNorm.meta }
            : {};
        const incomingMeta =
          merged.meta && typeof merged.meta === "object" && !Array.isArray(merged.meta)
            ? { ...(merged.meta as Record<string, unknown>) }
            : {};
        delete incomingMeta.clientBaseWriteVersion;
        delete incomingMeta.isDemoSeed;
        incomingMeta.writeVersion = safeSrvWrite + 1;
        incomingMeta.updatedAt = Date.now();
        merged.meta = { ...existingMeta, ...incomingMeta };
        return merged;
      }, undefined, false);

      if (!tx.committed) {
        if (rejectCode === "demo_seed_forbidden") {
          logRtdb("DEMO_SEED_BLOCKED", {
            uid: decoded.uid,
            shop: allowedShopKey,
            path: targetPath,
            reason: "has_real_orders_or_cloud_initialized",
          });
          return jsonError(
            409,
            "demo_seed_forbidden",
            "Từ chối ghi dữ liệu mẫu: shop đã có dữ liệu thật (đơn hàng hoặc đã khởi tạo trên đám mây).",
          );
        }
        logRtdb("WRITE_ABORTED", {
          uid: decoded.uid,
          shop: allowedShopKey,
          path: targetPath,
          reason: "transaction_not_committed",
          clientBaseWriteVersion: clientBase,
          serverWriteVersion: rejectServerWriteVersion,
        });
        return jsonError(409, "transaction_aborted", "Giao dịch không hoàn tất. Vui lòng thử lại.");
      }

      valueToSet = tx.snapshot?.val() ?? null;
      return new Response(JSON.stringify(valueToSet ?? null), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    await dbRef.set(valueToSet);
    return new Response(JSON.stringify(valueToSet ?? null), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (method === "DELETE") {
    if (!isAllowedBackupDeletePath(segments, allowedShopKey)) {
      logRtdb("delete_forbidden", { uid: decoded.uid, shop: allowedShopKey, path: targetPath });
      return jsonError(403, "delete_forbidden", "Không được phép xóa đường dẫn này.");
    }
    logRtdb("delete", { uid: decoded.uid, shop: allowedShopKey, path: targetPath });
    await dbRef.remove();
    return new Response("null", {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return proxy(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return proxy(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return proxy(request, context);
}
