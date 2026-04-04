import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";

import { isSupabaseDbProvider } from "@/lib/db/is-supabase-db";

function trimEnv(v: string | undefined) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Khi `NEXT_PUBLIC_DB_PROVIDER=supabase`, không cần biến Firebase trong env — dùng cấu hình placeholder
 * để SDK khởi tạo được (tránh throw lúc import). Luồng UI phải dùng `getAuthClient()` / Supabase, không gọi Firebase.
 */
function readFirebaseWebConfig() {
  if (isSupabaseDbProvider()) {
    return {
      apiKey: "supabase-db-placeholder",
      authDomain: "supabase-db-placeholder.firebaseapp.com",
      databaseURL: "https://supabase-db-placeholder.firebaseio.com",
      projectId: "supabase-db-placeholder",
      storageBucket: "supabase-db-placeholder.appspot.com",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:supabase-db-placeholder",
    };
  }

  const apiKey = trimEnv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const authDomain = trimEnv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN);
  const databaseURL = trimEnv(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);
  const projectId = trimEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const storageBucket = trimEnv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  const messagingSenderId = trimEnv(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID);
  const appId = trimEnv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
  const missing: string[] = [];
  if (!apiKey) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!databaseURL) missing.push("NEXT_PUBLIC_FIREBASE_DATABASE_URL");
  if (!projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!storageBucket) missing.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (!messagingSenderId) missing.push("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  if (!appId) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");
  if (missing.length > 0) {
    throw new Error(
      `[Hangho] Thiếu biến môi trường cho đăng nhập / đồng bộ: ${missing.join(", ")}. ` +
        "Tạo .env.local ở thư mục gốc, điền đủ NEXT_PUBLIC_FIREBASE_* (bảng điều khiển dự án → Project settings → Web app). " +
        "Hoặc đặt NEXT_PUBLIC_DB_PROVIDER=supabase và chỉ cấu hình Supabase. " +
        "Sau đó dừng dev server, xóa thư mục .next nếu cần, rồi chạy lại npm run dev.",
    );
  }
  const measurementRaw = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;
  const measurementId =
    typeof measurementRaw === "string" && measurementRaw.trim() ? measurementRaw.trim() : undefined;
  return {
    apiKey,
    authDomain,
    databaseURL,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    ...(measurementId ? { measurementId } : {}),
  };
}

const app = getApps().length ? getApp() : initializeApp(readFirebaseWebConfig());

if (typeof window !== "undefined" && !isSupabaseDbProvider()) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY;
  if (siteKey) {
    import("firebase/app-check")
      .then(({ ReCaptchaV3Provider, initializeAppCheck }) => {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
      })
      .catch(() => {
        // Ignore App Check init errors in local/dev environments.
      });
  }

  import("firebase/analytics")
    .then(({ getAnalytics, isSupported }) => isSupported().then((ok) => ok && getAnalytics(app)))
    .catch(() => {
      // Ignore analytics initialization errors in local/dev environments.
    });
}

export const auth = getAuth(app);
if (typeof window !== "undefined") {
  auth.languageCode = "vi";
  const w = window as typeof window & { __haAuthPersistenceInit?: boolean };
  if (!w.__haAuthPersistenceInit) {
    w.__haAuthPersistenceInit = true;
    void setPersistence(auth, browserLocalPersistence).catch(() => {
      // Keep default persistence if browser blocks storage.
    });
  }
}
export const rtdb = getDatabase(app);
export const db = getFirestore(app);
