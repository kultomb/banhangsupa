import type { CreateProductInput, Product, ProductFilters } from "@/lib/db/types";

/**
 * Dự phòng cho catalog sản phẩm. App hiện tại chưa dùng — triển khai khi thêm thương mại điện tử.
 */
export interface IProductsService {
  getProduct(id: string): Promise<Product | null>;
  getProducts(filters?: ProductFilters): Promise<Product[]>;
  createProduct(data: CreateProductInput): Promise<Product>;
  updateProduct(id: string, data: Partial<Product>): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  subscribeToProducts(callback: (products: Product[]) => void): () => void;
}
