import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getUserByScreenName,
  getUserTweets,
  searchTweets,
  delay,
  XTweet,
} from "./client.js";
import { downloadTweetMedia } from "./downloader.js";
import { CONFIG } from "./config.js";

const server = new McpServer({
  name: "X Scraper",
  version: "1.0.0",
});

// ================================================================
// Tool 1: 获取博主信息
// ================================================================
server.tool(
  "x_get_user_profile",
  "获取 X 平台用户的基本信息（头像、简介、粉丝数等）",
  {
    username: z.string().describe("用户名（不含@），如 example_user"),
  },
  async ({ username }) => {
    const user = await getUserByScreenName(username);
    const lines = [
      `**${user.name}** (@${user.screenName})`,
      user.verified ? "[已认证]" : "",
      "",
      user.description,
      "",
      `- 粉丝: ${user.followersCount.toLocaleString()}`,
      `- 关注: ${user.followingCount.toLocaleString()}`,
      `- 推文数: ${user.tweetCount.toLocaleString()}`,
      `- 位置: ${user.location || "未设置"}`,
      `- 注册时间: ${user.createdAt}`,
      `- 头像: ${user.profileImageUrl ?? "无"}`,
      `- 横幅: ${user.profileBannerUrl ?? "无"}`,
      `- 主页: https://x.com/${user.screenName}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ================================================================
// Tool 2: 获取推文列表
// ================================================================
server.tool(
  "x_get_tweets",
  "获取指定用户的最新推文列表",
  {
    username: z.string().describe("用户名（不含@）"),
    count: z.number().min(1).max(100).default(20).describe("获取数量，默认20"),
    include_retweets: z.boolean().default(false).describe("是否包含转推"),
  },
  async ({ username, count, include_retweets }) => {
    // 先获取用户 ID
    const user = await getUserByScreenName(username);
    await delay();

    const result = await getUserTweets(user.id, count);

    let tweets = result.tweets;
    if (!include_retweets) {
      tweets = tweets.filter((t) => !t.isRetweet);
    }

    const output = tweets.map((t) => formatTweet(t)).join("\n---\n");
    const summary = `共获取 ${tweets.length} 条推文（@${username}）`;

    return {
      content: [{ type: "text", text: `${summary}\n\n${output}` }],
    };
  }
);

// ================================================================
// Tool 3: 搜索推文
// ================================================================
server.tool(
  "x_search_tweets",
  "按关键词搜索推文，支持 X 高级搜索语法",
  {
    query: z
      .string()
      .describe(
        '搜索关键词，支持高级语法如 "from:example_user keyword"、"min_faves:1000" 等'
      ),
    count: z.number().min(1).max(50).default(20).describe("结果数量，默认20"),
  },
  async ({ query, count }) => {
    const result = await searchTweets(query, count);
    const output = result.tweets.map((t) => formatTweet(t)).join("\n---\n");
    const summary = `搜索 "${query}" 共找到 ${result.tweets.length} 条推文`;

    return {
      content: [{ type: "text", text: `${summary}\n\n${output}` }],
    };
  }
);

// ================================================================
// Tool 4: 下载推文媒体
// ================================================================
server.tool(
  "x_download_media",
  "下载指定推文中的图片和视频到本地",
  {
    tweet_url: z
      .string()
      .describe("推文链接，如 https://x.com/user/status/123456"),
    media_type: z
      .enum(["all", "photo", "video", "gif"])
      .default("all")
      .describe('下载类型: "all"全部, "photo"仅图片, "video"仅视频, "gif"仅动图'),
  },
  async ({ tweet_url, media_type }) => {
    // 从 URL 提取用户名和推文 ID
    const match = tweet_url.match(
      /(?:x|twitter)\.com\/(\w+)\/status\/(\d+)/
    );
    if (!match) {
      return {
        content: [{ type: "text", text: "无效的推文链接格式" }],
        isError: true,
      };
    }

    const [, screenName, tweetId] = match;

    // 获取推文内容以拿到媒体信息
    const user = await getUserByScreenName(screenName);
    await delay();
    const timeline = await getUserTweets(user.id, 50);

    const tweet = timeline.tweets.find((t) => t.id === tweetId);
    if (!tweet) {
      return {
        content: [
          {
            type: "text",
            text: `未在最近的推文中找到 ID ${tweetId}，推文可能较早或已删除`,
          },
        ],
        isError: true,
      };
    }

    if (tweet.media.length === 0) {
      return {
        content: [{ type: "text", text: "该推文不包含任何媒体文件" }],
      };
    }

    const filter = media_type === "all" ? undefined : media_type;
    const results = await downloadTweetMedia(
      tweetId,
      tweet.media,
      screenName,
      filter
    );

    const successCount = results.filter((r) => r.success).length;
    const lines = results.map((r) =>
      r.success
        ? `[OK] ${r.fileName} (${r.type})`
        : `[FAIL] ${r.fileName}: ${r.error}`
    );

    return {
      content: [
        {
          type: "text",
          text: `下载完成: ${successCount}/${results.length} 个文件\n保存目录: ${CONFIG.downloadDir}/${screenName}\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ================================================================
// Tool 5: 批量下载博主媒体
// ================================================================
server.tool(
  "x_download_all_media",
  "批量下载某博主最新推文中的所有图片和视频",
  {
    username: z.string().describe("用户名（不含@）"),
    count: z
      .number()
      .min(1)
      .max(200)
      .default(50)
      .describe("扫描最近多少条推文，默认50"),
    media_type: z
      .enum(["all", "photo", "video", "gif"])
      .default("all")
      .describe("下载类型"),
  },
  async ({ username, count, media_type }) => {
    const user = await getUserByScreenName(username);
    await delay();

    // 分页获取推文
    const allTweets: XTweet[] = [];
    let cursor: string | undefined;
    while (allTweets.length < count) {
      const batch = await getUserTweets(
        user.id,
        Math.min(count - allTweets.length, 20),
        cursor
      );
      if (batch.tweets.length === 0) break;
      allTweets.push(...batch.tweets);
      cursor = batch.nextCursor;
      if (!cursor) break;
      await delay();
    }

    // 过滤有媒体的推文并下载
    const filter = media_type === "all" ? undefined : media_type;
    let totalDownloaded = 0;
    let totalFailed = 0;

    for (const tweet of allTweets) {
      if (tweet.media.length === 0) continue;
      const results = await downloadTweetMedia(
        tweet.id,
        tweet.media,
        username,
        filter
      );
      totalDownloaded += results.filter((r) => r.success).length;
      totalFailed += results.filter((r) => !r.success).length;
      await delay(500); // 下载间短暂延迟
    }

    return {
      content: [
        {
          type: "text",
          text: [
            `批量下载完成（@${username}）`,
            `- 扫描推文: ${allTweets.length} 条`,
            `- 下载成功: ${totalDownloaded} 个文件`,
            totalFailed > 0 ? `- 下载失败: ${totalFailed} 个文件` : "",
            `- 保存目录: ${CONFIG.downloadDir}/${username}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  }
);

// ================================================================
// Tool 6: 获取推文详情
// ================================================================
server.tool(
  "x_get_tweet_detail",
  "获取单条推文的详细信息，包括完整文本、媒体链接、互动数据",
  {
    tweet_url: z
      .string()
      .describe("推文链接，如 https://x.com/user/status/123456"),
  },
  async ({ tweet_url }) => {
    const match = tweet_url.match(
      /(?:x|twitter)\.com\/(\w+)\/status\/(\d+)/
    );
    if (!match) {
      return {
        content: [{ type: "text", text: "无效的推文链接格式" }],
        isError: true,
      };
    }

    const [, screenName, tweetId] = match;
    const user = await getUserByScreenName(screenName);
    await delay();
    const timeline = await getUserTweets(user.id, 50);
    const tweet = timeline.tweets.find((t) => t.id === tweetId);

    if (!tweet) {
      return {
        content: [{ type: "text", text: "未找到该推文" }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: formatTweetDetail(tweet) }],
    };
  }
);

// ================================================================
// 格式化工具
// ================================================================

function formatTweet(t: XTweet): string {
  const author = t.author
    ? `**${t.author.name}** @${t.author.screenName}`
    : "未知";
  const stats = `${t.likeCount} likes | ${t.retweetCount} RTs | ${t.replyCount} replies${t.viewCount ? ` | ${t.viewCount} views` : ""}`;
  const mediaInfo =
    t.media.length > 0
      ? `[媒体: ${t.media.map((m) => m.type).join(", ")}]`
      : "";
  const flags = [
    t.isRetweet ? "[转推]" : "",
    t.isQuote ? "[引用]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    `${author} ${flags}`,
    t.createdAt,
    "",
    t.text,
    "",
    mediaInfo,
    stats,
    t.url,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function formatTweetDetail(t: XTweet): string {
  const lines = [
    formatTweet(t),
    "",
    "## 媒体文件",
  ];

  if (t.media.length === 0) {
    lines.push("无媒体");
  } else {
    for (const m of t.media) {
      lines.push(
        `- [${m.type}] ${m.width ?? "?"}x${m.height ?? "?"} → ${m.url}`
      );
    }
  }

  if (t.quotedTweet) {
    lines.push("", "## 引用推文", formatTweet(t.quotedTweet));
  }

  return lines.join("\n");
}

// ================================================================
// 启动服务器
// ================================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("X Scraper MCP Server 已启动 (stdio 模式)");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
