"use client";

const DEVICE_ID_KEY = "ha_device_id";

/**
 * Tạo hoặc đọc device ID từ localStorage — nhận diện thiết bị qua các phiên đăng nhập.
 * Persistent: khác sessionStorage, device_id sống qua tắt/mở trình duyệt.
 * Nếu localStorage không khả dụng (SSR, private mode), trả chuỗi rỗng.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
