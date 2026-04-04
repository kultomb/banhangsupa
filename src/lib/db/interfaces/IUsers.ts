import type { UserProfileClient, UserShopContext } from "@/lib/db/types";

/** Đọc hồ sơ user (client — RTDB + Firestore fallback). */
export interface IUserProfileClientService {
  fetchProfile(uid: string): Promise<UserProfileClient>;
}

/** Hồ sơ shop / slug phía server (Firestore + RTDB hiện tại). */
export interface IUserShopServerService {
  resolveUserShopContext(uid: string): Promise<UserShopContext>;
  resolveUserShopSlugWithHeal(uid: string): Promise<string>;
}
