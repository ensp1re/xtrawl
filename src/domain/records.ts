export interface TweetUser {
  readonly screenName?: string;
  readonly name?: string;
}

export interface TweetMedia {
  readonly imageLinks: readonly string[];
}

export interface TweetRecord {
  readonly tweetId: string;
  readonly user: TweetUser;
  readonly timestamp?: string;
  readonly text?: string;
  readonly embeddedText?: string;
  readonly comments: number;
  readonly likes: number;
  readonly retweets: number;
  readonly media: TweetMedia;
  readonly tweetUrl?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface RunStats {
  readonly tweetsCount: number;
  readonly tasksTotal: number;
  readonly tasksDone: number;
  readonly tasksFailed: number;
  readonly retries: number;
}

export interface SearchResult {
  readonly tweets: readonly TweetRecord[];
  readonly stats: RunStats;
}

export interface SearchPageResult {
  readonly tweets: readonly TweetRecord[];
  readonly nextCursor: string | undefined;
}

export interface ProfileRecord {
  readonly input: { readonly raw?: string; readonly source?: string };
  readonly userId?: string;
  readonly username?: string;
  readonly name?: string;
  readonly description?: string;
  readonly location?: string;
  readonly createdAt?: string;
  readonly followersCount: number;
  readonly followingCount: number;
  readonly statusesCount: number;
  readonly favouritesCount: number;
  readonly mediaCount: number;
  readonly listedCount: number;
  readonly verified: boolean;
  readonly blueVerified: boolean;
  readonly protected: boolean;
  readonly profileImageUrl?: string;
  readonly profileBannerUrl?: string;
  readonly url?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface FollowRecord extends Omit<ProfileRecord, "input"> {
  readonly type: "followers" | "following" | "verified_followers";
  readonly target: {
    readonly raw?: string;
    readonly source?: string;
    readonly userId?: string;
    readonly username?: string;
    readonly profileUrl?: string;
  };
}
