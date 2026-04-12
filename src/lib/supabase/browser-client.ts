"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

/**
 * Suppress unhandled "Failed to fetch" rejections thrown by Supabase's background token-refresh
 * timer.  The SDK already emits TOKEN_REFRESH_FAILED and retries automatically — the raw
 * rejection is noise that we don't want surfaced in the console.
 *
 * WHY the previous check (stack.includes("GoTrueClient")) failed in production:
 *   Next.js minifies the bundle → error.stack contains "/_next/static/chunks/abc.js:1:234"
 *   not the original class names.  DevTools shows source-mapped names, but error.stack is
 *   the raw minified string, so the class-name check always returned false in production.
 *
 * New strategy:
 *   1. Match on error type (TypeError) + message pattern — these are always network errors.
 *   2. In development we still check the stack for Supabase markers so we don't hide real bugs.
 *   3. In production we suppress all unhandled TypeError("Failed to fetch | Load failed")
 *      because any real fetch error a dev needs to see should already be caught at call-site.
 */
function installSupabaseRefreshErrorHandler() {
  if (typeof window === "undefined") return;
  // Guard against multiple calls (e.g. hot-reload in dev)
  if ((window as { __sbaErrHandlerInstalled?: boolean }).__sbaErrHandlerInstalled) return;
  (window as { __sbaErrHandlerInstalled?: boolean }).__sbaErrHandlerInstalled = true;

  const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const isProd = process.env.NODE_ENV === "production";

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    // Only intercept network-level TypeError thrown by fetch()
    if (!(reason instanceof TypeError)) return;

    const msg = reason.message ?? "";
    const isNetworkFetchErr =
      msg === "Failed to fetch" ||      // Chrome / Firefox
      msg === "Load failed" ||          // Safari
      msg === "NetworkError when attempting to fetch resource" ||
      msg.includes("network error");

    if (!isNetworkFetchErr) return;

    const stack = reason.stack ?? "";
    // Dev: check class-name markers that survive source-mapping.
    // In production minified builds these won't appear in the stack — handled by isProd below.
    const hasSupabaseMarker =
      (supabaseHost && stack.includes(supabaseHost)) ||
      stack.includes("GoTrueClient") ||
      stack.includes("supabase") ||
      stack.includes("auth-js");

    // In production minified builds there are no class names in the stack, so we suppress
    // all unhandled fetch TypeErrors — real errors must be caught at the call-site anyway.
    if (hasSupabaseMarker || isProd) {
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
