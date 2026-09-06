export const ACCOUNT_HEALTH = {
  HEALTHY: "healthy",
  COOLING_DOWN: "cooling_down",
  UNUSABLE: "unusable",
} as const;

export const ACCOUNT_STATUS_CODE = {
  UNUSABLE: 0,
  HEALTHY: 1,
  COOLING_DOWN: 2,
} as const;

export const PROXY_SCHEME = {
  HTTP: "http",
  HTTPS: "https",
  SOCKS5: "socks5",
} as const;
