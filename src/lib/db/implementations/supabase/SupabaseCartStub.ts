import type { ICartService } from "@/lib/db/interfaces/ICart";
import type { Cart } from "@/lib/db/types";

import { supabaseNotImplemented } from "./stubError";

export class SupabaseCartStub implements ICartService {
  getCart(): Promise<Cart | null> {
    return Promise.reject(supabaseNotImplemented("ICartService.getCart"));
  }

  setCartItem(): Promise<void> {
    return Promise.reject(supabaseNotImplemented("ICartService.setCartItem"));
  }

  clearCart(): Promise<void> {
    return Promise.reject(supabaseNotImplemented("ICartService.clearCart"));
  }
}
