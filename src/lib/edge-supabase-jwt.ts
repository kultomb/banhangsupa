import * as jose from "jose";

export type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  admin?: boolean;
};

/**
 * Xác minh JWT phiên Supabase (HS256) trên Edge — dùng JWT Secret trong Project Settings → API.
 */
export async function verifySupabaseJwt(
  token: string,
  jwtSecret: string,
): Promise<SupabaseJwtPayload | null> {
  const trimmed = String(token || "").trim();
  const secret = String(jwtSecret || "").trim();
  if (!trimmed || !secret) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jose.jwtVerify(trimmed, key);
    const sub = String(payload.sub || "");
    if (!sub) return null;
    const am = payload.app_metadata as Record<string, unknown> | undefined;
    const um = payload.user_metadata as Record<string, unknown> | undefined;
    const admin = am?.admin === true || um?.admin === true;
    return {
      sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      admin: admin === true ? true : payload.admin === true ? true : undefined,
    };
  } catch {
    return null;
  }
}
