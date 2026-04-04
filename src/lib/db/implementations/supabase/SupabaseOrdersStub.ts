import type { IOrdersService } from "@/lib/db/interfaces/IOrders";
import type { CreateOrderInput, Order } from "@/lib/db/types";

import { supabaseNotImplemented } from "./stubError";

export class SupabaseOrdersStub implements IOrdersService {
  getOrder(): Promise<Order | null> {
    return Promise.reject(supabaseNotImplemented("IOrdersService.getOrder"));
  }

  listOrdersForUser(): Promise<Order[]> {
    return Promise.reject(supabaseNotImplemented("IOrdersService.listOrdersForUser"));
  }

  createOrder(): Promise<Order> {
    return Promise.reject(supabaseNotImplemented("IOrdersService.createOrder"));
  }

  updateOrderStatus(): Promise<void> {
    return Promise.reject(supabaseNotImplemented("IOrdersService.updateOrderStatus"));
  }
}
