/**
 * Kiểu dùng chung giữa Firebase / Supabase (không phụ thuộc SDK).
 */

export type AuthSessionUser = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type DecodedIdToken = {
  uid: string;
  email?: string;
  admin?: boolean;
};

export type PasswordResetActionSettings = {
  url: string;
  handleCodeInApp?: boolean;
};

export type UserProfileClient = {
  shopSlug: string;
  paymentStatus: string;
  registrationTrial: boolean | null;
  shopDisplayName: string;
  trialExpiresAtMs: number | null;
  createdAtMs: number | null;
  upgradeTargetSlug: string;
  paymentRef: string;
};

export type UserShopContext = {
  shopSlug: string;
  shopDisplayName: string | null;
  registrationTrial: boolean | null;
  trialExpiresAt: number | null;
  createdAt: number | null;
};

/** Bản ghi user trả về khi list admin (tối giản, đủ cho API hiện tại). */
export type ListedAuthUser = {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  metadata: {
    lastSignInTime?: string;
    creationTime?: string;
  };
};

export type ListUsersResult = {
  users: ListedAuthUser[];
  pageToken?: string;
};

/** Giữ chỗ — app hiện tại không có catalog sản phẩm Firestore. */
export type Product = { id: string };
export type ProductFilters = Record<string, unknown>;
export type CreateProductInput = Record<string, unknown>;

export type Order = { id: string };
export type CreateOrderInput = Record<string, unknown>;

export type Cart = { id: string };
