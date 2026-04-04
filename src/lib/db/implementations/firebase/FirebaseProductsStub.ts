import type { IProductsService } from "@/lib/db/interfaces/IProducts";
import type { CreateProductInput, Product, ProductFilters } from "@/lib/db/types";

function notInApp(): Error {
  return new Error("[db/firebase] Catalog sản phẩm chưa được nối — app hiện là POS/host shop, không có collection products.");
}

/** Stub: triển khai thật khi thêm thương mại điện tử. */
export class FirebaseProductsStub implements IProductsService {
  getProduct(): Promise<Product | null> {
    return Promise.reject(notInApp());
  }

  getProducts(): Promise<Product[]> {
    return Promise.reject(notInApp());
  }

  createProduct(): Promise<Product> {
    return Promise.reject(notInApp());
  }

  updateProduct(): Promise<void> {
    return Promise.reject(notInApp());
  }

  deleteProduct(): Promise<void> {
    return Promise.reject(notInApp());
  }

  subscribeToProducts(_callback: (products: Product[]) => void): () => void {
    return () => undefined;
  }
}
