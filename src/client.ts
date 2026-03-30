import { CONFIG, X_API, getHeaders } from "./config.js";

type OperationName = "UserByScreenName" | "UserTweets" | "SearchTimeline";

interface OperationDescriptor {
  queryId: string;
  method: "GET" | "POST";
}

const OPERATION_FALLBACKS: Record<OperationName, OperationDescriptor> = {
  UserByScreenName: {
    queryId: "IGgvgiOx4QZndDHuD3x9TQ",
    method: "GET",
  },
  UserTweets: {
    queryId: "FOlovQsiHGDls3c0Q_HaSQ",
    method: "GET",
  },
  SearchTimeline: {
    queryId: "GcXk9vN_d1jUfHNqLacXQA",
    method: "POST",
  },
};

const OPERATION_CACHE_TTL_MS = Number(
  process.env.OPERATION_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000
);

const FEATURES = {
  rweb_video_screen_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: true,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  article_rich_content_web_enabled: true,
  rweb_video_timestamps_enabled: true,
  responsive_web_media_download_video_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: true,
  hidden_profile_subscriptions_enabled: false,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
};

const FIELD_TOGGLES = {
  withPayments: false,
  withAuxiliaryUserLabels: false,
  withArticleRichContentState: false,
  withArticlePlainText: false,
  withArticleSummaryText: false,
  withArticleVoiceOver: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
};

let operationsCache:
  | { loadedAt: number; operations: Record<OperationName, OperationDescriptor> }
  | undefined;
let operationsPromise: Promise<Record<OperationName, OperationDescriptor>> | undefined;

/** 通用请求方法 */
async function request(
  url: string,
  options: RequestInit = {}
): Promise<unknown> {
  const headers = {
    ...getHeaders(),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (CONFIG.debug) {
    console.error(`[DEBUG] ${options.method ?? "GET"} ${url}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(CONFIG.timeout),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    return response.text();
  }

  return response.json();
}

function encodeJsonParam(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

/** 延迟 */
export function delay(ms: number = CONFIG.requestDelay): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverOperations(): Promise<Record<OperationName, OperationDescriptor>> {
  const home = await request("https://x.com/");
  const html = typeof home === "string" ? home : "";
  const bundleUrlMatch = html.match(
    /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[^"]+\.js/
  );

  if (!bundleUrlMatch) {
    throw new Error("未找到 X 前端主 bundle");
  }

  const bundleResponse = await fetch(bundleUrlMatch[0], {
    headers: {
      "User-Agent": getHeaders()["User-Agent"],
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(CONFIG.timeout),
  });

  if (!bundleResponse.ok) {
    throw new Error(`获取 X bundle 失败 HTTP ${bundleResponse.status}`);
  }

  const bundleText = await bundleResponse.text();
  const operations = { ...OPERATION_FALLBACKS };

  for (const name of Object.keys(OPERATION_FALLBACKS) as OperationName[]) {
    const match = bundleText.match(
      new RegExp(`queryId:"([^"]+)",operationName:"${name}"`)
    );
    if (match?.[1]) {
      operations[name] = {
        ...operations[name],
        queryId: match[1],
      };
    }
  }

  return operations;
}

async function getOperations(): Promise<Record<OperationName, OperationDescriptor>> {
  if (
    operationsCache &&
    Date.now() - operationsCache.loadedAt < OPERATION_CACHE_TTL_MS
  ) {
    return operationsCache.operations;
  }

  if (!operationsPromise) {
    operationsPromise = discoverOperations()
      .catch((error) => {
        if (CONFIG.debug) {
          console.error("[DEBUG] GraphQL operation discovery failed:", error);
        }
        return { ...OPERATION_FALLBACKS };
      })
      .finally(() => {
        operationsPromise = undefined;
      });
  }

  const operations = await operationsPromise;
  operationsCache = { loadedAt: Date.now(), operations };
  return operations;
}

