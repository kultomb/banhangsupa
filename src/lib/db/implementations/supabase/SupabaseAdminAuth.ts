import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

import type { IAdminAuthService } from "@/lib/db/interfaces/IAuth";
import type { DecodedIdToken, ListUsersResult, ListedAuthUser } from "@/lib/db/types";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

function mapListedUser(u: SupabaseAuthUser): ListedAuthUser {
  return {
    uid: u.id,
    email: u.email ?? undefined,
    emailVerified: Boolean(u.email_confirmed_at),
    disabled: false,
    metadata: {
      lastSignInTime: u.last_sign_in_at ?? undefined,
      creationTime: u.created_at ?? undefined,
    },
  };
}

/** Chỉ `app_metadata` — user_metadata client có thể tự sửa, không được dùng làm admin. */
function isAdminClaim(u: SupabaseAuthUser): boolean {
  const am = u.app_metadata as Record<string, unknown> | undefined;
  return am?.admin === true;
}

export class SupabaseAdminAuth implements IAdminAuthService {
  async verifyIdToken(idToken: string): Promise<DecodedIdToken | null> {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.getUser(idToken);
      if (error || !data.user) return null;
      const u = data.user;
      return {
        uid: u.id,
        email: typeof u.email === "string" ? u.email : undefined,
        admin: isAdminClaim(u),
      };
    } catch {
      return null;
    }
  }

  async listUsers(maxResults: number, pageToken?: string): Promise<ListUsersResult> {
    const admin = createSupabaseAdminClient();
    const page = pageToken ? Math.max(1, parseInt(pageToken, 10) || 1) : 1;
    const perPage = Math.min(Math.max(1, maxResults), 1000);
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return { users: [] };
    }
    const next =
      data.nextPage != null && data.nextPage <= data.lastPage ? String(data.nextPage) : undefined;
    return {
      users: data.users.map((u) => mapListedUser(u)),
      pageToken: next,
    };
  }

  async getUser(uid: string): Promise<{ uid: string; email?: string } | null> {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.admin.getUserById(uid);
      if (error || !data.user) return null;
      return { uid: data.user.id, email: data.user.email ?? undefined };
    } catch {
      return null;
    }
  }

  async updateUserPassword(uid: string, password: string): Promise<void> {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.updateUserById(uid, { password });
    if (error) throw error;
  }

  async deleteUser(uid: string): Promise<void> {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) throw error;
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    void uid;
    throw new Error(
      "[SupabaseAdminAuth] revokeRefreshTokens(uid) cần JWT — dùng auth.admin.signOut(jwt, 'global') trong route (xem /api/auth/revoke-sessions).",
    );
  }
}
