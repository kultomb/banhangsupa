import type { IOrdersService } from "@/lib/db/interfaces/IOrders";
import type { CreateOrderInput, Order } from "@/lib/db/types";

function notInApp(): Error {
  return new Error("[db/firebase] Orders service chưa có trong schema hiện tại.");
}

export class FirebaseOrdersStub implements IOrdersService {
  getOrder(): Promise<Order | null> {
    return Promise.reject(notInApp());
  }

  listOrdersForUser(): Promise<Order[]> {
    return Promise.reject(notInApp());
  }

  createOrder(): Promise<Order> {
    return Promise.reject(notInApp());
  }

  updateOrderStatus(): Promise<void> {
    return Promise.reject(notInApp());
  }
}
