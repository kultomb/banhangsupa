"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

/**
 * Supabase SDK tự refresh token qua background timer. Khi mạng gián đoạn tạm thời,
 * SDK throw "Failed to fetch" bên trong timer → unhandledRejection. Handler này
 * bắt các lỗi đó để không làm crash app — SDK sẽ tự retry sau.
 */
function installSupabaseRefreshErrorHandler() {
  if (typeof window === "undefined") return;
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (!(reason instanceof Error)) return;
    const msg = reason.message || "";
    const stack = reason.stack || "";
    const isSupabaseRefresh =
      (msg === "Failed to fetch" || msg.includes("NetworkError") || msg.includes("fetch")) &&
      (stack.includes("supabase") || stack.includes("GoTrueClient") || stack.includes("auth-js"));
    if (isSupabaseRefresh) {
      // Ngăn lỗi hiện trong console như unhandledRejection; SDK tự retry.
      event.preventDefault();
    }
  });
}

/**
 * Client Supabase cho trình duyệt (anon key). Chỉ dùng khi `NEXT_PUBLIC_DB_PROVIDER=supabase`.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anon) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  installSupabaseRefreshErrorHandler();
  browserClient = createClient(url, anon, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
