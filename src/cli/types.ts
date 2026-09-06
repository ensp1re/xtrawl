import type { CLI_COMMAND } from "../constants/cli.js";

export type CliCommand = (typeof CLI_COMMAND)[keyof typeof CLI_COMMAND];

export interface CliArgs {
  readonly authToken?: string;
  readonly csrfToken?: string;
  readonly cookiesFile?: string;
  readonly envFile?: string;
  readonly dbPath: string;
  readonly proxy?: string;
  readonly concurrency: number;
  readonly manifestScrapeOnInit: boolean;
  readonly verbose: boolean;
  readonly command?: CliCommand;
  readonly values: readonly string[];
  readonly options: Readonly<Record<string, string | boolean | readonly string[]>>;
}
