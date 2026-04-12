"use client";

import { getAuthClient } from "@/lib/db";
import { isProfilePaidForAppAccess } from "@/lib/trial-shop";
import { getDeviceId } from "@/lib/device-id";

const LOGIN_REDIRECT = "/login?reason=missing-shop";

/** Tiền tố key cũ của POS legacy; build mới không ghi localStorage nhưng vẫn xóa khi đăng xuất để dọn trình duyệt. */
const LEGACY_POS_LOCAL_PREFIX = "ha_mobile_";

type ClearClientStateOptions = {
  /**
   * Giữ localStorage `ha_mobile_*` sau đổi mật khẩu: key có chứa `firebase` nên trước đây bị xóa nhầm → POS tưởng kho trống / nhảy demo.
   */
  preserveLegacyHostedPosCache?: boolean;
};

function clearClientUserState(options?: ClearClientStateOptions) {
  const preservePos = options?.preserveLegacyHostedPosCache === true;
  try {
    sessionStorage.clear();
  } catch {
    // Ignore storage permission errors.
  }

  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(LEGACY_POS_LOCAL_PREFIX)) {
        if (!preservePos) localStorage.removeItem(key);
        continue;
      }
      const normalized = key.toLowerCase().trim();
      // Only clear app-owned keys; avoid wiping Firebase SDK persistence unexpectedly.
      if (normalized.startsWith("ha_") || normalized.startsWith("hangho_")) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage permission errors.
  }
}

export function hasValidShopSlug(value?: string) {
  return Boolean(String(value || "").trim());
}

/** Chuẩn hóa segment shop trên URL để so khớp với shopSlug trong hồ sơ (chữ thường, đã decode). */
export function normalizeShopPathSegment(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    return decodeURIComponent(s).trim().toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

/** Giống `normalizeShopSlug` trên server — so khớp URL với slug trong DB (bỏ ký tự lạ). */
export function normalizeShopSlugClient(raw: string): string {
  let s = String(raw ?? "").trim();
  try {
    s = decodeURIComponent(s).trim();
  } catch {
    // giữ s
  }
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

/** Cho phép vào POS: active, chờ CK nâng cấp, hoặc trial bootstrap (pending + registration_trial). */
export function paymentAllowsAppAccess(
  paymentStatus?: string,
  registrationTrial?: boolean | null,
) {
  return isProfilePaidForAppAccess({
    paymentStatus: String(paymentStatus || ""),
    registrationTrial: registrationTrial ?? null,
  });
}

/**
 * Ghi cookie phiên HttpOnly cho `/api/rtdb` và `/legacy`. Mạng chập chờn hoặc race sau đăng nhập
 * có thể làm lần POST đầu thất bại — gọi lại vài lần giảm tình trạng đổi trình duyệt/máy vẫn lỗi tải dữ liệu.
 */
export async function postSessionCookieWithRetries(
  idToken: string,
  options?: { shopSlug?: string },
): Promise<boolean> {
  const trimmed = String(idToken || "").trim();
  if (!trimmed) return false;
  const shop = String(options?.shopSlug || "").trim();
  const deviceId = getDeviceId();
  const body = JSON.stringify({
    idToken: trimmed,
    ...(shop ? { shopSlug: shop } : {}),
    ...(deviceId ? { deviceId } : {}),
  });
  const maxAttempts = 4;
  const baseMs = 300;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const ctrl = new AbortController();
      // 6s timeout/lần — đủ cho cold start, nhưng không treo UI 20s+ khi server chậm.
      const timer = window.setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: ctrl.signal,
        });
        if (res.ok) return true;
      } finally {
        window.clearTimeout(timer);
      }
    } catch {
      // Mạng / abort — thử lại.
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, baseMs * (attempt + 1)));
    }
  }
  return false;
}

/**
 * Thu hồi mọi phiên Supabase (global signOut), rồi đăng xuất client + xóa cookie phiên app.
 * Gọi sau `confirmPasswordReset` khi user còn JWT hợp lệ.
 */
export async function revokeAllSessionsThenSignOut(): Promise<{ revokeServerOk: boolean }> {
  let revokeServerOk = false;
  const user = getAuthClient().getCurrentUser();
  if (user) {
    try {
      const idToken = await user.getIdToken(true);
      const res = await fetch("/api/auth/revoke-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      revokeServerOk = res.ok;
    } catch {
      revokeServerOk = false;
    }
    await getAuthClient().signOut().catch(() => undefined);
  } else {
    await getAuthClient().signOut().catch(() => undefined);
  }
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
  clearClientUserState({ preserveLegacyHostedPosCache: true });
  return { revokeServerOk };
}

export async function forceLogoutMissingShop(redirectUrl = LOGIN_REDIRECT) {
  try {
    await getAuthClient().signOut();
  } catch {
    // Continue cleanup even when sign-out fails.
  }

  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
  clearClientUserState();

  if (typeof window === "undefined") return;
  const target = redirectUrl;
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = target;
      return;
    }
  } catch {
    // Ignore cross-frame redirect issues.
  }
  window.location.href = target;
}
