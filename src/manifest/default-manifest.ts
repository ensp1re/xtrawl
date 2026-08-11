import type { ManifestPayload } from "../domain/manifest.js";

export const DEFAULT_MANIFEST: ManifestPayload = {
  version: "web-default-2",
  queryIds: {
    search_timeline: "hyPfJYJ_XAtDYoslQc-Rgg",
    user_lookup_screen_name: "Gb-d6r0vxPOADdG62OEBpQ",
    profile_timeline: "SXVCYB8XHSS25nzIljNtZA",
    followers: "JNyQdTISpzCkj_1fqxDvFg",
    following: "qGZZDF3mp91q7X22s3HxpA",
    verified_followers: "u3PkPbg--arppBcwNbF1ig",
    tweet_result: "GZsN2Pc4knAoit6pXa4HSA",
  },
  endpoints: {
    search_timeline: "https://x.com/i/api/graphql/{query_id}/SearchTimeline",
    user_lookup_screen_name: "https://x.com/i/api/graphql/{query_id}/UserByScreenName",
    profile_timeline: "https://x.com/i/api/graphql/{query_id}/UserTweets",
    followers: "https://x.com/i/api/graphql/{query_id}/Followers",
    following: "https://x.com/i/api/graphql/{query_id}/Following",
    verified_followers: "https://x.com/i/api/graphql/{query_id}/BlueVerifiedFollowers",
    tweet_result: "https://x.com/i/api/graphql/{query_id}/TweetResultByRestId",
  },
  features: {
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    longform_notetweets_consumption_enabled: true,
    view_counts_everywhere_api_enabled: true,
    articles_preview_enabled: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    premium_content_api_read_enabled: false,
  },
  operationFeatures: {},
  operationFieldToggles: {
    tweet_result: {
      withArticleRichContentState: false,
      withArticlePlainText: false,
      withArticleSummaryText: false,
      withArticleVoiceOver: false,
      withGrokAnalyze: false,
      withDisallowedReplyControls: false,
      withPayments: false,
      withAuxiliaryUserLabels: false,
    },
  },
  timeoutSeconds: 25,
};
