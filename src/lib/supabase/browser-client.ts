"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

/**
 * ROOT CAUSE (confirmed by reading Supabase auth-js source):
 *
 * In `node_modules/@supabase/auth-js/dist/module/lib/fetch.js`, inside `_handleRequest`:
 *
 *   } catch (e) {
 *     console.error(e);   ← the SDK itself calls console.error() on every fetch failure
 *     throw new AuthRetryableFetchError(...)
 *   }
 *
 * This means:
 *   - The error IS caught by the SDK internally → AuthRetryableFetchError → handled gracefully
 *   - But `console.error(e)` fires BEFORE any of our code runs → cannot be suppressed
 *     by an `unhandledrejection` handler (that only covers uncaught promise rejections)
 *
 * FIX — two layers:
 *
 * 1. Patch console.error to filter out raw TypeError("Failed to fetch") calls.
 *    The SDK passes the raw TypeError as the first argument, making this easy to detect.
 *    In dev we also check the stack trace; in production we suppress all such TypeErrors
 *    because real network errors in app code must be caught at the call-site, not
 *    surfaced via console.error for the user to see.
 *
 * 2. Keep the unhandledrejection handler as a fallback in case any rejection still
 *    escapes the SDK's catch (e.g. if the SDK version changes).
 */
function installSupabaseNoiseSuppress() {
  if (typeof window === "undefined") return;
  if ((window as { __sbaNoiseInstalled?: boolean }).__sbaNoiseInstalled) return;
  (window as { __sbaNoiseInstalled?: boolean }).__sbaNoiseInstalled = true;

  const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const isProd = process.env.NODE_ENV === "production";

  /** Returns true for transient network-level fetch errors (not app logic errors). */
  function isNetworkFetchTypError(err: unknown): boolean {
    if (!(err instanceof TypeError)) return false;
    const msg = err.message ?? "";
    return (
      msg === "Failed to fetch" ||                               // Chrome / Firefox
      msg === "Load failed" ||                                   // Safari
      msg === "NetworkError when attempting to fetch resource"   // Firefox alt
    );
  }

  /** Returns true if the stack trace suggests the error originated in Supabase auth-js. */
  function looksLikeSupabaseStack(err: TypeError): boolean {
    const stack = err.stack ?? "";
    return (
      (!!supabaseHost && stack.includes(supabaseHost)) ||
      stack.includes("GoTrueClient") ||
      stack.includes("supabase") ||
      stack.includes("auth-js")
    );
  }

  // ── Layer 1: patch console.error ──────────────────────────────────────────
  // Supabase's _handleRequest does `console.error(e)` before converting the
  // TypeError into an AuthRetryableFetchError. We intercept it here.
  const origError = console.error.bind(console) as (...a: unknown[]) => void;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (isNetworkFetchTypError(first)) {
      // In production: always suppress (real errors must be caught at call-site).
      // In development: suppress only if the stack points to Supabase internals
      //   so developers still see app-level network bugs.
      if (isProd || looksLikeSupabaseStack(first as TypeError)) return;
    }
    origError(...args);
  };

  // ── Layer 2: unhandledrejection fallback ──────────────────────────────────
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (!isNetworkFetchTypError(reason)) return;
    if (looksLikeSupabaseStack(reason as TypeError) || isProd) {
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
  installSupabaseNoiseSuppress();
  browserClient = createClient(url, anon, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
