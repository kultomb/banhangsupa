import { migrateTrialShopToProduction } from "@/lib/backend/trialUpgrade";
import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
import { adminDb } from "@/lib/backend/server";
import { getDbProvider } from "@/lib/db/provider";
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

function escapeRegExp(v: string) {
  return String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contentHasExactRef(content: string, paymentRef: string) {
  const c = normalizeText(content);
  const r = normalizeText(paymentRef);
  if (!c || !r) return false;
  const rx = new RegExp(`(^|[^A-Z0-9-])${escapeRegExp(r)}([^A-Z0-9-]|$)`);
  return rx.test(c);
}

/** Ngân hàng đôi khi bỏ dấu - / khoảng trong nội dung CK — so khớp chuỗi chỉ còn A-Z0-9. */
function contentHasRefCompact(content: string, paymentRef: string) {
  const c = normalizeCompact(content);
  const r = normalizeCompact(paymentRef);
  if (!c || !r || r.length < 12) return false;
  return c.includes(r);
}

function toAmount(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function paymentAmountRequired() {
  const n = Number(
    process.env.PAYMENT_AMOUNT || process.env.NEXT_PUBLIC_PAYMENT_AMOUNT || 299000,
  );
  return Number.isFinite(n) && n > 0 ? n : 299000;
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
    /** Production: never open. Local test: set PAYMENT_WEBHOOK_ALLOW_INSECURE_LOCAL=1 explicitly. */
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

type UserPayRow = { paymentRef?: string; shopSlug?: string };

function findPaymentMatch(
  users: Record<string, UserPayRow> | null,
  paymentCode: string,
  paymentCodeCompact: string,
  transferContent: string,
  amount: number,
  required: number,
): { uid: string; matchedRef: string } | null {
  if (!users) return null;
  const candidates: Array<{ uid: string; matchedRef: string }> = [];
  Object.entries(users).forEach(([uid, value]) => {
    const payRef = normalizeText(value.paymentRef);
    const payRefCompact = normalizeCompact(payRef);
    if (!payRef) return;
    const matchedByCode = paymentCode ? paymentCode === payRef : false;
    const matchedByCodeCompact = paymentCodeCompact
      ? paymentCodeCompact === payRefCompact
      : false;
    const matchedByContent =
      contentHasExactRef(transferContent, payRef) || contentHasRefCompact(transferContent, payRef);
    if (!matchedByCode && !matchedByCodeCompact && !matchedByContent) return;
    if (amount < required) return;
    candidates.push({ uid, matchedRef: payRef });
  });
  if (candidates.length !== 1) return null;
  return candidates[0];
}

export async function POST(request: Request) {
  try {
    if (!webhookSecretOk(request)) {
      return Response.json({ success: false, reason: "unauthorized" }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as GenericWebhookPayload;
    const transferTypeLower = String(payload.transferType || "").trim().toLowerCase();
    // SePay: transferType "in" = tiền vào; "out" = đi. Rỗng/không rõ vẫn thử khớp (tránh bỏ sót).
    if (transferTypeLower === "out") {
      return Response.json({ success: true, ignored: true, reason: "not_incoming_transfer" });
    }

    const transferContent = normalizeText(
      payload.transferContent || payload.content || payload.description,
    );
    const paymentCode = normalizeText(payload.code);
    const paymentCodeCompact = normalizeCompact(paymentCode);
    const amount = toAmount(payload.transferAmount ?? payload.amount);
    const txnId = normalizeText(
      payload.id || payload.txnId || payload.referenceCode || payload.code || `NOID-${Date.now()}`,
    );

    if (!transferContent || !amount) {
      return Response.json({ success: false, reason: "missing_fields" }, { status: 400 });
    }

    const required = paymentAmountRequired();

    if (getDbProvider() === "supabase") {
      const body = await handlePaymentWebhookPostgres(
        payload,
        transferContent,
        paymentCode,
        paymentCodeCompact,
        amount,
        txnId,
        required,
      );
      return Response.json(body);
    }

    const db = adminDb();
    const ingestRef = db.ref(`paymentWebhookIngest/${txnId}`);
    const legacyEventRef = db.ref(`paymentEvents/${txnId}`);
    const [ingestSnap, legacySnap] = await Promise.all([ingestRef.get(), legacyEventRef.get()]);
    // Đã kích hoạt user (có paymentEvents) → idempotent.
    if (legacySnap.exists()) {
      return Response.json({ success: true, duplicated: true, reason: "already_credited" });
    }
    const priorIngest = ingestSnap.exists() ? (ingestSnap.val() as { outcome?: string }) : null;
    // Lần trước unmatched vẫn lưu ingest → replay SePay phải được thử khớp lại (200 trùng txnId nhưng chưa active).
    if (priorIngest?.outcome === "matched") {
      return Response.json({ success: true, duplicated: true, reason: "already_matched_ingest" });
    }

    const pendingSnap = await db.ref("users").orderByChild("paymentStatus").equalTo("pending").get();
    const upgradeSnap = await db
      .ref("users")
      .orderByChild("paymentStatus")
      .equalTo("pending_upgrade")
      .get();

    let match = findPaymentMatch(
      pendingSnap.exists() ? (pendingSnap.val() as Record<string, UserPayRow>) : null,
      paymentCode,
      paymentCodeCompact,
      transferContent,
      amount,
      required,
    );
    let isUpgrade = false;
    if (!match) {
      match = findPaymentMatch(
        upgradeSnap.exists() ? (upgradeSnap.val() as Record<string, UserPayRow>) : null,
        paymentCode,
        paymentCodeCompact,
        transferContent,
        amount,
        required,
      );
      isUpgrade = !!match;
    }

    if (!match) {
      const statusNote =
        !pendingSnap.exists() && !upgradeSnap.exists() ? "no_pending_user" : "unmatched";
      // Không ghi paymentEvents cho giao dịch không khớp thanh toán thật (dùng thử không tính tiền; tránh nhiễu audit).
      await ingestRef.set({
        receivedAt: Date.now(),
        outcome: "unmatched",
        amount,
        paymentCode,
        transferContent,
        status: statusNote,
      });
      return Response.json({
        success: true,
        matched: false,
        hint: statusNote,
        requiredAmount: required,
        receivedAmount: amount,
      });
    }

    const { uid: matchedUid, matchedRef } = match;
    const userRef = db.ref(`users/${matchedUid}`);

    if (isUpgrade) {
      const fullSnap = await userRef.get();
      const profile = (fullSnap.val() || {}) as {
        shopSlug?: string;
        upgradeTargetSlug?: string;
        email?: string;
        paymentStatus?: string;
      };
      const upgradeTo = normalizeShopSlug(String(profile.upgradeTargetSlug || ""));
      const fromSlug = normalizeShopSlug(String(profile.shopSlug || ""));
      if (
        profile.paymentStatus === "pending_upgrade" &&
        upgradeTo &&
        fromSlug &&
        upgradeTo !== fromSlug
      ) {
        await migrateTrialShopToProduction(db, {
          uid: matchedUid,
          fromSlug,
          toSlug: upgradeTo,
          ownerEmail: String(profile.email || ""),
        });
        await userRef.update({
          shopSlug: upgradeTo,
          registrationTrial: false,
          paymentStatus: "active",
          paymentPaidAt: Date.now(),
          paymentTxnId: txnId,
          paymentAmount: amount,
        });
        await userRef.child("upgradeTargetSlug").remove();
        await userRef.child("upgradeFromSlug").remove();
        await userRef.child("trialExpiresAt").remove();
      } else {
        await userRef.update({
          paymentStatus: "active",
          paymentPaidAt: Date.now(),
          paymentTxnId: txnId,
          paymentAmount: amount,
        });
      }
    } else {
      await userRef.update({
        paymentStatus: "active",
        paymentPaidAt: Date.now(),
        paymentTxnId: txnId,
        paymentAmount: amount,
      });
    }
    await legacyEventRef.set({
      receivedAt: Date.now(),
      uid: matchedUid,
      paymentRef: matchedRef,
      upgrade: isUpgrade,
      amount,
      paymentCode,
      transferContent,
      status: "matched",
    });
    await ingestRef.set({
      receivedAt: Date.now(),
      outcome: "matched",
      uid: matchedUid,
      paymentRef: matchedRef,
      upgrade: isUpgrade,
      amount,
      status: "matched",
    });

    return Response.json({ success: true, matched: true, uid: matchedUid });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[payment/webhook]", message);
    const body =
      process.env.NODE_ENV === "production"
        ? { success: false, reason: "server_error" }
        : { success: false, reason: "server_error", message };
    return Response.json(body, { status: 500 });
  }
}
