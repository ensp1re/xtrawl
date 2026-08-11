import type { ManifestPayload } from "../domain/manifest.js";

export const DEFAULT_MANIFEST: ManifestPayload = {
  version: "web-default-1",
  queryIds: {
    search_timeline: "rkp6b4vtR9u7v3naGoOzUQ",
    user_lookup_screen_name: "IGgvgiOx4QZndDHuD3x9TQ",
    profile_timeline: "O0epvwaQPUx-bT9YlqlL6w",
    followers: "Enf9DNUZYiT037aersI5gg",
    following: "ntIPnH1WMBKW--4Tn1q71A",
    verified_followers: "4zBtcnE_c0v8wn1Zx0yF5Q",
  },
  endpoints: {
    search_timeline: "https://x.com/i/api/graphql/{query_id}/SearchTimeline",
    user_lookup_screen_name: "https://x.com/i/api/graphql/{query_id}/UserByScreenName",
    profile_timeline: "https://x.com/i/api/graphql/{query_id}/UserTweets",
    followers: "https://x.com/i/api/graphql/{query_id}/Followers",
    following: "https://x.com/i/api/graphql/{query_id}/Following",
    verified_followers: "https://x.com/i/api/graphql/{query_id}/BlueVerifiedFollowers",
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
  operationFieldToggles: {},
  timeoutSeconds: 25,
};
