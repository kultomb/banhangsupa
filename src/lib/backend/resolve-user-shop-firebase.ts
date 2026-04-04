import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/backend/server";
import { getShopTableRoot } from "@/lib/backend/shop-paths";
import { normalizeShopSlug } from "@/lib/backend/shop-slug-normalize";
import { adminFirestore } from "@/lib/firebase-admin";
import type { UserShopContext } from "@/lib/db/types";

async function lazySyncFirestoreFromRtdb(uid: string, slug: string, ownerEmail: string) {
  if (!slug) return;
  try {
    const fs = adminFirestore();
    const uref = fs.collection("users").doc(uid);
    const existing = await uref.get();
    if (existing.exists) return;
    const shopRef = fs.collection("shops").doc();
    const batch = fs.batch();
    batch.set(shopRef, {
      ownerId: uid,
      slug,
      ownerEmail: ownerEmail || null,
      migratedFromRtdb: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      uref,
      {
        shopId: shopRef.id,
        shopSlug: slug,
        ownerId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
  } catch (e) {
    console.warn("[lazySyncFirestoreFromRtdb]", e);
  }
}

/**
 * Firestore (users → shopId → shops.slug) + RTDB users/{uid} + heal bảng shops.
 * Khi Firestore và RTDB lệch shopSlug: **ưu tiên RTDB** — webhook thanh toán / nâng cấp chỉ ghi RTDB;
 * Firestore có thể còn slug thử cũ → tránh ép URL /hamobile… về /try-hamobile…
 */
export async function resolveUserShopContextFirebase(uid: string): Promise<UserShopContext> {
  const snap = await adminDb().ref(`users/${uid}`).get();
  const v = (snap.val() || {}) as Record<string, unknown>;
  const rtdbSlug = normalizeShopSlug(String(v.shopSlug || ""));
  const displayRaw = String(v.shopDisplayName || v.shopName || "").trim();
  const shopDisplayName = displayRaw || null;

  const rt = v.registrationTrial;
  let registrationTrial: boolean | null = null;
  if (rt === true || rt === "true") registrationTrial = true;
  else if (rt === false || rt === "false") registrationTrial = false;

  const te = v.trialExpiresAt;
  const n = typeof te === "number" ? te : Number(te);
  const trialExpiresAt = Number.isFinite(n) && n > 0 ? n : null;
  const c = v.createdAt;
  const createdNum = typeof c === "number" ? c : Number(c);
  const createdAt = Number.isFinite(createdNum) && createdNum > 0 ? createdNum : null;

  let slug = "";
  let firestoreUserDocExists = false;

  try {
    const fs = adminFirestore();
    const udoc = await fs.collection("users").doc(uid).get();
    firestoreUserDocExists = udoc.exists;
    const ud = udoc.data();
    if (ud) {
      slug = normalizeShopSlug(String(ud.shopSlug || ""));
      const shopId = String(ud.shopId || "").trim();
      if (!slug && shopId) {
        const sdoc = await fs.collection("shops").doc(shopId).get();
        const sd = sdoc.data();
        if (String(sd?.ownerId || "") === uid) {
          slug = normalizeShopSlug(String(sd?.slug || ""));
        }
      }
    }
  } catch {
    // Firestore chưa kích hoạt hoặc lỗi — dùng RTDB.
  }

  if (!slug) {
    slug = rtdbSlug;
  } else if (rtdbSlug && normalizeShopSlug(slug) !== rtdbSlug) {
    slug = rtdbSlug;
  }

  async function healSlugFromTable(isTrial: boolean) {
    const table = getShopTableRoot(isTrial);
    const tableSnap = await adminDb().ref(table).get();
    const rows = (tableSnap.val() || {}) as Record<string, { ownerUid?: string; slug?: string }>;
    for (const [key, value] of Object.entries(rows)) {
      if (String(value?.ownerUid || "").trim() === uid) {
        const found = normalizeShopSlug(String(value?.slug || key));
        if (found) {
          await adminDb().ref(`users/${uid}/shopSlug`).set(found).catch(() => {});
        }
        return found;
      }
    }
    return "";
  }

  if (!slug) {
    slug = await healSlugFromTable(false);
    if (!slug) slug = await healSlugFromTable(true);
  }

  if (slug && !firestoreUserDocExists) {
    void lazySyncFirestoreFromRtdb(uid, slug, String(v.email || ""));
  }

  return { shopSlug: slug, shopDisplayName, registrationTrial, trialExpiresAt, createdAt };
}

export async function resolveUserShopSlugWithHealFirebase(uid: string): Promise<string> {
  const ctx = await resolveUserShopContextFirebase(uid);
  return ctx.shopSlug;
}
