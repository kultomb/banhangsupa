import "server-only";

import type { IAdminAuthService } from "@/lib/db/interfaces/IAuth";
import type { IUserShopServerService } from "@/lib/db/interfaces/IUsers";

import { SupabaseAdminAuth } from "@/lib/db/implementations/supabase/SupabaseAdminAuth";
import { SupabaseUserShopServer } from "@/lib/db/implementations/supabase/SupabaseUserShopServer";

let adminAuthSingleton: IAdminAuthService | undefined;
let userShopServerSingleton: IUserShopServerService | undefined;

export function getAdminAuthService(): IAdminAuthService {
  if (!adminAuthSingleton) {
    adminAuthSingleton = new SupabaseAdminAuth();
  }
  return adminAuthSingleton;
}

export function getUserShopServerService(): IUserShopServerService {
  if (!userShopServerSingleton) {
    userShopServerSingleton = new SupabaseUserShopServer();
  }
  return userShopServerSingleton;
}
