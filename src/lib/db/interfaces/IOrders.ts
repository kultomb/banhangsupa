import type { CreateOrderInput, Order } from "@/lib/db/types";

/** Dự phòng đơn hàng — chưa có trong Firebase hiện tại. */
export interface IOrdersService {
  getOrder(id: string): Promise<Order | null>;
  listOrdersForUser(userId: string): Promise<Order[]>;
  createOrder(data: CreateOrderInput): Promise<Order>;
  updateOrderStatus(id: string, status: string): Promise<void>;
}
