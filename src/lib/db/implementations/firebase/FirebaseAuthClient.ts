import {
  EmailAuthProvider,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  deleteUser as firebaseDeleteUser,
  onAuthStateChanged,
  onIdTokenChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
  type User,
} from "firebase/auth";

import { auth } from "@/lib/firebase";
import type { IAuthClient } from "@/lib/db/interfaces/IAuth";
import type { AuthSessionUser, PasswordResetActionSettings } from "@/lib/db/types";

function mapUser(u: User): AuthSessionUser {
  return {
    uid: u.uid,
    email: u.email,
    emailVerified: u.emailVerified,
    getIdToken: (forceRefresh) => u.getIdToken(forceRefresh),
  };
}

export class FirebaseAuthClient implements IAuthClient {
  authStateReady(): Promise<void> {
    return auth.authStateReady();
  }

  getCurrentUser(): AuthSessionUser | null {
    const u = auth.currentUser;
    return u ? mapUser(u) : null;
  }

  onIdTokenChanged(callback: (user: AuthSessionUser | null) => void): () => void {
    return onIdTokenChanged(auth, (u) => callback(u ? mapUser(u) : null));
  }

  onAuthStateChanged(callback: (user: AuthSessionUser | null) => void): () => void {
    return onAuthStateChanged(auth, (u) => callback(u ? mapUser(u) : null));
  }

  async signInWithEmailAndPassword(email: string, password: string): Promise<AuthSessionUser> {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return mapUser(cred.user);
  }

  async signOut(): Promise<void> {
    await signOut(auth);
  }

  async sendPasswordResetEmail(
    email: string,
    actionCodeSettings?: PasswordResetActionSettings,
  ): Promise<void> {
    await sendPasswordResetEmail(auth, email, actionCodeSettings);
  }

  async createUserWithEmailAndPassword(email: string, password: string): Promise<AuthSessionUser> {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    return mapUser(cred.user);
  }

  async deleteUser(user: AuthSessionUser): Promise<void> {
    const cur = auth.currentUser;
    if (!cur || cur.uid !== user.uid) {
      throw new Error("auth/user-mismatch");
    }
    await firebaseDeleteUser(cur);
  }

  async verifyPasswordResetCode(code: string): Promise<string> {
    return verifyPasswordResetCode(auth, code);
  }

  async confirmPasswordReset(code: string, newPassword: string): Promise<void> {
    await confirmPasswordReset(auth, code, newPassword);
  }

  async reauthenticateWithPassword(user: AuthSessionUser, currentPassword: string): Promise<void> {
    const cur = auth.currentUser;
    if (!cur || cur.uid !== user.uid) {
      throw new Error("auth/user-mismatch");
    }
    const email = cur.email;
    if (!email) {
      throw new Error("auth/missing-email");
    }
    const credential = EmailAuthProvider.credential(email, currentPassword);
    await reauthenticateWithCredential(cur, credential);
  }

  async updatePassword(user: AuthSessionUser, newPassword: string): Promise<void> {
    const cur = auth.currentUser;
    if (!cur || cur.uid !== user.uid) {
      throw new Error("auth/user-mismatch");
    }
    await updatePassword(cur, newPassword);
  }
}
