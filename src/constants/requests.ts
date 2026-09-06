export const TWEET_TYPE = {
  ALL: "all",
  ORIGINALS_ONLY: "originals_only",
  REPLIES_ONLY: "replies_only",
  RETWEETS_ONLY: "retweets_only",
  EXCLUDE_REPLIES: "exclude_replies",
  EXCLUDE_RETWEETS: "exclude_retweets",
} as const;

export const FOLLOW_TYPE = {
  FOLLOWERS: "followers",
  FOLLOWING: "following",
  VERIFIED_FOLLOWERS: "verified_followers",
} as const;

export const SEARCH_DISPLAY = {
  TOP: "Top",
  LATEST: "Latest",
} as const;
