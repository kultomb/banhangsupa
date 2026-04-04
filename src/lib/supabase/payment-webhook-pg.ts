import { normalizeShopSlug } from "@/lib/backend/userShopSlug";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

import { migrateTrialShopToProductionPg } from "./migrate-trial-to-production-pg";

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

export async function handlePaymentWebhookPostgres(
  payload: GenericWebhookPayload,
  transferContent: string,
  paymentCode: string,
  paymentCodeCompact: string,
  amount: number,
  txnId: string,
  required: number,
): Promise<Record<string, unknown>> {
  const admin = createSupabaseAdminClient();

  const { data: legacyRow } = await admin
    .from("payment_webhook_ingest")
    .select("outcome")
    .eq("txn_id", txnId)
    .maybeSingle();

  if (legacyRow?.outcome === "matched" || legacyRow?.outcome === "matched_upgrade") {
    return { success: true, duplicated: true, reason: "already_credited" };
  }
  if (legacyRow?.outcome === "matched_ingest") {
    return { success: true, duplicated: true, reason: "already_matched_ingest" };
  }

  const { data: pendingRows } = await admin
    .from("user_profiles")
    .select("id, payment_ref, shop_slug, registration_trial")
    .eq("payment_status", "pending")
    .or("registration_trial.is.null,registration_trial.eq.false");

  const { data: upgradeRows } = await admin
    .from("user_profiles")
    .select("id, payment_ref, shop_slug, upgrade_target_slug, payment_status")
    .eq("payment_status", "pending_upgrade");

  let match = findPaymentMatch(
    (pendingRows || []) as UserPayRow[],
    paymentCode,
    paymentCodeCompact,
    transferContent,
    amount,
    required,
  );
  let isUpgrade = false;
  if (!match) {
    match = findPaymentMatch(
      (upgradeRows || []) as UserPayRow[],
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
      !pendingRows?.length && !upgradeRows?.length ? "no_pending_user" : "unmatched";
    await admin.from("payment_webhook_ingest").upsert({
      txn_id: txnId,
      outcome: "unmatched",
      detail: {
        receivedAt: Date.now(),
        amount,
        paymentCode,
        transferContent,
        status: statusNote,
      },
    });
    return {
      success: true,
      matched: false,
      hint: statusNote,
      requiredAmount: required,
      receivedAmount: amount,
    };
  }

  const { uid: matchedUid, matchedRef } = match;

  if (isUpgrade) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("shop_slug, upgrade_target_slug, email, payment_status")
      .eq("id", matchedUid)
      .maybeSingle();

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

  await admin.from("payment_webhook_ingest").upsert({
    txn_id: txnId,
    outcome: isUpgrade ? "matched_upgrade" : "matched",
    detail: {
      receivedAt: Date.now(),
      uid: matchedUid,
      paymentRef: matchedRef,
      upgrade: isUpgrade,
      amount,
      paymentCode,
      transferContent,
      status: "matched",
    },
  });

  return { success: true, matched: true, uid: matchedUid };
}
