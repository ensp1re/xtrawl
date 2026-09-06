import type { SearchRequest, TargetInput, TweetType } from "../domain/requests.js";

export interface NormalizedSearch {
  readonly searchQuery: string;
  readonly allWords: readonly string[];
  readonly anyWords: readonly string[];
  readonly exactPhrases: readonly string[];
  readonly excludeWords: readonly string[];
  readonly hashtagsAny: readonly string[];
  readonly hashtagsExclude: readonly string[];
  readonly fromUsers: readonly string[];
  readonly toUsers: readonly string[];
  readonly mentioningUsers: readonly string[];
  readonly tweetType: TweetType;
  readonly verifiedOnly: boolean;
  readonly blueVerifiedOnly: boolean;
  readonly hasImages: boolean;
  readonly hasVideos: boolean;
  readonly hasLinks: boolean;
  readonly hasMentions: boolean;
  readonly hasHashtags: boolean;
  readonly minLikes: number;
  readonly minReplies: number;
  readonly minRetweets: number;
  readonly place: string;
  readonly geocode: string;
  readonly near: string;
  readonly within: string;
  readonly lang: string;
  readonly since: string;
  readonly until: string;
  readonly displayType: NonNullable<SearchRequest["displayType"]>;
}

export interface NormalizedTargets {
  readonly targets: readonly TargetInput[];
  readonly skipped: readonly { readonly raw: string; readonly reason: string }[];
}
