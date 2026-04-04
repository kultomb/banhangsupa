import * as jose from "jose";

export type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  admin?: boolean;
};

function mapPayload(payload: jose.JWTPayload): SupabaseJwtPayload | null {
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
}

/**
 * Xác minh JWT phiên Supabase trên Edge:
 * - **HS256** (legacy JWT secret): `SUPABASE_JWT_SECRET` trong Project Settings → API.
 * - **ES256 / RS256 / …** (JWT Signing Keys): JWKS tại `{iss}/.well-known/jwks.json` (xem Supabase JWT docs).
 */
export async function verifySupabaseJwt(
  token: string,
  jwtSecret: string,
): Promise<SupabaseJwtPayload | null> {
  const trimmed = String(token || "").trim();
  if (!trimmed) return null;
  const secret = String(jwtSecret || "").trim();

  let payload: jose.JWTPayload;
  try {
    const header = jose.decodeProtectedHeader(trimmed);
    const alg = header.alg;

    if (alg === "HS256") {
      if (!secret) return null;
      const key = new TextEncoder().encode(secret);
      ({ payload } = await jose.jwtVerify(trimmed, key));
    } else {
      const peek = jose.decodeJwt(trimmed);
      const issRaw = typeof peek.iss === "string" ? peek.iss.trim() : "";
      if (!issRaw) return null;
      const issBase = issRaw.replace(/\/+$/, "");
      const jwksUrl = new URL(`${issBase}/.well-known/jwks.json`);
      const JWKS = jose.createRemoteJWKSet(jwksUrl);
      ({ payload } = await jose.jwtVerify(trimmed, JWKS, { issuer: issRaw }));
    }
  } catch {
    return null;
  }

  return mapPayload(payload);
}
