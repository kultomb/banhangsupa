import { parseIncomingTransferAmount } from "@/lib/payment-incoming-amount";
import { handlePaymentWebhookPostgres } from "@/lib/supabase/payment-webhook-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenericWebhookPayload = {
  id?: string | number;
  referenceCode?: string;
  code?: string;
  txnId?: string | number;
  transferType?: string;
  transferAmount?: number | string;
  amount?: number | string;
  content?: string;
  description?: string;
  transferContent?: string;
};

function normalizeText(v: unknown) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

function normalizeCompact(v: unknown) {
  return normalizeText(v).replace(/[^A-Z0-9]/g, "");
}

function paymentAmountRequired() {
  const n = Number(
    process.env.PAYMENT_AMOUNT || process.env.NEXT_PUBLIC_PAYMENT_AMOUNT || 299000,
  );
  return Number.isFinite(n) && n > 0 ? n : 299000;
}

/** Mức tiền cho CK nâng cấp (pending_upgrade). Mặc định = kích hoạt nếu không cấu hình riêng. */
function paymentUpgradeAmountRequired() {
  const raw =
    process.env.PAYMENT_UPGRADE_AMOUNT ||
    process.env.NEXT_PUBLIC_PAYMENT_UPGRADE_AMOUNT ||
    process.env.PAYMENT_AMOUNT ||
    process.env.NEXT_PUBLIC_PAYMENT_AMOUNT ||
    299000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : paymentAmountRequired();
}

function parseAcceptedApiKeys() {
  const raw = String(process.env.PAYMENT_WEBHOOK_API_KEY || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function webhookSecretOk(request: Request) {
  const expectedApiKeys = parseAcceptedApiKeys();
  const expectedSecret = String(process.env.PAYMENT_WEBHOOK_SECRET || "").trim();
  const hasAuth = expectedApiKeys.length > 0 || !!expectedSecret;
  if (!hasAuth) {
    const allowInsecureLocal =
      process.env.NODE_ENV !== "production" &&
      String(process.env.PAYMENT_WEBHOOK_ALLOW_INSECURE_LOCAL || "").trim() === "1";
    return allowInsecureLocal;
  }

  const authHeader = String(request.headers.get("authorization") || "").trim();
  const apikeyPrefix = "apikey ";
  const gotApiKey = authHeader.toLowerCase().startsWith(apikeyPrefix)
    ? authHeader.slice(apikeyPrefix.length).trim()
    : "";

  const gotHeader = request.headers.get("x-webhook-secret") || "";

  if (gotApiKey && expectedApiKeys.includes(gotApiKey)) return true;
  if (expectedSecret && gotHeader === expectedSecret) return true;
  return false;
}

export async function POST(request: Request) {
  try {
    if (!webhookSecretOk(request)) {
      return Response.json({ success: false, reason: "unauthorized" }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as GenericWebhookPayload;
    const transferTypeLower = String(payload.transferType || "").trim().toLowerCase();
    if (transferTypeLower === "out") {
      return Response.json({ success: true, ignored: true, reason: "not_incoming_transfer" });
    }

    const transferContent = normalizeText(
      payload.transferContent || payload.content || payload.description,
    );
    const paymentCode = normalizeText(payload.code);
    const paymentCodeCompact = normalizeCompact(paymentCode);
    const amount = parseIncomingTransferAmount(payload.transferAmount ?? payload.amount);
    const txnId = normalizeText(
      payload.id || payload.txnId || payload.referenceCode || payload.code || `NOID-${Date.now()}`,
    );

    if (!transferContent || !amount) {
      return Response.json({ success: false, reason: "missing_fields" }, { status: 400 });
    }

    const requiredPending = paymentAmountRequired();
    const requiredUpgrade = paymentUpgradeAmountRequired();

    const body = await handlePaymentWebhookPostgres(
      payload,
      transferContent,
      paymentCode,
      paymentCodeCompact,
      amount,
      txnId,
      requiredPending,
      requiredUpgrade,
    );
    return Response.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[payment/webhook]", message);
    const respBody =
      process.env.NODE_ENV === "production"
        ? { success: false, reason: "server_error" }
        : { success: false, reason: "server_error", message };
    return Response.json(respBody, { status: 500 });
  }
}
