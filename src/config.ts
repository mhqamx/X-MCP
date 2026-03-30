import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readFileSync, existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

/**
 * 从 Netscape cookie 文件解析为 HTTP Cookie 字符串
 * 格式: domain \t flag \t path \t secure \t expiry \t name \t value
 */
function parseCookieFile(filePath: string): string {
  if (!existsSync(filePath)) return "";
  const content = readFileSync(filePath, "utf-8");
  const cookies: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 7) {
      cookies.push(`${parts[5]}=${parts[6]}`);
    }
  }
  return cookies.join("; ");
}

/** 加载 cookie：优先环境变量，其次 cookies.txt 文件 */
function loadCookie(): string {
  if (process.env.X_COOKIE) return process.env.X_COOKIE;
  const cookieFile = resolve(PROJECT_ROOT, "cookies.txt");
  return parseCookieFile(cookieFile);
}

export const CONFIG = {
  /** X 平台认证 Cookie */
  cookie: loadCookie(),

  /** X API Bearer Token（可选，优先使用官方 API） */
  bearerToken: process.env.X_BEARER_TOKEN ?? "",

  /** 下载文件存储目录 */
  downloadDir: process.env.DOWNLOAD_DIR ?? resolve(PROJECT_ROOT, "downloads"),

  /** 请求超时（毫秒） */
  timeout: Number(process.env.HTTP_TIMEOUT ?? 30000),

  /** 请求间隔（毫秒），避免触发反爬 */
  requestDelay: Number(process.env.REQUEST_DELAY ?? 2000),

  /** 调试模式 */
  debug: process.env.DEBUG === "true",
};

/** X 平台 API 端点 */
export const X_API = {
  /** GraphQL 端点 */
  graphql: "https://x.com/i/api/graphql",

  /** v1.1 REST API（部分端点仍可用） */
  v1: "https://api.x.com/1.1",

  /** v2 官方 API */
  v2: "https://api.x.com/2",
};

/** 通用请求头 */
export function getHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Cookie: CONFIG.cookie,
    "X-Csrf-Token": extractCsrfToken(CONFIG.cookie),
    Authorization:
      "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
  };
}

/** 从 cookie 中提取 csrf token */
function extractCsrfToken(cookie: string): string {
  const match = cookie.match(/ct0=([a-f0-9]+)/);
  return match?.[1] ?? "";
}
