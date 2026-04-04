/**
 * Entry client-safe: auth + profile + stub commerce. Không import `server-only` hoặc firebase-admin.
 */
export type * from "@/lib/db/types";
export type * from "@/lib/db/interfaces";

export {
  getAuthClient,
  getUserProfileClientService,
  getProductsService,
  getOrdersService,
  getCartService,
} from "@/lib/db/factory-client";

export { getDbProvider } from "@/lib/db/provider";
