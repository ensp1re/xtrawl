export { XTrawl } from "./client/client.js";
export { XTrawlDatabase } from "./client/database.js";
export { XTrawlAccounts } from "./client/accounts.js";
export type { AccountImportOptions, AccountListOptions, ClientOptions } from "./client/types.js";
export type { DiagnosticEvent, DiagnosticListener } from "./domain/diagnostics.js";
export type { ClientConfig, ConfigInput } from "./config/types.js";
export { validateConfig } from "./config/validation.js";
export type {
  AccountInput,
  AccountLease,
  AccountRecord,
  AccountStatus,
  AccountSummary,
  AuthMaterial,
  CookieMap,
  ProxySettings,
} from "./domain/accounts.js";
export type {
  AccountLeaseCompletion,
  AccountLeaseRequest,
  AccountStateExportOptions,
  AccountStateRestoreOptions,
  AccountStateSnapshot,
  AccountStateSnapshotRecord,
  AccountStateStore,
  Awaitable,
} from "./domain/account-state.js";
export type {
  FollowRecord,
  ProfileRecord,
  RunStats,
  SearchPageResult,
  SearchResult,
  TweetMedia,
  TweetRecord,
  TweetUser,
} from "./domain/records.js";
export type {
  FollowsRequest,
  ProfileTimelineRequest,
  SearchPageRequest,
  SearchRequest,
  TargetInput,
  UserInfoRequest,
  FollowType,
  TweetType,
} from "./domain/requests.js";
export {
  AccountPoolExhausted,
  AccountStateError,
  AuthError,
  ConfigError,
  EngineError,
  XTrawlError,
  ManifestError,
  NetworkError,
  ProxyError,
  RateLimitError,
  ResumeError,
  RunFailed,
} from "./domain/errors.js";
export { parseAccountStateSnapshot } from "./auth/account-state.js";
export { normalizeCookiesPayload, parseCookieHeader, parseNetscapeCookies } from "./auth/cookies.js";
export {
  loadAccountsFile,
  loadAccountsFileSync,
  loadAccountsPayload,
  loadInlineAccounts,
} from "./auth/loaders.js";
export { normalizeAccountRecord } from "./auth/records.js";
export { normalizeSearch, buildEffectiveQuery } from "./query/normalize.js";
export { normalizeTargets, targetFromString } from "./query/targets.js";
export { queryHash } from "./query/hash.js";
export { createManifest } from "./manifest/model.js";
export { DEFAULT_MANIFEST } from "./manifest/default-manifest.js";
export { extractManifestFromJavascript } from "./manifest/scraper.js";
export { TaskQueue, ExecutionRunner, withRetry } from "./runner/index.js";
