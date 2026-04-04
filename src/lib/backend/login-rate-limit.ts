import "server-only";

import { createHash } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 60 * 1000;

export function loginRateBucketId(clientIp: string, email: string) {
  const ip = String(clientIp || "unknown").trim() || "unknown";
  const em = String(email || "").trim().toLowerCase();
  return createHash("sha256").update(`${ip}|${em}`).digest("hex").slice(0, 48);
}

function clientIpFromRequest(request: Request) {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Gọi trước mỗi lần submit đăng nhập. Vượt quá MAX_ATTEMPTS trong WINDOW_MS → chặn BLOCK_MS.
 */
export async function recordLoginPrecheckAttempt(request: Request, email: string) {
  const admin = createSupabaseAdminClient();
  const ip = clientIpFromRequest(request);
  const bucket = loginRateBucketId(ip, email);
  const now = Date.now();

  const { data: row, error: readErr } = await admin
    .from("login_rate_buckets")
    .select("count, window_start, blocked_until")
    .eq("id", bucket)
    .maybeSingle();

  if (readErr) {
    console.warn("[login-rate-limit] read", readErr.message);
    return;
  }

  const data = row as { count?: number; window_start?: number; blocked_until?: number } | null;
  let blockedUntil = typeof data?.blocked_until === "number" ? data.blocked_until : 0;
  if (blockedUntil > now) {
    throw new RateLimitBlockedError(blockedUntil);
  }

  let windowStart = typeof data?.window_start === "number" ? data.window_start : now;
  let count = typeof data?.count === "number" ? data.count : 0;

  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    count = 0;
  }

  count += 1;
  let newBlockedUntil = 0;
  let nextCount = count;
  let nextWindowStart = windowStart;

  if (count > MAX_ATTEMPTS) {
    newBlockedUntil = now + BLOCK_MS;
    nextCount = 0;
    nextWindowStart = now;
  }

  const { error: upsertErr } = await admin.from("login_rate_buckets").upsert(
    {
      id: bucket,
      count: nextCount,
      window_start: nextWindowStart,
      blocked_until: newBlockedUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (upsertErr) {
    console.warn("[login-rate-limit] upsert", upsertErr.message);
    return;
  }

  if (newBlockedUntil > now) {
    throw new RateLimitBlockedError(newBlockedUntil);
  }
}

export class RateLimitBlockedError extends Error {
  readonly retryAt: number;
  constructor(retryAt: number) {
    super("rate_limited");
    this.name = "RateLimitBlockedError";
    this.retryAt = retryAt;
  }
}

export async function resetLoginRateForEmail(request: Request, email: string) {
  const admin = createSupabaseAdminClient();
  const ip = clientIpFromRequest(request);
  const bucket = loginRateBucketId(ip, email);
  try {
    const { error } = await admin.from("login_rate_buckets").delete().eq("id", bucket);
    if (error) console.warn("[login-rate-limit] delete", error.message);
  } catch {
    // Ignore.
  }
}
