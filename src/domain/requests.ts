export type TweetType =
  "all" | "originals_only" | "replies_only" | "retweets_only" | "exclude_replies" | "exclude_retweets";
export type FollowType = "followers" | "following" | "verified_followers";

export interface SearchRequest {
  readonly since?: string;
  readonly until?: string;
  readonly searchQuery?: string;
  readonly allWords?: readonly string[];
  readonly anyWords?: readonly string[];
  readonly exactPhrases?: readonly string[];
  readonly excludeWords?: readonly string[];
  readonly hashtagsAny?: readonly string[];
  readonly hashtagsExclude?: readonly string[];
  readonly fromUsers?: readonly string[];
  readonly toUsers?: readonly string[];
  readonly mentioningUsers?: readonly string[];
  readonly tweetType?: TweetType;
  readonly verifiedOnly?: boolean;
  readonly blueVerifiedOnly?: boolean;
  readonly hasImages?: boolean;
  readonly hasVideos?: boolean;
  readonly hasLinks?: boolean;
  readonly hasMentions?: boolean;
  readonly hasHashtags?: boolean;
  readonly minLikes?: number;
  readonly minReplies?: number;
  readonly minRetweets?: number;
  readonly place?: string;
  readonly geocode?: string;
  readonly near?: string;
  readonly within?: string;
  readonly lang?: string;
  readonly limit?: number;
  readonly displayType?: "Top" | "Latest";
  readonly resume?: boolean;
  readonly save?: boolean;
  readonly saveFormat?: "csv" | "json" | "both" | "ndjson";
  readonly saveDir?: string;
  readonly saveName?: string;
  readonly maxEmptyPages?: number;
  readonly signal?: AbortSignal;
}

export type SearchPageRequest = Omit<
  SearchRequest,
  "limit" | "resume" | "save" | "saveFormat" | "saveDir" | "saveName" | "maxEmptyPages"
> & {
  readonly cursor?: string;
  readonly maxAccountSwitches?: number;
  readonly signal?: AbortSignal;
};

export interface TargetInput {
  readonly raw?: string;
  readonly username?: string;
  readonly profileUrl?: string;
  readonly userId?: string;
  readonly source?: string;
}

export interface UserInfoRequest {
  readonly save?: boolean;
  readonly saveFormat?: "csv" | "json" | "both" | "ndjson";
  readonly saveDir?: string;
  readonly saveName?: string;
  readonly signal?: AbortSignal;
}

export interface ProfileTimelineRequest {
  readonly targets: readonly TargetInput[];
  readonly limit?: number;
  readonly perProfileLimit?: number;
  readonly maxPagesPerProfile?: number;
  readonly resume?: boolean;
  readonly initialCursors?: Readonly<Record<string, string>>;
  readonly cursorHandoff?: boolean;
  readonly maxAccountSwitches?: number;
  readonly allowAnonymous?: boolean;
  readonly maxEmptyPages?: number;
  readonly save?: boolean;
  readonly saveFormat?: "csv" | "json" | "both" | "ndjson";
  readonly saveDir?: string;
  readonly saveName?: string;
  readonly signal?: AbortSignal;
}

export interface FollowsRequest {
  readonly targets: readonly TargetInput[];
  readonly followType: FollowType;
  readonly limit?: number;
  readonly perProfileLimit?: number;
  readonly maxPagesPerProfile?: number;
  readonly resume?: boolean;
  readonly initialCursors?: Readonly<Record<string, string>>;
  readonly cursorHandoff?: boolean;
  readonly maxAccountSwitches?: number;
  readonly maxEmptyPages?: number;
  readonly rawJson?: boolean;
  readonly save?: boolean;
  readonly saveFormat?: "csv" | "json" | "both" | "ndjson";
  readonly saveDir?: string;
  readonly saveName?: string;
  readonly signal?: AbortSignal;
}
