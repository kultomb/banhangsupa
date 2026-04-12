import type { Session } from "@supabase/supabase-js";

import type { IAuthClient } from "@/lib/db/interfaces/IAuth";
import type { AuthSessionUser, PasswordResetActionSettings } from "@/lib/db/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

function mapSessionUser(session: Session | null): AuthSessionUser | null {
  const u = session?.user;
  if (!u) return null;
  return {
    uid: u.id,
    email: u.email ?? null,
    emailVerified: Boolean(u.email_confirmed_at),
    getIdToken: async (forceRefresh?: boolean) => {
      const client = getSupabaseBrowserClient();
      if (forceRefresh) {
        const { data, error } = await client.auth.refreshSession();
        if (error) throw error;
        const t = data.session?.access_token;
        if (!t) throw new Error("auth/no-access-token");
        return t;
      }
      const { data } = await client.auth.getSession();
      const t = data.session?.access_token;
      if (!t) throw new Error("auth/no-access-token");
      return t;
    },
  };
}

export class SupabaseAuthClient implements IAuthClient {
  /** Bản sao đồng bộ cho `getCurrentUser()` (Supabase không có `currentUser` sync như Firebase). */
  private sessionSnapshot: AuthSessionUser | null = null;

  private get sb() {
    return getSupabaseBrowserClient();
  }

  private setSnapshot(session: Session | null) {
    this.sessionSnapshot = mapSessionUser(session);
  }

  async authStateReady(): Promise<void> {
    const { data } = await this.sb.auth.getSession();
    this.setSnapshot(data.session);
  }

  getCurrentUser(): AuthSessionUser | null {
    return this.sessionSnapshot;
  }

  onIdTokenChanged(callback: (user: AuthSessionUser | null) => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((event, session) => {
      if (
        event === "TOKEN_REFRESHED" ||
        event === "SIGNED_IN" ||
        event === "INITIAL_SESSION" ||
        event === "USER_UPDATED"
      ) {
        this.setSnapshot(session);
        callback(this.sessionSnapshot);
        return;
      }
      // SIGNED_OUT do user chủ động logout (scope:local) → báo callback để RequireAuth xử lý.
      // TOKEN_REFRESH_FAILED do mạng chập → KHÔNG cập nhật snapshot, KHÔNG logout oan.
      if (event === "SIGNED_OUT") {
        this.setSnapshot(null);
        callback(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }

  onAuthStateChanged(callback: (user: AuthSessionUser | null) => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((event, session) => {
      // TOKEN_REFRESH_FAILED: mạng tạm lỗi khi auto-refresh → KHÔNG reset snapshot,
      // KHÔNG gọi callback → tránh logout oan và tránh ảnh hưởng RequireAuth đang chạy.
      if (event === "TOKEN_REFRESH_FAILED") return;

      this.setSnapshot(session);
      /** TOKEN_REFRESHED: tránh login page chạy lại pipeline restore → kẹt spinner. */
      if (event === "TOKEN_REFRESHED") return;
      callback(this.sessionSnapshot);
    });
    return () => data.subscription.unsubscribe();
  }

  async signInWithEmailAndPassword(email: string, password: string): Promise<AuthSessionUser> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.setSnapshot(data.session);
    const mapped = this.sessionSnapshot;
    if (!mapped) throw new Error("auth/no-session");
    return mapped;
  }

  async signOut(): Promise<void> {
    /** Mặc định Supabase là `scope: 'global'` — đăng xuất 1 trình duyệt sẽ hủy mọi phiên → tab khác kẹt cookie/RTDB. */
    const { error } = await this.sb.auth.signOut({ scope: "local" });
    if (error) throw error;
    this.setSnapshot(null);
  }

  async sendPasswordResetEmail(
    email: string,
    actionCodeSettings?: PasswordResetActionSettings,
  ): Promise<void> {
    const redirectTo = actionCodeSettings?.url?.trim();
    const { error } = await this.sb.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) throw error;
  }

  async createUserWithEmailAndPassword(email: string, password: string): Promise<AuthSessionUser> {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw error;
    this.setSnapshot(data.session);
    const mapped = this.sessionSnapshot;
    if (!mapped) throw new Error("auth/no-session");
    return mapped;
  }

  async deleteUser(user: AuthSessionUser): Promise<void> {
    const token = await user.getIdToken(true);
    const res = await fetch("/api/auth/delete-account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    if (!res.ok) {
      throw new Error("auth/delete-account-failed");
    }
    await this.signOut().catch(() => undefined);
  }

  async verifyPasswordResetCode(code: string): Promise<string> {
    const { data, error } = await this.sb.auth.exchangeCodeForSession(code);
    if (error) throw error;
    this.setSnapshot(data.session);
    return data.user?.email ?? "";
  }

  async confirmPasswordReset(code: string, newPassword: string): Promise<void> {
    const ex = await this.sb.auth.exchangeCodeForSession(code);
    if (ex.error) {
      const { data: cur } = await this.sb.auth.getSession();
      if (!cur.session) throw ex.error;
    } else {
      this.setSnapshot(ex.data.session);
    }
    const { error } = await this.sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async reauthenticateWithPassword(user: AuthSessionUser, currentPassword: string): Promise<void> {
    const email = user.email?.trim();
    if (!email) throw new Error("auth/missing-email");
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password: currentPassword });
    if (error) throw error;
    this.setSnapshot(data.session);
  }

  async updatePassword(_user: AuthSessionUser, newPassword: string): Promise<void> {
    const { error } = await this.sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }
}
