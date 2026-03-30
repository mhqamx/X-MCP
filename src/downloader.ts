import { writeFile, mkdir } from "fs/promises";
import { join, extname } from "path";
import { existsSync } from "fs";
import { CONFIG, getHeaders } from "./config.js";
import { XMedia } from "./client.js";

/** 确保目录存在 */
async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/** 下载单个文件 */
async function downloadFile(url: string, savePath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": getHeaders()["User-Agent"],
      Referer: "https://x.com/",
    },
    signal: AbortSignal.timeout(CONFIG.timeout * 3), // 下载给更长超时
  });

  if (!response.ok) {
    throw new Error(`下载失败 HTTP ${response.status}: ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(savePath, buffer);
}

/** 从 URL 推断文件扩展名 */
function getExtFromUrl(url: string, type: XMedia["type"]): string {
  if (type === "photo") {
    const formatMatch = url.match(/format=(\w+)/);
    return formatMatch ? `.${formatMatch[1]}` : ".jpg";
  }
  const urlPath = new URL(url).pathname;
  const ext = extname(urlPath);
  return ext || ".mp4";
}

/** 下载推文中的所有媒体 */
export async function downloadTweetMedia(
  tweetId: string,
  media: XMedia[],
  authorScreenName: string,
  filter?: "photo" | "video" | "gif"
): Promise<DownloadResult[]> {
  const userDir = join(CONFIG.downloadDir, authorScreenName);
  await ensureDir(userDir);

  const results: DownloadResult[] = [];

  const filtered = filter ? media.filter((m) => m.type === filter) : media;

  for (let i = 0; i < filtered.length; i++) {
    const m = filtered[i];
    const ext = getExtFromUrl(m.url, m.type);
    const fileName = `${tweetId}_${i + 1}${ext}`;
    const savePath = join(userDir, fileName);

    try {
      await downloadFile(m.url, savePath);
      results.push({
        success: true,
        fileName,
        savePath,
        type: m.type,
        url: m.url,
      });
    } catch (err) {
      results.push({
        success: false,
        fileName,
        savePath,
        type: m.type,
        url: m.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

export interface DownloadResult {
  success: boolean;
  fileName: string;
  savePath: string;
  type: XMedia["type"];
  url: string;
  error?: string;
}