async function callOperation(
  operationName: OperationName,
  variables: Record<string, unknown>
): Promise<any> {
  const operation = (await getOperations())[operationName];
  const url = `${X_API.graphql}/${operation.queryId}/${operationName}`;

  if (operation.method === "POST") {
    return request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        variables,
        features: FEATURES,
        fieldToggles: FIELD_TOGGLES,
      }),
    });
  }

  return request(
    `${url}?variables=${encodeJsonParam(variables)}&features=${encodeJsonParam(FEATURES)}`
  );
}

function decodeRestId(encodedId: string | undefined): string | undefined {
  if (!encodedId) return undefined;
  try {
    const decoded = Buffer.from(encodedId, "base64").toString("utf8");
    const [, restId] = decoded.split(":");
    return restId || undefined;
  } catch {
    return undefined;
  }
}

// ============================================================
// 用户相关
// ============================================================

/** 通过用户名获取用户信息 */
export async function getUserByScreenName(
  screenName: string
): Promise<XUserResult> {
  const data = await callOperation("UserByScreenName", {
    screen_name: screenName,
    withSafetyModeUserFields: true,
  });
  const user = data?.data?.user?.result;

  if (!user) {
    throw new Error(`用户 @${screenName} 不存在`);
  }

  const legacy = user.legacy ?? {};
  const core = user.core ?? {};

  return {
    id: user.rest_id ?? decodeRestId(user.id) ?? "",
    name: core.name ?? legacy.name ?? screenName,
    screenName: core.screen_name ?? legacy.screen_name ?? screenName,
    description: legacy.description ?? user.profile_bio?.description ?? "",
    followersCount: legacy.followers_count ?? 0,
    followingCount: legacy.friends_count ?? 0,
    tweetCount: legacy.statuses_count ?? 0,
    profileImageUrl:
      user.avatar?.image_url?.replace("_normal", "_400x400") ??
      legacy.profile_image_url_https?.replace("_normal", "_400x400"),
    profileBannerUrl: legacy.profile_banner_url,
    verified: !!user.is_blue_verified,
    createdAt: core.created_at ?? legacy.created_at ?? "",
    location: user.location?.location ?? legacy.location ?? "",
  };
}

/** 获取用户推文时间线 */
export async function getUserTweets(
  userId: string,
  count: number = 20,
  cursor?: string
): Promise<XTimelineResult> {
  const data = await callOperation("UserTweets", {
    userId,
    count,
    cursor,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: true,
    withV2Timeline: true,
  });

  return parseTimeline(data);
}

/** 搜索推文 */
export async function searchTweets(
  query: string,
  count: number = 20,
  cursor?: string
): Promise<XTimelineResult> {
  const data = await callOperation("SearchTimeline", {
    rawQuery: query,
    count,
    cursor,
    querySource: "typed_query",
    product: "Latest",
  });

  const timeline = data?.data?.search_by_raw_query?.search_timeline?.timeline;
  return parseTimelineInstructions(timeline);
}

// ============================================================
// 解析工具
// ============================================================

function parseTimeline(data: any): XTimelineResult {
  const timeline =
    data?.data?.user?.result?.timeline_v2?.timeline ??
    data?.data?.user?.result?.timeline?.timeline;
  return parseTimelineInstructions(timeline);
}

function expandEntry(entry: any): any[] {
  const nested =
    entry?.content?.items ??
    entry?.items ??
    entry?.content?.moduleItems ??
    [];

  if (!nested.length) return [entry];
  return nested.flatMap((item: any) => expandEntry(item));
}

