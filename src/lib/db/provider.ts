export type DbProvider = "supabase";

/** App chỉ còn backend Supabase/Postgres. */
export function getDbProvider(): DbProvider {
  return "supabase";
}
