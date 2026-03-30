import { getUserByScreenName } from "./client.js";
import { CONFIG, X_API, getHeaders } from "./config.js";

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

function summarizeEntry(entry: any): any {
  return {
    entryId: entry?.entryId,
    contentEntryType: entry?.content?.entryType,
    itemType: entry?.item?.itemContent?.itemType,
    tweetDisplayType:
      entry?.content?.itemContent?.tweetDisplayType ??
      entry?.item?.itemContent?.tweetDisplayType,
    cursorType: entry?.content?.cursorType,
    itemContentKeys: Object.keys(entry?.item?.itemContent ?? {}),
    contentKeys: Object.keys(entry?.content ?? {}),
    contentItemKeys: Object.keys(entry?.content?.itemContent ?? {}),
    moduleItemCount:
      entry?.content?.items?.length ??
      entry?.items?.length ??
      entry?.content?.moduleItems?.length ??
      0,
  };
}

function summarizeModuleItems(entry: any): any[] {
  const items =
    entry?.content?.items ??
    entry?.items ??
    entry?.content?.moduleItems ??
    [];

  return items.slice(0, 10).map((item: any) => ({
    entryId: item?.entryId,
    itemType: item?.item?.itemContent?.itemType,
    tweetDisplayType: item?.item?.itemContent?.tweetDisplayType,
    itemContentKeys: Object.keys(item?.item?.itemContent ?? {}),
    resultType:
      item?.item?.itemContent?.tweet_results?.result?.__typename ??
      item?.item?.content?.tweetResult?.result?.__typename,
    tweetId:
      item?.item?.itemContent?.tweet_results?.result?.legacy?.id_str ??
      item?.item?.itemContent?.tweet_results?.result?.rest_id,
  }));
}

function extractTweetId(entry: any): string | undefined {
  return (
    entry?.content?.itemContent?.tweet_results?.result?.legacy?.id_str ??
    entry?.content?.itemContent?.tweet_results?.result?.rest_id ??
    entry?.item?.itemContent?.tweet_results?.result?.legacy?.id_str ??
    entry?.item?.itemContent?.tweet_results?.result?.rest_id
  );
}

function flattenEntries(entry: any): any[] {
  const nested =
    entry?.content?.items ??
    entry?.items ??
    entry?.content?.moduleItems ??
    [];

  if (!nested.length) return [entry];
  return nested.flatMap((item: any) => flattenEntries(item));
}

async function main(): Promise<void> {
  const screenName = process.argv[2];
  if (!screenName) {
    throw new Error("用法: tsx src/inspect-user-media.ts <screen_name>");
  }

  const user = await getUserByScreenName(screenName);
  const pageSummaries = [];
  const tweetIds: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 1; page <= 10; page++) {
    const data = await fetchUserMediaPage(user.id, cursor);
    const timeline =
      data?.data?.user?.result?.timeline_v2?.timeline ??
      data?.data?.user?.result?.timeline?.timeline;
    const instructions = timeline?.instructions ?? [];

    const summary = instructions.map((instruction: any, index: number) => ({
      index,
      type: instruction?.type,
      entryCount: (instruction?.entries ?? []).length,
      moduleItemCount: (instruction?.moduleItems ?? []).length,
      entries: (instruction?.entries ?? []).slice(0, 10).map(summarizeEntry),
    }));

    const nested = instructions.flatMap((instruction: any) =>
      (instruction?.entries ?? [])
        .filter(
          (entry: any) =>
            (entry?.content?.items?.length ?? 0) > 0 ||
            (entry?.items?.length ?? 0) > 0 ||
            (entry?.content?.moduleItems?.length ?? 0) > 0
        )
        .map((entry: any) => ({
          entry: summarizeEntry(entry),
          nestedItems: summarizeModuleItems(entry),
        }))
    );

    let nextCursor: string | undefined;
    const pageTweetIds: string[] = [];
    for (const instruction of instructions) {
      const entries = [
        ...(instruction?.entries ?? []),
        ...(instruction?.moduleItems ?? []),
        ...(instruction?.entry ? [instruction.entry] : []),
      ];

      for (const entry of entries) {
        const entryId = entry?.entryId ?? "";
        if (
          entryId.startsWith("cursor-bottom") ||
          entry?.content?.cursorType === "Bottom"
        ) {
          nextCursor = entry?.content?.value;
        }

        for (const item of flattenEntries(entry)) {
          const tweetId = extractTweetId(item);
          if (!tweetId || seen.has(tweetId)) continue;
          seen.add(tweetId);
          tweetIds.push(tweetId);
          pageTweetIds.push(tweetId);
        }
      }
    }

    pageSummaries.push({
      page,
      cursor,
      nextCursor,
      tweetIds: pageTweetIds,
      instructions: summary,
      nested,
    });

    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  console.log(
    JSON.stringify(
      {
        screenName,
        totalTweetIds: tweetIds.length,
        tweetIds,
        pages: pageSummaries,
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
