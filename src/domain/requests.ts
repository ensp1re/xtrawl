import type { FOLLOW_TYPE, SEARCH_DISPLAY, TWEET_TYPE } from "../constants/requests.js";
import type { OutputFormat } from "./output.js";

export type TweetType = (typeof TWEET_TYPE)[keyof typeof TWEET_TYPE];
export type FollowType = (typeof FOLLOW_TYPE)[keyof typeof FOLLOW_TYPE];
export type SearchDisplayType = (typeof SEARCH_DISPLAY)[keyof typeof SEARCH_DISPLAY];

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
  readonly displayType?: SearchDisplayType;
  readonly resume?: boolean;
  readonly save?: boolean;
  readonly saveFormat?: OutputFormat;
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
  readonly saveFormat?: OutputFormat;
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
  readonly maxAccountSwitches?: number;
  readonly maxEmptyPages?: number;
  readonly save?: boolean;
  readonly saveFormat?: OutputFormat;
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
  readonly maxAccountSwitches?: number;
  readonly maxEmptyPages?: number;
  readonly rawJson?: boolean;
  readonly save?: boolean;
  readonly saveFormat?: OutputFormat;
  readonly saveDir?: string;
  readonly saveName?: string;
  readonly signal?: AbortSignal;
}
