import type {
  AuthSessionUser,
  DecodedIdToken,
  ListUsersResult,
  PasswordResetActionSettings,
} from "@/lib/db/types";

/**
 * Auth phía trình duyệt (session, đăng nhập, đăng ký, đổi mật khẩu…).
 */
export interface IAuthClient {
  authStateReady(): Promise<void>;
  getCurrentUser(): AuthSessionUser | null;
  onIdTokenChanged(callback: (user: AuthSessionUser | null) => void): () => void;
  onAuthStateChanged(callback: (user: AuthSessionUser | null) => void): () => void;

  signInWithEmailAndPassword(email: string, password: string): Promise<AuthSessionUser>;
  signOut(): Promise<void>;
  sendPasswordResetEmail(email: string, actionCodeSettings?: PasswordResetActionSettings): Promise<void>;

  createUserWithEmailAndPassword(email: string, password: string): Promise<AuthSessionUser>;
  deleteUser(user: AuthSessionUser): Promise<void>;

  verifyPasswordResetCode(code: string): Promise<string>;
  confirmPasswordReset(code: string, newPassword: string): Promise<void>;

  reauthenticateWithPassword(user: AuthSessionUser, currentPassword: string): Promise<void>;
  updatePassword(user: AuthSessionUser, newPassword: string): Promise<void>;
}

/**
 * Auth phía server (Admin API) — chỉ gọi từ API routes / server.
 */
export interface IAdminAuthService {
  verifyIdToken(idToken: string): Promise<DecodedIdToken | null>;
  listUsers(maxResults: number, pageToken?: string): Promise<ListUsersResult>;
  getUser(uid: string): Promise<{ uid: string; email?: string } | null>;
  updateUserPassword(uid: string, password: string): Promise<void>;
  deleteUser(uid: string): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
}
