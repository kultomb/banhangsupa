import type { ICartService } from "@/lib/db/interfaces/ICart";
import type { Cart } from "@/lib/db/types";

function notInApp(): Error {
  return new Error("[db/firebase] Cart service chưa có trong schema hiện tại.");
}

export class FirebaseCartStub implements ICartService {
  getCart(): Promise<Cart | null> {
    return Promise.reject(notInApp());
  }

  setCartItem(): Promise<void> {
    return Promise.reject(notInApp());
  }

  clearCart(): Promise<void> {
    return Promise.reject(notInApp());
  }
}
