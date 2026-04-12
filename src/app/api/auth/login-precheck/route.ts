import {
  RateLimitBlockedError,
  recordLoginPrecheckAttempt,
} from "@/lib/backend/login-rate-limit";
import { verifyTurnstileToken } from "@/lib/backend/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; turnstileToken?: string };
    const email = String(body?.email || "").trim().toLowerCase();
    const turnstileToken = String(body?.turnstileToken || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }

    const secret = (process.env.TURNSTILE_SECRET_KEY || "").trim();
    if (secret) {
      const ok = await verifyTurnstileToken(turnstileToken, secret);
      if (!ok) {
        return Response.json({ ok: false, error: "captcha_failed" }, { status: 400 });
      }
    }

    try {
      await recordLoginPrecheckAttempt(request, email);
    } catch (e) {
      if (e instanceof RateLimitBlockedError) {
        const retryAfterSec = Math.max(1, Math.ceil((e.retryAt - Date.now()) / 1000));
        return Response.json(
          { ok: false, error: "too_many_attempts", retryAfterSec },
          { status: 429, headers: { "retry-after": String(retryAfterSec) } },
        );
      }
      console.error("[login-precheck] rate_limit_db_error", e);
      const ignoreRateLimitBackend =
        process.env.NODE_ENV !== "production" ||
        process.env.LOGIN_PRECHECK_IGNORE_RATE_LIMIT_ERROR === "1";
      if (ignoreRateLimitBackend) {
        return Response.json({ ok: true });
      }
      return Response.json({ ok: false, error: "server_error" }, { status: 503 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[login-precheck]", msg);
    return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
