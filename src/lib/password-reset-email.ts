import type { PasswordResetActionSettings } from "@/lib/db/types";

import { getPasswordResetContinueOrigin } from "@/lib/site-brand";

/**
 * ActionCodeSettings cho `sendPasswordResetEmail` (chuẩn Firebase Auth custom continue URL).
 *
 * - `url`: `https://hangho.com/reset-password` (từ `NEXT_PUBLIC_APP_URL` + path). Sau khi user bấm link trong mail,
 *   Firebase xử lý rồi **chuyển về** URL này kèm `mode`, `oobCode` (và tham số khác) — trang `/reset-password` đã có sẵn.
 * - `handleCodeInApp: true`: khuyến nghị theo tài liệu Firebase cho luồng có continue URL (web/app).
 * - **Authorized domains:** `hangho.com`, `www.hangho.com` trong Authentication → Settings.
 * - **Vercel:** `NEXT_PUBLIC_APP_URL=https://hangho.com` (HTTPS, không dùng localhost trong mail production).
 *
 * **Lưu ý:** Chuỗi `href` trong HTML email đôi khi vẫn là `*.firebaseapp.com/__/auth/...` + `continueUrl=…`;
 * domain đẹp nằm ở tham số continue và trang đích. Muốn link hiển thị trực tiếp `hangho.com` trong mail,
 * cần **Firebase Hosting** (cùng project) gắn custom domain — xem tài liệu “custom auth domain / action URL”.
 *
 * **Templates (bỏ "dangnnhap-…" trong mail):** xem file `firebase-password-reset-email-hangho.txt` ở gốc repo —
 * dán Subject + Body vào Firebase Console → Authentication → Templates → Password reset.
 */
export function buildPasswordResetActionCodeSettings(): PasswordResetActionSettings | undefined {
  const origin = getPasswordResetContinueOrigin();
  if (!origin) return undefined;
  return {
    url: `${origin}/reset-password`,
    handleCodeInApp: true,
  };
}

