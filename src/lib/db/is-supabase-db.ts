/**
 * Dùng chung middleware / firebase stub (chỉ đọc env, không import SDK).
 */
export function isSupabaseDbProvider(): boolean {
  return (process.env.NEXT_PUBLIC_DB_PROVIDER || "firebase").trim().toLowerCase() === "supabase";
}
