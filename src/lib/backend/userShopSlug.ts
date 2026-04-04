import { getUserShopServerService } from "@/lib/db/server";

export type { UserShopContext } from "@/lib/db/types";
export { normalizeShopSlug } from "@/lib/backend/shop-slug-normalize";

export async function resolveUserShopContext(uid: string) {
  return getUserShopServerService().resolveUserShopContext(uid);
}

export async function resolveUserShopSlugWithHeal(uid: string): Promise<string> {
  return getUserShopServerService().resolveUserShopSlugWithHeal(uid);
}
