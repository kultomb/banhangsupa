import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

import { PaymentWebhookProcessingError } from "@/lib/supabase/payment-webhook-errors";
import type { PaymentWebhookBody } from "@/lib/validation/payment-webhook";
import { migrateTrialShopToProductionPg } from "./migrate-trial-to-production-pg";

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

function contentHasRefCompact(content: string, paymentRef: string) {
  const c = normalizeCompact(content);
  const r = normalizeCompact(paymentRef);
  if (!c || !r || r.length < 12) return false;
  return c.includes(r);
}

type UserPayRow = { id: string; payment_ref?: string | null; shop_slug?: string | null };

function findPaymentMatch(
  rows: UserPayRow[] | null,
  paymentCode: string,
  paymentCodeCompact: string,
  transferContent: string,
  amount: number,
  required: number,
): { uid: string; matchedRef: string } | null {
  if (!rows?.length) return null;
  const candidates: Array<{ uid: string; matchedRef: string }> = [];
  for (const row of rows) {
    const payRef = normalizeText(row.payment_ref);
    const payRefCompact = normalizeCompact(payRef);
    if (!payRef) continue;
    const matchedByCode = paymentCode ? paymentCode === payRef : false;
    const matchedByCodeCompact = paymentCodeCompact ? paymentCodeCompact === payRefCompact : false;
    const matchedByContent =
      contentHasExactRef(transferContent, payRef) || contentHasRefCompact(transferContent, payRef);
    if (!matchedByCode && !matchedByCodeCompact && !matchedByContent) continue;
    if (amount < required) continue;
    candidates.push({ uid: row.id, matchedRef: payRef });
  }
  if (candidates.length !== 1) return null;
  return candidates[0];
}

function isUniqueViolation(e: { code?: string; message?: string } | null) {
  if (!e) return false;
  if (e.code === "23505") return true;
  return String(e.message || "").toLowerCase().includes("duplicate key");
}

async function reserveTxnOrShortCircuit(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  txnId: string,
  reserveDetail: Record<string, unknown>,
): Promise<"reserved" | "dup_matched" | "dup_unmatched"> {
  const { error: insErr } = await admin.from("payment_webhook_ingest").insert({
    txn_id: txnId,
    outcome: "processing",
    detail: reserveDetail,
  });
  if (!insErr) return "reserved";
  if (!isUniqueViolation(insErr)) {
    console.error("[payment-webhook-pg] payment_webhook_ingest insert", insErr.message, insErr.code);
    throw new Error("payment_webhook_ingest_reserve_failed");
  }

  const { data: existing, error: readErr } = await admin
    .from("payment_webhook_ingest")
    .select("outcome")
    .eq("txn_id", txnId)
    .maybeSingle();
  if (readErr) {
    console.error("[payment-webhook-pg] payment_webhook_ingest read after conflict", readErr.message);
    throw new Error("payment_webhook_ingest_read_failed");
  }
  const oc = String(existing?.outcome || "");
  if (oc === "processing") {
    throw new PaymentWebhookProcessingError(txnId);
  }
  if (oc === "matched" || oc === "matched_upgrade" || oc === "matched_ingest") {
    return "dup_matched";
  }
  if (oc === "unmatched") {
    return "dup_unmatched";
  }
  console.error("[payment-webhook-pg] unknown outcome after conflict", oc, txnId);
  throw new Error("payment_webhook_ingest_conflict");
}

async function finalizeIngest(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  txnId: string,
  outcome: string,
  detail: Record<string, unknown>,
) {
  const { data, error } = await admin
    .from("payment_webhook_ingest")
    .update({ outcome, detail })
    .eq("txn_id", txnId)
    .eq("outcome", "processing")
    .select("txn_id")
    .maybeSingle();
  if (error) {
    console.error("[payment-webhook-pg] finalize ingest", error.message);
    throw new Error("payment_webhook_ingest_finalize_failed");
  }
  if (!data) {
    console.warn("[payment-webhook-pg] finalize no row (race or stuck state)", { txnId, outcome });
  }
}

