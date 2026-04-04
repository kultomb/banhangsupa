import type { Cart } from "@/lib/db/types";

/** Dự phòng giỏ hàng — chưa có trong Firebase hiện tại. */
export interface ICartService {
  getCart(userId: string): Promise<Cart | null>;
  setCartItem(userId: string, productId: string, quantity: number): Promise<void>;
  clearCart(userId: string): Promise<void>;
}
