import { adminAuth } from "@/lib/firebase-admin";
import type { IAdminAuthService } from "@/lib/db/interfaces/IAuth";
import type { DecodedIdToken, ListUsersResult, ListedAuthUser } from "@/lib/db/types";

function mapListedUser(u: {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  metadata: { lastSignInTime?: string; creationTime?: string };
}): ListedAuthUser {
  return {
    uid: u.uid,
    email: u.email,
    emailVerified: u.emailVerified,
    disabled: u.disabled,
    metadata: {
      lastSignInTime: u.metadata.lastSignInTime,
      creationTime: u.metadata.creationTime,
    },
  };
}

export class FirebaseAdminAuth implements IAdminAuthService {
  async verifyIdToken(idToken: string): Promise<DecodedIdToken | null> {
    try {
      const d = await adminAuth().verifyIdToken(idToken);
      return {
        uid: d.uid,
        email: typeof d.email === "string" ? d.email : undefined,
        admin: d.admin === true,
      };
    } catch {
      return null;
    }
  }

  async listUsers(maxResults: number, pageToken?: string): Promise<ListUsersResult> {
    const list = await adminAuth().listUsers(maxResults, pageToken);
    return {
      users: list.users.map((u) =>
        mapListedUser({
          uid: u.uid,
          email: u.email ?? undefined,
          emailVerified: u.emailVerified,
          disabled: u.disabled,
          metadata: {
            lastSignInTime: u.metadata.lastSignInTime,
            creationTime: u.metadata.creationTime,
          },
        }),
      ),
      pageToken: list.pageToken,
    };
  }

  async getUser(uid: string): Promise<{ uid: string; email?: string } | null> {
    try {
      const u = await adminAuth().getUser(uid);
      return { uid: u.uid, email: u.email ?? undefined };
    } catch {
      return null;
    }
  }

  async updateUserPassword(uid: string, password: string): Promise<void> {
    await adminAuth().updateUser(uid, { password });
  }

  async deleteUser(uid: string): Promise<void> {
    await adminAuth().deleteUser(uid);
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    await adminAuth().revokeRefreshTokens(uid);
  }
}
