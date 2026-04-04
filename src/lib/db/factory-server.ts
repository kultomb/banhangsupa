import "server-only";

import { getDbProvider } from "@/lib/db/provider";
import type { IAdminAuthService } from "@/lib/db/interfaces/IAuth";
import type { IUserShopServerService } from "@/lib/db/interfaces/IUsers";

import { FirebaseAdminAuth } from "@/lib/db/implementations/firebase/FirebaseAdminAuth";
import { FirebaseUserShopServer } from "@/lib/db/implementations/firebase/FirebaseUserShopServer";
import { SupabaseAdminAuth } from "@/lib/db/implementations/supabase/SupabaseAdminAuth";
import { SupabaseUserShopServer } from "@/lib/db/implementations/supabase/SupabaseUserShopServer";

let adminAuthSingleton: IAdminAuthService | undefined;
let userShopServerSingleton: IUserShopServerService | undefined;

export function getAdminAuthService(): IAdminAuthService {
  if (!adminAuthSingleton) {
    adminAuthSingleton =
      getDbProvider() === "supabase" ? new SupabaseAdminAuth() : new FirebaseAdminAuth();
  }
  return adminAuthSingleton;
}

export function getUserShopServerService(): IUserShopServerService {
  if (!userShopServerSingleton) {
    userShopServerSingleton =
      getDbProvider() === "supabase"
        ? new SupabaseUserShopServer()
        : new FirebaseUserShopServer();
  }
  return userShopServerSingleton;
}
