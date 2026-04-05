import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAdminAuthService } from "@/lib/db/server";
import { normalizeShopSlug, resolveUserShopSlugWithHeal } from "@/lib/backend/userShopSlug";

const LEGACY_ROOT = path.resolve(process.cwd(), "public", "legacy");
const DEFAULT_RTDB_URL = "/api/rtdb";
const SHOP_COOKIE_NAME = "ha_shop_slug";
const SESSION_COOKIE_NAME = "ha_session_token";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

const ALLOWED_FILES = new Set([
  "index.html",
  "styles.css",
  "responsive-md.css",
  "app.js",
  "app-errors.js",
  "firebase-config.js",
  "virtual-scroll-grid.min.js",
]);

function getContentType(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return CONTENT_TYPES[ext] || "text/plain; charset=utf-8";
}

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=") || "");
  }
  return "";
}

async function resolveShopSlugFromSession(request: Request) {
  const token = String(getCookieValue(request, SESSION_COOKIE_NAME) || "").trim();
  if (!token) return "";
  const decoded = await getAdminAuthService().verifyIdToken(token).catch(() => null);
  if (!decoded?.uid) return "";
  return resolveUserShopSlugWithHeal(decoded.uid);
}

/** Chỉ dùng khi chưa có session/cookie — lấy ?shop= từ trang embed (Referer). */
function shopSlugFromLegacyReferer(request: Request) {
  const ref = request.headers.get("referer") || "";
  try {
    const u = new URL(ref);
    return normalizeShopSlug(u.searchParams.get("shop") || "");
  } catch {
    return "";
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const url = new URL(request.url);
  const { path: segments } = await context.params;
  const requested = segments?.length ? segments.join("/") : "index.html";
  const fileName = requested.split("/").pop() || "index.html";

  if (!ALLOWED_FILES.has(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  if (fileName === "firebase-config.js") {
    const cookieShop = normalizeShopSlug(getCookieValue(request, SHOP_COOKIE_NAME));
    const sessionShop = await resolveShopSlugFromSession(request);
    const refShop = shopSlugFromLegacyReferer(request);
    const keyParam = String(url.searchParams.get("key") || "").trim();
    const shopFromQuery = normalizeShopSlug(url.searchParams.get("shop") || "");
    /** Thứ tự: phiên đăng nhập > cookie > ?key= > Referer > ?shop= — không fallback key mặc định (tránh đọc/ghi nhầm kho). */
    let key = "";
    if (sessionShop) {
      key = `shop_${sessionShop}`;
    } else if (cookieShop) {
      key = `shop_${cookieShop}`;
    } else if (keyParam && /^shop_[a-z0-9-]+$/.test(keyParam)) {
      key = keyParam;
    } else if (refShop) {
      key = `shop_${refShop}`;
    } else if (shopFromQuery) {
      key = `shop_${shopFromQuery}`;
    }
    if (!key) {
      /** 200 + JS: trình duyệt vẫn “load” script; client đọc __FIREBASE_CONFIG_ERROR (JSON-safe). */
      const errPayload = {
        error: "missing_shop_context",
        message:
          "Vui lòng đăng nhập và mở bán hàng từ bảng điều khiển cửa hàng — không mở trực tiếp đường dẫn /legacy khi chưa có phiên hoặc thiếu mã shop.",
        redirect: "/login",
      };
      const body = `window.__FIREBASE_CONFIG_ERROR=${JSON.stringify(errPayload)};window.FIREBASE_CONFIG=Object.assign({},window.FIREBASE_CONFIG||{},{url:${JSON.stringify(DEFAULT_RTDB_URL)},key:""});`;
      return new Response(body, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          vary: "Cookie",
        },
      });
    }
    const body = `window.__FIREBASE_CONFIG_ERROR=undefined;window.FIREBASE_CONFIG=${JSON.stringify({ url: DEFAULT_RTDB_URL, key })};`;
    return new Response(body, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
        vary: "Cookie",
      },
    });
  }

  const absolutePath = path.join(LEGACY_ROOT, fileName);
  try {
    if (fileName === "index.html") {
      const raw = await readFile(absolutePath, "utf-8");
      const urlShop = normalizeShopSlug(url.searchParams.get("shop") || "");
      const cookieShop = normalizeShopSlug(getCookieValue(request, SHOP_COOKIE_NAME));
      const sessionShop = await resolveShopSlugFromSession(request);
      const requestedKey = String(url.searchParams.get("key") || "").trim();
      let backupKey = "";
      if (sessionShop) backupKey = `shop_${sessionShop}`;
      else if (cookieShop) backupKey = `shop_${cookieShop}`;
      else if (requestedKey && /^shop_[a-z0-9-]+$/.test(requestedKey)) backupKey = requestedKey;
      else if (urlShop) backupKey = `shop_${urlShop}`;
      const injectedConfig =
        `<script>window.FIREBASE_CONFIG = { url: '${DEFAULT_RTDB_URL}', key: '${backupKey}' };</script>`;
      const keyQs = encodeURIComponent(backupKey);
      const shopQs = urlShop ? `&shop=${encodeURIComponent(urlShop)}` : "";
      const scriptWithKey = `<script src="firebase-config.js?key=${keyQs}${shopQs}"></script>`;
      let content = raw.replace(
        "<script>window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || { url: '', key: '' };</script>",
        injectedConfig,
      );
      if (content === raw) {
        content = raw.replace("</head>", `${injectedConfig}\n</head>`);
      }
      content = content.replace('<script src="firebase-config.js"></script>', scriptWithKey);
      return new Response(content, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          vary: "Cookie",
        },
      });
    }

    const fileContent = await readFile(absolutePath);
    return new Response(fileContent, {
      headers: {
        "content-type": getContentType(fileName),
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
