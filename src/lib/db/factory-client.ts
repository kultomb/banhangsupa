import type { IAuthClient } from "@/lib/db/interfaces/IAuth";
import type { IUserProfileClientService } from "@/lib/db/interfaces/IUsers";
import type { IProductsService } from "@/lib/db/interfaces/IProducts";
import type { IOrdersService } from "@/lib/db/interfaces/IOrders";
import type { ICartService } from "@/lib/db/interfaces/ICart";

import { SupabaseAuthClient } from "@/lib/db/implementations/supabase/SupabaseAuthClient";
import { SupabaseUserProfileClient } from "@/lib/db/implementations/supabase/SupabaseUserProfileClient";
import { SupabaseProductsStub } from "@/lib/db/implementations/supabase/SupabaseProductsStub";
import { SupabaseOrdersStub } from "@/lib/db/implementations/supabase/SupabaseOrdersStub";
import { SupabaseCartStub } from "@/lib/db/implementations/supabase/SupabaseCartStub";

let authClient: IAuthClient | undefined;
let userProfileClient: IUserProfileClientService | undefined;
let productsService: IProductsService | undefined;
let ordersService: IOrdersService | undefined;
let cartService: ICartService | undefined;

export function getAuthClient(): IAuthClient {
  if (!authClient) {
    authClient = new SupabaseAuthClient();
  }
  return authClient;
}

export function getUserProfileClientService(): IUserProfileClientService {
  if (!userProfileClient) {
    userProfileClient = new SupabaseUserProfileClient();
  }
  return userProfileClient;
}

export function getProductsService(): IProductsService {
  if (!productsService) {
    productsService = new SupabaseProductsStub();
  }
  return productsService;
}

export function getOrdersService(): IOrdersService {
  if (!ordersService) {
    ordersService = new SupabaseOrdersStub();
  }
  return ordersService;
}

export function getCartService(): ICartService {
  if (!cartService) {
    cartService = new SupabaseCartStub();
  }
  return cartService;
}
