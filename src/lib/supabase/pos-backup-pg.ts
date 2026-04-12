import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePosBackupJsonForGet } from "@/lib/backend/pos-backup-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

/**
 * Retry a Supabase call up to 3 attempts on transient failure.
 * Handles both Supabase-returned { error } and thrown exceptions (network-level).
 * Delays: 450ms → 1000ms between attempts.
 */
async function withRetry<T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> {
  const delays = [450, 1000];
  let last: T | undefined;
  for (let i = 0; i <= delays.length; i++) {
    try {
      const result = await fn();
      if (!result.error) return result;
      last = result;
    } catch (err) {
      // Network-level throw (rare with supabase-js but possible on cold starts)
      if (i === delays.length) throw err;
    }
    if (i < delays.length) {
      await new Promise<void>((r) => setTimeout(r, delays[i]));
    }
  }
  return last!;
}

export type PosBackupTable = "pos_backups" | "trial_pos_backups";

/**
 * Module-level row ID cache.
 * Vercel reuses warm containers for ~1-5 min — skipping the SELECT query saves ~100-200ms per request.
 * Key: `${table}::${shopKey}`, value: { id, cachedAt }.
 */
const _rowIdCache = new Map<string, { id: string; cachedAt: number }>();
const ROW_CACHE_TTL_MS = 60_000; // 1 min

function getCachedId(table: PosBackupTable, shopKey: string): string | null {
  const c = _rowIdCache.get(`${table}::${shopKey}`);
  return c && Date.now() - c.cachedAt < ROW_CACHE_TTL_MS ? c.id : null;
}

function setCachedId(table: PosBackupTable, shopKey: string, id: string) {
  _rowIdCache.set(`${table}::${shopKey}`, { id, cachedAt: Date.now() });
}

function clearCachedId(table: PosBackupTable, shopKey: string) {
  _rowIdCache.delete(`${table}::${shopKey}`);
}

function getDeep(obj: unknown, path: string[]): unknown {
  let x: unknown = obj;
  for (const p of path) {
    if (x == null || typeof x !== "object" || Array.isArray(x)) return undefined;
    x = (x as Record<string, unknown>)[p];
  }
  return x;
}

function setDeep(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  if (path.length === 0) return copy;
  let x: Record<string, unknown> = copy;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    const next = x[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      x[k] = {};
    }
    x = x[k] as Record<string, unknown>;
  }
  x[path[path.length - 1]] = value as never;
  return copy;
}

function deleteDeep(obj: Record<string, unknown>, path: string[]): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  if (path.length === 0) return {};
  let x: Record<string, unknown> = copy;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    const next = x[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) return copy;
    x = next as Record<string, unknown>;
  }
  delete x[path[path.length - 1]];
  return copy;
}

function toShallowObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.keys(value as Record<string, unknown>).reduce<Record<string, boolean>>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
}

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

