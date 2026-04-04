export function supabaseNotImplemented(feature: string): Error {
  return new Error(
    `[db/supabase] ${feature} chưa triển khai. Đặt NEXT_PUBLIC_DB_PROVIDER=firebase hoặc hoàn thiện Supabase adapter.`,
  );
}
