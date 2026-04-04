/**
 * Đăng ký "dùng thử": ép tiền tố slug (mặc định try-) để dữ liệu legacy nằm
 * trial_backups/shop_try-tenban/… (dữ liệu thử) vs backups/shop_tenban/… (pro) — proxy /api/rtdb tự chọn.
 * Để tách HOÀN TOÀN khỏi CSDL production: dùng Firebase project / .env.local riêng (xem /trial).
 */
export const DEFAULT_TRIAL_PREFIX = "try";
export const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

/** Đổi prefix: cập nhật regex `shopSlug` trong firebase.database.rules.json (nhánh kích hoạt trial không qua CK). */
export function getTrialShopPrefix(): string {
  const raw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_TRIAL_SHOP_PREFIX || process.env.TRIAL_SHOP_PREFIX || ""
      : "";
  const p = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return p || DEFAULT_TRIAL_PREFIX;
}

export function normalizeShopSlugInput(value: string): string {
  const ascii = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d");
  return ascii
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Gộp try-try-…-x → chỉ một lần tiền tố (tránh nhập lặp). */
/**
 * Xác định tài khoản có được coi là “dùng thử” cho UI và khớp /api/rtdb.
 * - registrationTrial === true → luôn trial
 * - registrationTrial === false → luôn production
 * - chưa set → suy từ tiền tố slug (tương thích bản ghi cũ)
 */
export function isEffectiveTrialAccount(
  registrationTrial: boolean | null | undefined,
  shopSlug: string,
  prefix?: string,
): boolean {
  const p = prefix ?? getTrialShopPrefix();
  const slugLooksTrial = shopSlug.startsWith(`${p}-`);
  if (registrationTrial === true) return true;
  if (registrationTrial === false) return false;
  return slugLooksTrial;
}

/** Trial bootstrap Postgres: pending + registration_trial — vẫn vào được POS (không kẹt payment-required). */
export function isProfilePaidForAppAccess(params: {
  paymentStatus: string;
  registrationTrial: boolean | null | undefined;
}): boolean {
  const ps = String(params.paymentStatus || "").trim();
  if (ps === "active") return true;
  if (ps === "pending_upgrade") return true;
  if (ps === "pending" && params.registrationTrial === true) return true;
  return false;
}

/**
 * Chuẩn hóa hạn dùng thử:
 * - Ưu tiên `trialExpiresAt` nếu có.
 * - Nếu có `createdAt`, chặn vượt quá window dùng thử chuẩn (3 ngày) để tránh dữ liệu cũ 7 ngày.
 */
export function getEffectiveTrialExpiresAt(
  trialExpiresAt: number | null | undefined,
  createdAt?: number | null | undefined,
): number | null {
  const te = Number(trialExpiresAt);
  const ce = Number(createdAt);
  const hasTe = Number.isFinite(te) && te > 0;
  const hasCe = Number.isFinite(ce) && ce > 0;
  if (!hasTe && !hasCe) return null;
  if (hasTe && !hasCe) return te;
  const cap = ce + TRIAL_DURATION_MS;
  if (!hasTe) return cap;
  return Math.min(te, cap);
}

/** Giữ sessionStorage sau login / redirect để UI trial không “mất” giữa các lần tải. */
export function syncTrialUiSessionFlag(profile: {
  shopSlug: string;
  registrationTrial?: boolean | null;
}): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const eff = isEffectiveTrialAccount(profile.registrationTrial ?? null, profile.shopSlug);
    sessionStorage.setItem("ha_ui_trial", eff ? "1" : "0");
  } catch (_) {}
}

export function collapseRepeatedTrialPrefix(slug: string, prefix: string): string {
  const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(${p}-)+`, "i");
  return slug.replace(re, `${prefix}-`);
}

/** Nếu isTrial: đảm bảo đúng một tiền tố {prefix}- */
export function applyTrialPrefixToSlug(rawSlug: string, isTrial: boolean): string {
  if (!isTrial) return normalizeShopSlugInput(rawSlug);
  const p = getTrialShopPrefix();
  let slug = normalizeShopSlugInput(rawSlug);
  slug = collapseRepeatedTrialPrefix(slug, p);
  if (!slug.startsWith(`${p}-`)) {
    slug = normalizeShopSlugInput(`${p}-${slug}`);
  } else {
    slug = normalizeShopSlugInput(slug);
  }
  return collapseRepeatedTrialPrefix(slug, p);
}

/**
 * Slug production mặc định khi nâng cấp: bỏ một lần tiền tố {prefix}- (vd try-haha → haha).
 */
export function productionSlugFromTrialSlug(trialSlug: string, prefix?: string): string {
  const p = (prefix ?? getTrialShopPrefix()).toLowerCase();
  let s = normalizeShopSlugInput(trialSlug);
  const pref = `${p}-`;
  if (s.startsWith(pref)) {
    s = normalizeShopSlugInput(s.slice(pref.length));
  }
  return s;
}
