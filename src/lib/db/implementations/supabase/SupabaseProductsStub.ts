import type { IProductsService } from "@/lib/db/interfaces/IProducts";
import type { CreateProductInput, Product, ProductFilters } from "@/lib/db/types";

import { supabaseNotImplemented } from "./stubError";

export class SupabaseProductsStub implements IProductsService {
  getProduct(): Promise<Product | null> {
    return Promise.reject(supabaseNotImplemented("IProductsService.getProduct"));
  }

  getProducts(): Promise<Product[]> {
    return Promise.reject(supabaseNotImplemented("IProductsService.getProducts"));
  }

  createProduct(): Promise<Product> {
    return Promise.reject(supabaseNotImplemented("IProductsService.createProduct"));
  }

  updateProduct(): Promise<void> {
    return Promise.reject(supabaseNotImplemented("IProductsService.updateProduct"));
  }

  deleteProduct(): Promise<void> {
    return Promise.reject(supabaseNotImplemented("IProductsService.deleteProduct"));
  }

  subscribeToProducts(): () => void {
    throw supabaseNotImplemented("IProductsService.subscribeToProducts");
  }
}
