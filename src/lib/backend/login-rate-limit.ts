import "server-only";

import { createHash } from "node:crypto";

import { isSupabaseDbProvider } from "@/lib/db/is-supabase-db";
import { adminFirestore } from "@/lib/firebase-admin";

const COLLECTION = "_security_login_rate";
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
 * Khi TURNSTILE_SECRET_KEY không cấu hình (dev), vẫn áp dụng rate limit.
 */
export async function recordLoginPrecheckAttempt(request: Request, email: string) {
  if (isSupabaseDbProvider()) {
    return;
  }
  const ip = clientIpFromRequest(request);
  const bucket = loginRateBucketId(ip, email);
  const fs = adminFirestore();
  const ref = fs.collection(COLLECTION).doc(bucket);
  const now = Date.now();

  const blockedUntilAfter = await fs.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() || {}) as {
      count?: number;
      windowStart?: number;
      blockedUntil?: number;
    };
    const blockedUntil = typeof data.blockedUntil === "number" ? data.blockedUntil : 0;
    if (blockedUntil > now) {
      return blockedUntil;
    }

    let windowStart = typeof data.windowStart === "number" ? data.windowStart : now;
    let count = typeof data.count === "number" ? data.count : 0;

    if (now - windowStart > WINDOW_MS) {
      windowStart = now;
      count = 0;
    }

    count += 1;
    if (count > MAX_ATTEMPTS) {
      const until = now + BLOCK_MS;
      tx.set(
        ref,
        {
          count: 0,
          windowStart: now,
          blockedUntil: until,
          updatedAt: now,
        },
        { merge: true },
      );
      return until;
    }

    tx.set(
      ref,
      {
        count,
        windowStart,
        blockedUntil: 0,
        updatedAt: now,
      },
      { merge: true },
    );
    return 0;
  });

  if (blockedUntilAfter > now) {
    throw new RateLimitBlockedError(blockedUntilAfter);
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
  if (isSupabaseDbProvider()) {
    return;
  }
  const ip = clientIpFromRequest(request);
  const bucket = loginRateBucketId(ip, email);
  try {
    await adminFirestore().collection(COLLECTION).doc(bucket).delete();
  } catch {
    // Ignore.
  }
}
