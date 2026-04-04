import { applyTrialPrefixToSlug, getTrialShopPrefix, TRIAL_DURATION_MS } from "@/lib/trial-shop";
import { randomBytes } from "crypto";

import { getAdminAuthService } from "@/lib/db/server";
import { registerBootstrapPostgres } from "@/lib/supabase/register-bootstrap-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createPaymentRef(prefix: "PAY" | "DEMO", slug: string) {
  const slugPart = String(slug || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8)
    .padEnd(4, "X");
  const nonce = randomBytes(8).toString("hex").toUpperCase();
  return `${prefix}-${slugPart}-${nonce}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      idToken?: string;
      email?: string;
      shopSlugInput?: string;
      isTrial?: boolean;
    };
    const idToken = String(body?.idToken || "").trim();
    const emailTrimmed = String(body?.email || "").trim();
    const rawShop = String(body?.shopSlugInput ?? "").trim();
    const shopDisplayName = rawShop.replace(/\s+/g, " ").trim();
    const isTrial = body?.isTrial === true;

    if (!idToken) {
      return Response.json({ error: "missing_token" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      return Response.json({ error: "invalid_email" }, { status: 400 });
    }

    const decoded = await getAdminAuthService().verifyIdToken(idToken).catch(() => null);
    if (!decoded?.uid) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }
    const uid = decoded.uid;

    const slug = applyTrialPrefixToSlug(rawShop, isTrial);
    const trialPrefix = getTrialShopPrefix();

    if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
      return Response.json({ error: "invalid_shop" }, { status: 400 });
    }

    if (isTrial) {
      if (!slug.startsWith(`${trialPrefix}-`)) {
        return Response.json({ error: "invalid_shop" }, { status: 400 });
      }
      const suffix = slug.startsWith(`${trialPrefix}-`) ? slug.slice(trialPrefix.length + 1) : "";
      const core = suffix.replace(/[^a-z0-9]/gi, "");
      if (core.length < 2) {
        return Response.json({ error: "shop_name_short" }, { status: 400 });
      }
    }

    const paymentRef = createPaymentRef(isTrial ? "DEMO" : "PAY", slug);
    const trialExpiresAt = Date.now() + TRIAL_DURATION_MS;

    const r = await registerBootstrapPostgres({
      uid,
      emailTrimmed,
      slug,
      shopDisplayName,
      isTrial,
      paymentRef,
      trialExpiresAt,
    });
    if ("error" in r) {
      return Response.json(
        { error: r.error, message: r.message },
        { status: r.status },
      );
    }
    return Response.json({ ok: true, shopSlug: r.shopSlug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[register-bootstrap]", msg);
    return Response.json({ error: "server_error", message: msg }, { status: 500 });
  }
}
