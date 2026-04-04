import { getDbProvider } from "@/lib/db/provider";
import type { IAuthClient } from "@/lib/db/interfaces/IAuth";
import type { IUserProfileClientService } from "@/lib/db/interfaces/IUsers";
import type { IProductsService } from "@/lib/db/interfaces/IProducts";
import type { IOrdersService } from "@/lib/db/interfaces/IOrders";
import type { ICartService } from "@/lib/db/interfaces/ICart";

import { FirebaseAuthClient } from "@/lib/db/implementations/firebase/FirebaseAuthClient";
import { FirebaseUserProfileClient } from "@/lib/db/implementations/firebase/FirebaseUserProfileClient";
import { FirebaseProductsStub } from "@/lib/db/implementations/firebase/FirebaseProductsStub";
import { FirebaseOrdersStub } from "@/lib/db/implementations/firebase/FirebaseOrdersStub";
import { FirebaseCartStub } from "@/lib/db/implementations/firebase/FirebaseCartStub";

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
    authClient = getDbProvider() === "supabase" ? new SupabaseAuthClient() : new FirebaseAuthClient();
  }
  return authClient;
}

export function getUserProfileClientService(): IUserProfileClientService {
  if (!userProfileClient) {
    userProfileClient =
      getDbProvider() === "supabase"
        ? new SupabaseUserProfileClient()
        : new FirebaseUserProfileClient();
  }
  return userProfileClient;
}

export function getProductsService(): IProductsService {
  if (!productsService) {
    productsService =
      getDbProvider() === "supabase" ? new SupabaseProductsStub() : new FirebaseProductsStub();
  }
  return productsService;
}

export function getOrdersService(): IOrdersService {
  if (!ordersService) {
    ordersService =
      getDbProvider() === "supabase" ? new SupabaseOrdersStub() : new FirebaseOrdersStub();
  }
  return ordersService;
}

export function getCartService(): ICartService {
  if (!cartService) {
    cartService =
      getDbProvider() === "supabase" ? new SupabaseCartStub() : new FirebaseCartStub();
  }
  return cartService;
}
