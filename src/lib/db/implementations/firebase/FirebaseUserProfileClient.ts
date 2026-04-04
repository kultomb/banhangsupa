import { doc, getDoc } from "firebase/firestore";
import { get, ref } from "firebase/database";

import { db, rtdb } from "@/lib/firebase";
import type { IUserProfileClientService } from "@/lib/db/interfaces/IUsers";
import type { UserProfileClient } from "@/lib/db/types";

const FIRESTORE_PROFILE_CAP_MS = 3500;
const RTDB_PROFILE_CAP_MS = 8000;

function raceCap<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(onTimeout), ms);
    }),
  ]);
}

async function fetchShopSlugFromFirestore(uid: string): Promise<string> {
  try {
    const usnap = await getDoc(doc(db, "users", uid));
    if (!usnap.exists()) return "";
    const d = usnap.data();
    let shopSlug = String(d.shopSlug || "").trim();
    const shopId = String(d.shopId || "").trim();
    if (!shopSlug && shopId) {
      const ssnap = await getDoc(doc(db, "shops", shopId));
      if (ssnap.exists()) {
        const sd = ssnap.data();
        if (String(sd.ownerId || "") === uid) {
          shopSlug = String(sd.slug || "").trim();
        }
      }
    }
    return shopSlug;
  } catch {
    return "";
  }
}

export class FirebaseUserProfileClient implements IUserProfileClientService {
  async fetchProfile(uid: string): Promise<UserProfileClient> {
    const v = await raceCap(
      get(ref(rtdb, `users/${uid}`))
        .then((snap) => (snap.val() || {}) as Record<string, unknown>)
        .catch(() => ({} as Record<string, unknown>)),
      RTDB_PROFILE_CAP_MS,
      {} as Record<string, unknown>,
    );

    const rt = v.registrationTrial;
    const registrationTrial =
      rt === true || rt === "true" ? true : rt === false || rt === "false" ? false : null;

    const ps = String(v.paymentStatus || "").trim();
    let shopSlug = String(v.shopSlug || "").trim();

    if (!shopSlug) {
      shopSlug = String(
        await raceCap(fetchShopSlugFromFirestore(uid), FIRESTORE_PROFILE_CAP_MS, ""),
      ).trim();
    }

    const displayRaw = String(v.shopDisplayName || v.shopName || "").trim();
    const te = v.trialExpiresAt;
    const n = typeof te === "number" ? te : Number(te);
    const trialExpiresAtMs = Number.isFinite(n) && n > 0 ? n : null;
    const c = v.createdAt;
    const cNum = typeof c === "number" ? c : Number(c);
    const createdAtMs = Number.isFinite(cNum) && cNum > 0 ? cNum : null;

    return {
      shopSlug,
      paymentStatus: ps,
      registrationTrial,
      shopDisplayName: displayRaw,
      trialExpiresAtMs,
      createdAtMs,
      upgradeTargetSlug: String(v.upgradeTargetSlug || "").trim(),
      paymentRef: String(v.paymentRef || "").trim(),
    };
  }
}
