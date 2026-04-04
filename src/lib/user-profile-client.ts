"use client";

import { getUserProfileClientService } from "@/lib/db";

export type { UserProfileClient } from "@/lib/db/types";

/**
 * Payment / trial từ RTDB. Firestore chỉ gọi khi RTDB chưa có shopSlug (reload nhanh cho đa số user).
 */
export async function fetchUserProfileClient(uid: string) {
  return getUserProfileClientService().fetchProfile(uid);
}
