import type { EMPTY_REASON } from "../constants/pages.js";
import type { TweetRecord } from "./records.js";

export type EmptyReason = (typeof EMPTY_REASON)[keyof typeof EMPTY_REASON];

export interface RequestQuota {
  readonly remaining?: number;
  readonly resetAt?: number;
  readonly exhausted?: boolean;
}

export interface TweetPage {
  readonly tweets: readonly TweetRecord[];
  readonly cursor?: string;
  readonly quota?: RequestQuota;
  readonly emptyReason?: EmptyReason;
}

export interface FollowPage {
  readonly users: readonly Record<string, unknown>[];
  readonly cursor?: string;
  readonly quota?: RequestQuota;
}
