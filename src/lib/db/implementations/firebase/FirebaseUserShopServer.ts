import {
  resolveUserShopContextFirebase,
  resolveUserShopSlugWithHealFirebase,
} from "@/lib/backend/resolve-user-shop-firebase";
import type { IUserShopServerService } from "@/lib/db/interfaces/IUsers";

export class FirebaseUserShopServer implements IUserShopServerService {
  resolveUserShopContext(uid: string) {
    return resolveUserShopContextFirebase(uid);
  }

  resolveUserShopSlugWithHeal(uid: string) {
    return resolveUserShopSlugWithHealFirebase(uid);
  }
}
