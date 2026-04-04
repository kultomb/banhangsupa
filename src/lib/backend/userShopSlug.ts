import { resolveUserShopContextFirebase, resolveUserShopSlugWithHealFirebase } from "@/lib/backend/resolve-user-shop-firebase";
import { getDbProvider } from "@/lib/db/provider";

export type { UserShopContext } from "@/lib/db/types";
export { normalizeShopSlug } from "@/lib/backend/shop-slug-normalize";

export async function resolveUserShopContext(uid: string) {
  if (getDbProvider() === "supabase") {
    const { getUserShopServerService } = await import("@/lib/db/factory-server");
    return getUserShopServerService().resolveUserShopContext(uid);
  }
  return resolveUserShopContextFirebase(uid);
}

export async function resolveUserShopSlugWithHeal(uid: string): Promise<string> {
  if (getDbProvider() === "supabase") {
    const { getUserShopServerService } = await import("@/lib/db/factory-server");
    return getUserShopServerService().resolveUserShopSlugWithHeal(uid);
  }
  return resolveUserShopSlugWithHealFirebase(uid);
}
