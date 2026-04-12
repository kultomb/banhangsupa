import { timingSafeEqual } from "node:crypto";
import { parseIncomingTransferAmount } from "@/lib/payment-incoming-amount";
import { PaymentWebhookProcessingError } from "@/lib/supabase/payment-webhook-errors";
import { handlePaymentWebhookPostgres } from "@/lib/supabase/payment-webhook-pg";
import { paymentWebhookBodySchema } from "@/lib/validation/payment-webhook";

/** So sánh string chống timing attack. */
function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
      // Vẫn chạy timingSafeEqual để tránh branch-timing, pad bằng cách so sánh giả.
      timingSafeEqual(ba, ba);
      return false;
    }
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function normalizeText(v: unknown) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

function normalizeCompact(v: unknown) {
  return normalizeText(v).replace(/[^A-Z0-9]/g, "");
}

/** Chỉ biến server — không dùng NEXT_PUBLIC (tránh lệch với client và không lộ trong bundle API). */
function paymentAmountRequired() {
  const n = Number(process.env.PAYMENT_AMOUNT || 299000);
  return Number.isFinite(n) && n > 0 ? n : 299000;
}

function paymentUpgradeAmountRequired() {
  const raw =
    process.env.PAYMENT_UPGRADE_AMOUNT ||
    process.env.PAYMENT_AMOUNT ||
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
    if (process.env.NODE_ENV === "production") {
      return false;
    }
    if (String(process.env.PAYMENT_WEBHOOK_ALLOW_INSECURE_LOCAL || "").trim() === "1") {
      console.warn(
        "[payment/webhook] PAYMENT_WEBHOOK_ALLOW_INSECURE_LOCAL=1 — webhook không xác thực; chỉ dùng dev.",
      );
      return true;
    }
    return false;
  }

  const authHeader = String(request.headers.get("authorization") || "").trim();
  const apikeyPrefix = "apikey ";
  const gotApiKey = authHeader.toLowerCase().startsWith(apikeyPrefix)
    ? authHeader.slice(apikeyPrefix.length).trim()
    : "";

  const gotHeader = request.headers.get("x-webhook-secret") || "";

  if (gotApiKey && expectedApiKeys.some((k) => safeEqual(k, gotApiKey))) return true;
  if (expectedSecret && safeEqual(expectedSecret, gotHeader)) return true;
  return false;
}

/** Mã giao dịch ổn định từ ngân hàng / SePay — không dùng `code` (mã CK) làm txn id. */
function resolveStableTxnId(payload: {
  id?: string | number;
  txnId?: string | number;
  referenceCode?: string | number;
  transactionId?: string | number;
  transaction_id?: string | number;
}): string {
  const raw =
    payload.id ??
    payload.txnId ??
    payload.referenceCode ??
    payload.transactionId ??
    payload.transaction_id;
  return normalizeText(raw);
}

export async function POST(request: Request) {
  try {
    if (!webhookSecretOk(request)) {
      return Response.json({ success: false, reason: "unauthorized" }, { status: 401 });
    }

    const rawJson = await request.json().catch(() => null);
    const parsed = paymentWebhookBodySchema.safeParse(rawJson);
    if (!parsed.success) {
      // Không expose validation schema ra ngoài trên production.
      const body =
        process.env.NODE_ENV === "production"
          ? { success: false, reason: "invalid_body" }
          : { success: false, reason: "invalid_body", issues: parsed.error.flatten() };
      return Response.json(body, { status: 400 });
    }
    const payload = parsed.data;

    const transferTypeLower = String(payload.transferType || "").trim().toLowerCase();
    if (transferTypeLower === "out") {
      return Response.json({ success: true, ignored: true, reason: "not_incoming_transfer" });
    }

    const txnId = resolveStableTxnId(payload);
    if (!txnId) {
      return Response.json(
        {
          success: false,
          reason: "missing_txn_id",
          message:
            "Thiếu id giao dịch ổn định (id / txnId / referenceCode / transactionId / transaction_id). Bắt buộc để chống xử lý trùng.",
        },
        { status: 400 },
      );
    }

    const transferContent = normalizeText(
      payload.transferContent || payload.content || payload.description,
    );
    const paymentCode = normalizeText(payload.code);
    const paymentCodeCompact = normalizeCompact(paymentCode);
    const amount = parseIncomingTransferAmount(payload.transferAmount ?? payload.amount);

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
    if (error instanceof PaymentWebhookProcessingError) {
      return Response.json(
        {
          success: false,
          reason: "processing",
          message: "Giao dịch đang xử lý; vui lòng retry sau.",
          txnId: error.txnId,
        },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[payment/webhook]", message);
    const respBody =
      process.env.NODE_ENV === "production"
        ? { success: false, reason: "server_error" }
        : { success: false, reason: "server_error", message };
    return Response.json(respBody, { status: 500 });
  }
}
