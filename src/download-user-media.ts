import { getUserByScreenName, XMedia } from "./client.js";
import { CONFIG, X_API, getHeaders } from "./config.js";
import { downloadTweetMedia } from "./downloader.js";

const USER_MEDIA_QUERY_ID = "SjiAp7wyuCUBkKAJJObU8w";

const FEATURES = {
  rweb_video_screen_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: true,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

interface TimelineTweet {
  id: string;
  media: XMedia[];
}

function parseTweetResult(result: any): TimelineTweet | null {
  if (result?.__typename === "TweetWithVisibilityResults") {
    result = result.tweet;
  }
  if (!result?.legacy) return null;

  const legacy = result.legacy;
  const mediaEntities =
    legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  const media: XMedia[] = [];

  for (const entity of mediaEntities) {
    if (entity.type === "photo") {
      media.push({
        type: "photo",
        url: `${entity.media_url_https}?format=jpg&name=orig`,
        previewUrl: entity.media_url_https,
        width: entity.original_info?.width,
        height: entity.original_info?.height,
      });
      continue;
    }

    if (entity.type !== "video" && entity.type !== "animated_gif") {
      continue;
    }

    const variants = (entity.video_info?.variants ?? [])
      .filter((variant: any) => variant.content_type === "video/mp4")
      .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

    if (!variants[0]?.url) continue;

    media.push({
      type: entity.type === "video" ? "video" : "gif",
      url: variants[0].url,
      previewUrl: entity.media_url_https,
      width: entity.original_info?.width,
      height: entity.original_info?.height,
      durationMs: entity.video_info?.duration_millis,
    });
  }

  if (!media.length) return null;
  return { id: legacy.id_str ?? result.rest_id, media };
}

async function fetchUserMediaPage(userId: string, cursor?: string): Promise<any> {
  const variables = {
    userId,
    count: 40,
    cursor,
    includePromotedContent: false,
    withClientEventToken: false,
    withBirdwatchNotes: false,
    withVoice: true,
    withV2Timeline: true,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
  });

  const response = await fetch(
    `${X_API.graphql}/${USER_MEDIA_QUERY_ID}/UserMedia?${params.toString()}`,
    {
      headers: getHeaders(),
      signal: AbortSignal.timeout(CONFIG.timeout),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  return response.json();
}

function extractTimeline(data: any): any {
  return (
    data?.data?.user?.result?.timeline_v2?.timeline ??
    data?.data?.user?.result?.timeline?.timeline
  );
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

function collectTweetsAndCursor(timeline: any): {
  tweets: TimelineTweet[];
  nextCursor?: string;
} {
  const instructions = timeline?.instructions ?? [];
  const tweets: TimelineTweet[] = [];
  let nextCursor: string | undefined;

  for (const instruction of instructions) {
    const entries = [
      ...(instruction.entries ?? []),
      ...(instruction.moduleItems ?? []),
      ...(instruction.entry ? [instruction.entry] : []),
    ];

    for (const entry of entries) {
      const entryId = entry.entryId ?? "";
      if (
        entryId.startsWith("cursor-bottom") ||
        entry.content?.cursorType === "Bottom"
      ) {
        nextCursor = entry.content?.value;
      }

      for (const expandedEntry of expandEntry(entry)) {
        const result =
          expandedEntry.content?.itemContent?.tweet_results?.result ??
          expandedEntry.item?.itemContent?.tweet_results?.result;
        if (!result) continue;

        const tweet = parseTweetResult(result);
        if (tweet) tweets.push(tweet);
      }
    }
  }

  return { tweets, nextCursor };
}

async function main(): Promise<void> {
  const screenName = process.argv[2];
  const maxMediaFilesArg = process.argv[3];
  const maxMediaFiles = maxMediaFilesArg ? Number(maxMediaFilesArg) : undefined;
  if (!screenName) {
    throw new Error(
      "用法: tsx src/download-user-media.ts <screen_name> [max_media_files]"
    );
  }
  if (
    maxMediaFilesArg &&
    (!Number.isFinite(maxMediaFiles) || (maxMediaFiles ?? 0) <= 0)
  ) {
    throw new Error("max_media_files 必须是正整数");
  }

  const user = await getUserByScreenName(screenName);
  const seen = new Set<string>();
  const tweets: TimelineTweet[] = [];
  let collectedMediaFiles = 0;

  let cursor: string | undefined;
  for (let page = 1; page <= 20; page++) {
    const data = await fetchUserMediaPage(user.id, cursor);
    const { tweets: pageTweets, nextCursor } = collectTweetsAndCursor(
      extractTimeline(data)
    );

    for (const tweet of pageTweets) {
      if (seen.has(tweet.id)) continue;
      seen.add(tweet.id);
      tweets.push(tweet);
      collectedMediaFiles += tweet.media.length;

      if (maxMediaFiles && collectedMediaFiles >= maxMediaFiles) {
        break;
      }
    }

    if (maxMediaFiles && collectedMediaFiles >= maxMediaFiles) break;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  const downloads = [];
  let remainingMediaFiles = maxMediaFiles;
  for (const tweet of tweets) {
    const mediaToDownload = remainingMediaFiles
      ? tweet.media.slice(0, remainingMediaFiles)
      : tweet.media;
    if (!mediaToDownload.length) break;

    downloads.push(
      ...(await downloadTweetMedia(tweet.id, mediaToDownload, screenName))
    );

    if (remainingMediaFiles) {
      remainingMediaFiles -= mediaToDownload.length;
      if (remainingMediaFiles <= 0) break;
    }
  }

  const success = downloads.filter((item) => item.success);
  const failed = downloads.filter((item) => !item.success);

  console.log(
    JSON.stringify(
      {
        screenName,
        maxMediaFiles: maxMediaFiles ?? null,
        tweets: tweets.length,
        mediaFiles: downloads.length,
        success: success.length,
        failed: failed.length,
        files: success.map((item) => item.fileName),
        errors: failed.map((item) => ({
          fileName: item.fileName,
          error: item.error,
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
