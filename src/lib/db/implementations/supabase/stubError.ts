export function supabaseNotImplemented(feature: string): Error {
  return new Error(
    `[db/supabase] ${feature} chưa triển khai trong adapter hiện tại.`,
  );
}
