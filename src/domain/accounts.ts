import type { ACCOUNT_HEALTH, PROXY_SCHEME } from "../constants/accounts.js";

export type CookieMap = Readonly<Record<string, string>>;

export interface AuthMaterial {
  readonly authToken: string;
  readonly csrfToken: string;
  readonly bearerToken: string;
  readonly cookies: CookieMap;
}

export interface AccountInput {
  readonly username?: string;
  readonly password?: string;
  readonly email?: string;
  readonly emailPassword?: string;
  readonly twoFactorSecret?: string;
  readonly authToken?: string;
  readonly csrfToken?: string;
  readonly cookies?: CookieMap;
  readonly proxy?: string | ProxySettings;
}

export interface ProxySettings {
  readonly http?: string;
  readonly https?: string;
  readonly host?: string;
  readonly port?: number;
  readonly scheme?: ProxyScheme;
  readonly username?: string;
  readonly password?: string;
}

export type AccountStatus = (typeof ACCOUNT_HEALTH)[keyof typeof ACCOUNT_HEALTH];
export type ProxyScheme = (typeof PROXY_SCHEME)[keyof typeof PROXY_SCHEME];

export interface AccountRecord {
  readonly id?: number;
  readonly username: string;
  readonly password?: string;
  readonly email?: string;
  readonly emailPassword?: string;
  readonly twoFactorSecret?: string;
  readonly authToken?: string;
  readonly csrfToken?: string;
  readonly cookies: CookieMap;
  readonly bearerToken?: string;
  readonly proxy?: string | ProxySettings;
  readonly status?: number;
  readonly availableUntil?: number;
  readonly dailyRequests?: number;
  readonly dailyTweets?: number;
  readonly totalTweets?: number;
  readonly lastResetDate?: string;
  readonly lastUsed?: number;
  readonly leaseId?: string;
  readonly leaseExpiresAt?: number;
  readonly lastErrorCode?: number;
  readonly cooldownReason?: string;
}

export interface AccountLease extends AccountRecord {
  readonly leaseId: string;
  readonly leaseExpiresAt: number;
}

export interface AccountSummary {
  readonly dbPath: string;
  readonly total: number;
  readonly eligible: number;
  readonly unusable: number;
  readonly coolingDown: number;
}