async function getLatestRow(admin: SupabaseClient, table: PosBackupTable, shopKey: string) {
  // Fast path: if we have a cached row ID (warm container), use PK lookup (O(1) vs index scan)
  const cachedId = getCachedId(table, shopKey);
  if (cachedId) {
    const fast = await withRetry(() =>
      admin.from(table).select("id, data").eq("id", cachedId).maybeSingle(),
    );
    if (!fast.error && fast.data) return fast.data as { id: string; data: Record<string, unknown> };
    clearCachedId(table, shopKey); // stale or deleted — fall through
  }

  const res = await withRetry(() =>
    admin
      .from(table)
      .select("id, data")
      .eq("shop_key", shopKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (res.error) throw res.error;
  if (res.data) setCachedId(table, shopKey, (res.data as { id: string }).id);
  return res.data as { id: string; data: Record<string, unknown> } | null;
}

async function ensureBackupRow(
  admin: SupabaseClient,
  table: PosBackupTable,
  shopKey: string,
  initialTree: Record<string, unknown>,
) {
  const row = await getLatestRow(admin, table, shopKey);
  if (row) return row;
  // Wrap INSERT with retry — concurrent first-visit requests can cause transient conflicts
  const res = await withRetry(() =>
    admin
      .from(table)
      .insert({ shop_key: shopKey, data: initialTree })
      .select("id, data")
      .single(),
  );
  if (res.error) {
    // Another concurrent request may have already inserted — try reading again
    const fallback = await getLatestRow(admin, table, shopKey);
    if (fallback) return fallback;
    throw res.error;
  }
  const inserted = res.data as { id: string; data: Record<string, unknown> };
  setCachedId(table, shopKey, inserted.id);
  return inserted;
}

export async function liftLegacyTrialBackupToTrialBackupsPg(admin: SupabaseClient, shopKey: string) {
  try {
    const trial = await getLatestRow(admin, "trial_pos_backups", shopKey);
    if (trial) return;
    const pro = await getLatestRow(admin, "pos_backups", shopKey);
    if (!pro) return;
    await admin.from("trial_pos_backups").insert({ shop_key: shopKey, data: pro.data });
    await admin.from("pos_backups").delete().eq("id", pro.id);
  } catch {
    // Non-critical migration step — log and continue rather than blocking the request.
    console.warn("[pos-backup-pg] liftLegacyTrialBackup failed (non-fatal)");
  }
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

export async function proxyPosBackupPostgres(params: {
  method: string;
  segments: string[];
  /** shop_try-foo */
  allowedShopKey: string;
  trialUser: boolean;
  uid: string;
  request: Request;
}): Promise<Response> {
  const { method, segments, allowedShopKey, trialUser, uid, request } = params;
  const table: PosBackupTable = trialUser ? "trial_pos_backups" : "pos_backups";
  const admin = createSupabaseAdminClient();
  const sub = segments.slice(2);
  const leaf = segments[segments.length - 1] || "";

  if (trialUser) {
    await liftLegacyTrialBackupToTrialBackupsPg(admin, allowedShopKey);
  }

  if (method === "GET") {
    const row = await ensureBackupRow(admin, table, allowedShopKey, {});
    const tree = (row.data || {}) as Record<string, unknown>;
    const reqUrl = new URL(request.url);
    const shallow = reqUrl.searchParams.get("shallow") === "true";
    const rawVal = sub.length === 0 ? tree : getDeep(tree, sub);
    const value = shallow ? toShallowObject(rawVal) : rawVal;
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

    if (leaf === "app" && value && typeof value === "object" && !Array.isArray(value)) {
      let working = value as Record<string, unknown>;
      const meta0 = working.meta;
      const clientBase =
        meta0 && typeof meta0 === "object" && !Array.isArray(meta0)
          ? (meta0 as { clientBaseWriteVersion?: unknown }).clientBaseWriteVersion
          : undefined;
      if (typeof clientBase !== "number" || !Number.isFinite(clientBase)) {
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

      const row = await ensureBackupRow(admin, table, allowedShopKey, {});
      const tree = { ...((row.data || {}) as Record<string, unknown>) };
      const currentApp = tree.app;
      const srvNorm = normalizePosBackupJsonForGet(currentApp) as { meta?: Record<string, unknown> };
      const srvWrite = Number(srvNorm?.meta?.writeVersion);
      const safeSrvWrite = Number.isFinite(srvWrite) ? srvWrite : 0;

      if (isDemoSeed && shouldRejectDemoSeedOverwrite(currentApp)) {
        return jsonError(
          409,
          "demo_seed_forbidden",
          "Từ chối ghi dữ liệu mẫu: shop đã có dữ liệu thật (đơn hàng hoặc đã khởi tạo trên đám mây).",
        );
      }

      if (clientBase !== safeSrvWrite) {
        return jsonError(409, "transaction_aborted", "Giao dịch không hoàn tất. Vui lòng thử lại.");
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
      tree.app = merged;

      const { error } = await withRetry(() => admin.from(table).update({ data: tree }).eq("id", row.id));
      if (error) {
        return jsonError(500, "write_failed", "Không ghi được CSDL.");
      }
      setCachedId(table, allowedShopKey, row.id); // refresh cache TTL after successful write

      // Broadcast new version for real-time sync across devices (fire-and-forget, non-blocking)
      void admin.from("pos_version_log").upsert(
        { shop_key: allowedShopKey, write_version: safeSrvWrite + 1, updated_at: new Date().toISOString() },
        { onConflict: "shop_key" },
      );

      return new Response(JSON.stringify(merged ?? null), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    const row = await ensureBackupRow(admin, table, allowedShopKey, {});
    const tree = { ...((row.data || {}) as Record<string, unknown>) };
    const next =
      sub.length === 0 ? (value as Record<string, unknown>) : setDeep(tree, sub, value ?? null);
    const { error } = await withRetry(() => admin.from(table).update({ data: next }).eq("id", row.id));
    if (error) return jsonError(500, "write_failed", "Không ghi được CSDL.");
    const written = sub.length === 0 ? next : getDeep(next, sub);
    return new Response(JSON.stringify(written ?? null), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (method === "DELETE") {
    if (segments.length !== 4) {
      return jsonError(403, "delete_forbidden", "Không được phép xóa đường dẫn này.");
    }
    const [, sk, bucket, snapLeaf] = segments;
    if (sk !== allowedShopKey || bucket !== "snapshots" || !/^\d+$/.test(String(snapLeaf || ""))) {
      return jsonError(403, "delete_forbidden", "Không được phép xóa đường dẫn này.");
    }
    const row = await getLatestRow(admin, table, allowedShopKey);
    if (!row) {
      return new Response("null", {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const tree = { ...((row.data || {}) as Record<string, unknown>) };
    const snaps = { ...((tree.snapshots as Record<string, unknown>) || {}) };
    delete snaps[String(snapLeaf)];
    tree.snapshots = snaps;
    const { error } = await withRetry(() => admin.from(table).update({ data: tree }).eq("id", row.id));
    if (error) return jsonError(500, "delete_failed", "Không xóa được.");
    return new Response("null", {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
