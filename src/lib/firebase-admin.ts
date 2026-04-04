import admin from "firebase-admin";

import { isSupabaseDbProvider } from "@/lib/db/is-supabase-db";

const databaseURL = (process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "").trim();

function getServiceAccount() {
  const raw = process.env.FIREBASE_ADMIN_CREDENTIALS || "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        project_id: string;
        client_email: string;
        private_key: string;
      };
      return {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      };
    } catch {
      // Fall through to per-variable env parsing.
    }
  }

  const projectId = (process.env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || "").trim();
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function getAdminApp() {
  if (isSupabaseDbProvider()) {
    throw new Error(
      "[firebase-admin] Không dùng khi NEXT_PUBLIC_DB_PROVIDER=supabase. Route này cần bản Postgres/Supabase.",
    );
  }
  if (admin.apps.length) return admin.app();
  const svc = getServiceAccount();
  if (!svc) {
    throw new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_ADMIN_CREDENTIALS (JSON) or FIREBASE_ADMIN_PROJECT_ID/FIREBASE_ADMIN_CLIENT_EMAIL/FIREBASE_ADMIN_PRIVATE_KEY in env.",
    );
  }
  if (!databaseURL) {
    throw new Error(
      "Missing NEXT_PUBLIC_FIREBASE_DATABASE_URL for Admin RTDB. Set it in env (no hardcoded default).",
    );
  }
  return admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL,
  });
}

export function adminDb() {
  return admin.database(getAdminApp());
}

export function adminAuth() {
  return admin.auth(getAdminApp());
}

export function adminFirestore() {
  return admin.firestore(getAdminApp());
}
