export type DbProvider = "firebase" | "supabase";

/**
 * Chọn backend qua env. Mặc định `firebase` để triển khai Supabase dần mà không gãy production.
 */
export function getDbProvider(): DbProvider {
  const v = (process.env.NEXT_PUBLIC_DB_PROVIDER || "firebase").trim().toLowerCase();
  return v === "supabase" ? "supabase" : "firebase";
}