export async function handlePaymentWebhookPostgres(
  payload: PaymentWebhookBody,
  transferContent: string,
  paymentCode: string,
  paymentCodeCompact: string,
  amount: number,
  txnId: string,
  requiredPending: number,
  requiredUpgrade: number,
): Promise<Record<string, unknown>> {
  const admin = createSupabaseAdminClient();

  const reserveDetail: Record<string, unknown> = {
    phase: "reserved",
    receivedAt: Date.now(),
    transferContent,
    amount,
    paymentCode,
    requiredPending,
    requiredUpgrade,
  };

  const reserved = await reserveTxnOrShortCircuit(admin, txnId, reserveDetail);
  if (reserved === "dup_matched") {
    return { success: true, duplicated: true, reason: "already_credited" };
  }
  if (reserved === "dup_unmatched") {
    return { success: true, matched: false, duplicated: true, hint: "unmatched" };
  }

  const { data: pendingRows, error: pendingErr } = await admin
    .from("user_profiles")
    .select("id, payment_ref, shop_slug, registration_trial")
    .eq("payment_status", "pending")
    .or("registration_trial.is.null,registration_trial.eq.false");
  if (pendingErr) {
    console.error("[payment-webhook-pg] user_profiles pending", pendingErr.message);
    throw new Error("payment_webhook_pending_query_failed");
  }

  const { data: upgradeRows, error: upgradeErr } = await admin
    .from("user_profiles")
    .select("id, payment_ref, shop_slug, upgrade_target_slug, payment_status")
    .eq("payment_status", "pending_upgrade");
  if (upgradeErr) {
    console.error("[payment-webhook-pg] user_profiles pending_upgrade", upgradeErr.message);
    throw new Error("payment_webhook_upgrade_query_failed");
  }

  let match = findPaymentMatch(
    (pendingRows || []) as UserPayRow[],
    paymentCode,
    paymentCodeCompact,
    transferContent,
    amount,
    requiredPending,
  );
  let isUpgrade = false;
  if (!match) {
    match = findPaymentMatch(
      (upgradeRows || []) as UserPayRow[],
      paymentCode,
      paymentCodeCompact,
      transferContent,
      amount,
      requiredUpgrade,
    );
    isUpgrade = !!match;
  }

  if (!match) {
    const statusNote =
      !pendingRows?.length && !upgradeRows?.length ? "no_pending_user" : "unmatched";
    await finalizeIngest(admin, txnId, "unmatched", {
      receivedAt: Date.now(),
      amount,
      paymentCode,
      transferContent,
      status: statusNote,
      requiredPending,
      requiredUpgrade,
    });
    return {
      success: true,
      matched: false,
      hint: statusNote,
      requiredAmount: requiredPending,
      requiredUpgradeAmount: requiredUpgrade,
      receivedAmount: amount,
    };
  }

  const { uid: matchedUid, matchedRef } = match;

  if (isUpgrade) {
    const { data: profile, error: profErr } = await admin
      .from("user_profiles")
      .select("shop_slug, upgrade_target_slug, email, payment_status")
      .eq("id", matchedUid)
      .maybeSingle();
    if (profErr) {
      console.error("[payment-webhook-pg] user_profiles profile", profErr.message);
      throw new Error("payment_webhook_profile_read_failed");
    }

    const upgradeTo = normalizeShopSlug(String(profile?.upgrade_target_slug || ""));
    const fromSlug = normalizeShopSlug(String(profile?.shop_slug || ""));
    if (
      profile?.payment_status === "pending_upgrade" &&
      upgradeTo &&
      fromSlug &&
      upgradeTo !== fromSlug
    ) {
      await migrateTrialShopToProductionPg({
        uid: matchedUid,
        fromSlug,
        toSlug: upgradeTo,
        ownerEmail: String(profile?.email || ""),
      });
      await admin
        .from("user_profiles")
        .update({
          shop_slug: upgradeTo,
          registration_trial: false,
          payment_status: "active",
          upgrade_target_slug: null,
          upgrade_from_slug: null,
          trial_expires_at: null,
        })
        .eq("id", matchedUid);
    } else {
      await admin
        .from("user_profiles")
        .update({ payment_status: "active" })
        .eq("id", matchedUid);
    }
  } else {
    await admin.from("user_profiles").update({ payment_status: "active" }).eq("id", matchedUid);
  }

  await finalizeIngest(admin, txnId, isUpgrade ? "matched_upgrade" : "matched", {
    receivedAt: Date.now(),
    uid: matchedUid,
    paymentRef: matchedRef,
    upgrade: isUpgrade,
    amount,
    paymentCode,
    transferContent,
    status: "matched",
  });

  return { success: true, matched: true, uid: matchedUid };
}