function parseTimelineInstructions(timeline: any): XTimelineResult {
  const instructions = timeline?.instructions ?? [];
  const tweets: XTweet[] = [];
  let nextCursor: string | undefined;

  for (const instruction of instructions) {
    const entries = [
      ...(instruction.entries ?? []),
      ...(instruction.moduleItems ?? []),
      ...(instruction.entry ? [instruction.entry] : []),
    ];

    for (const entry of entries) {
      const entryId: string = entry.entryId ?? "";

      if (
        entryId.startsWith("cursor-bottom") ||
        entry.content?.cursorType === "Bottom"
      ) {
        nextCursor = entry.content?.value;
        continue;
      }

      for (const expandedEntry of expandEntry(entry)) {
        const tweetResult =
          expandedEntry.content?.itemContent?.tweet_results?.result ??
          expandedEntry.item?.itemContent?.tweet_results?.result;
        if (!tweetResult) continue;

        const tweet = parseTweetResult(tweetResult);
        if (tweet) tweets.push(tweet);
      }
    }
  }

  return { tweets, nextCursor };
}

function parseTweetResult(result: any): XTweet | null {
  if (result.__typename === "TweetWithVisibilityResults") {
    result = result.tweet;
  }
  if (!result?.legacy) return null;

  const legacy = result.legacy;
  const userResult = result.core?.user_results?.result;
  const userCore = userResult?.core ?? userResult?.legacy;
  const userLegacy = userResult?.legacy;
  const authorName = userCore?.name ?? userLegacy?.name;
  const authorScreenName = userCore?.screen_name ?? userLegacy?.screen_name;
  const media: XMedia[] = [];

  const mediaEntities =
    legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  for (const m of mediaEntities) {
    if (m.type === "photo") {
      media.push({
        type: "photo",
        url: m.media_url_https + "?format=jpg&name=orig",
        previewUrl: m.media_url_https,
        width: m.original_info?.width,
        height: m.original_info?.height,
      });
    } else if (m.type === "video" || m.type === "animated_gif") {
      const variants = m.video_info?.variants ?? [];
      const mp4Variants = variants
        .filter((variant: any) => variant.content_type === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

      media.push({
        type: m.type === "video" ? "video" : "gif",
        url: mp4Variants[0]?.url ?? m.media_url_https,
        previewUrl: m.media_url_https,
        width: m.original_info?.width,
        height: m.original_info?.height,
        durationMs: m.video_info?.duration_millis,
      });
    }
  }

  return {
    id: legacy.id_str ?? result.rest_id,
    text:
      legacy.full_text ??
      legacy.note_tweet?.note_tweet_results?.result?.text ??
      "",
    createdAt: legacy.created_at,
    author:
      authorName && authorScreenName
        ? { name: authorName, screenName: authorScreenName }
        : undefined,
    retweetCount: legacy.retweet_count,
    likeCount: legacy.favorite_count,
    replyCount: legacy.reply_count,
    viewCount: result.views?.count ? Number(result.views.count) : undefined,
    media,
    isRetweet: !!legacy.retweeted_status_result,
    isQuote: !!result.quoted_status_result,
    quotedTweet: result.quoted_status_result?.result
      ? parseTweetResult(result.quoted_status_result.result)
      : undefined,
    url: authorScreenName
      ? `https://x.com/${authorScreenName}/status/${legacy.id_str ?? result.rest_id}`
      : undefined,
  };
}

// ============================================================
// 类型定义
// ============================================================

export interface XUserResult {
  id: string;
  name: string;
  screenName: string;
  description: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  profileImageUrl?: string;
  profileBannerUrl?: string;
  verified: boolean;
  createdAt: string;
  location: string;
}

export interface XTweet {
  id: string;
  text: string;
  createdAt: string;
  author?: { name: string; screenName: string };
  retweetCount: number;
  likeCount: number;
  replyCount: number;
  viewCount?: number;
  media: XMedia[];
  isRetweet: boolean;
  isQuote: boolean;
  quotedTweet?: XTweet | null;
  url?: string;
}

export interface XMedia {
  type: "photo" | "video" | "gif";
  url: string;
  previewUrl: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface XTimelineResult {
  tweets: XTweet[];
  nextCursor?: string;
}
