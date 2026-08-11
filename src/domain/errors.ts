export type ErrorCategory = "auth" | "rate_limit" | "network" | "proxy" | "transient" | "runtime";

export interface ErrorDiagnostics {
  readonly statusCode?: number;
  readonly category?: ErrorCategory;
  readonly account?: string;
  readonly endpoint?: string;
  readonly [key: string]: unknown;
}

export class XTrawlError extends Error {
  public readonly code: string;
  public readonly diagnostics: Readonly<ErrorDiagnostics>;

  public constructor(code: string, message: string, diagnostics: ErrorDiagnostics = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export class ConfigError extends XTrawlError {
  public constructor(message: string) {
    super("config_error", message);
  }
}

export class ManifestError extends XTrawlError {
  public constructor(message: string) {
    super("manifest_error", message);
  }
}

export class AccountPoolExhausted extends XTrawlError {
  public constructor(message = "No eligible account is available.", diagnostics: ErrorDiagnostics = {}) {
    super("account_pool_exhausted", message, diagnostics);
  }
}

export class EngineError extends XTrawlError {
  public constructor(message: string, diagnostics: ErrorDiagnostics = {}) {
    super("engine_error", message, diagnostics);
  }
}

export class RunFailed extends EngineError {
  public constructor(message: string, diagnostics: ErrorDiagnostics = {}) {
    super(message, diagnostics);
    this.name = new.target.name;
  }
}

export class NetworkError extends RunFailed {
  public constructor(message: string, diagnostics: ErrorDiagnostics = {}) {
    super(message, { ...diagnostics, category: "network" });
  }
}

export class ProxyError extends RunFailed {
  public constructor(message: string, diagnostics: ErrorDiagnostics = {}) {
    super(message, { ...diagnostics, category: "proxy" });
  }
}

export class RateLimitError extends RunFailed {
  public constructor(message: string, diagnostics: ErrorDiagnostics = {}) {
    super(message, { ...diagnostics, category: "rate_limit" });
  }
}

export class AuthError extends RunFailed {
  public constructor(message: string, diagnostics: ErrorDiagnostics = {}) {
    super(message, { ...diagnostics, category: "auth" });
  }
}

export class ResumeError extends XTrawlError {
  public constructor(message: string) {
    super("resume_error", message);
  }
}

export class AccountSessionBuildError extends XTrawlError {
  public readonly statusCode: number;
  public readonly category: ErrorCategory;

  public constructor(
    code: string,
    reason: string,
    options: { readonly statusCode?: number; readonly category?: ErrorCategory } = {},
  ) {
    super(code, `${code}:${reason}`, {
      statusCode: options.statusCode ?? 599,
      category: options.category ?? "transient",
    });
    this.statusCode = options.statusCode ?? 599;
    this.category = options.category ?? "transient";
  }
}

export class AccountSessionAuthError extends AccountSessionBuildError {
  public constructor(code: string, reason: string) {
    super(code, reason, { statusCode: 401, category: "auth" });
  }
}

export class AccountSessionRuntimeError extends AccountSessionBuildError {
  public constructor(code: string, reason: string) {
    super(code, reason, { statusCode: 500, category: "runtime" });
  }
}

export class AccountSessionTransientError extends AccountSessionBuildError {
  public constructor(code: string, reason: string) {
    super(code, reason, { statusCode: 599, category: "transient" });
  }
}
