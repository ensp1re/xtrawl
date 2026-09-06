#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { XTrawl } from "../client/client.js";
import { CLI_COMMAND } from "../constants/cli.js";
import { redactText } from "../utils/redact.js";
import { HELP } from "./help.js";
import { collectionOptionsFromCli, parseArgs, searchRequestFromCli, CliUsageError } from "./parser.js";

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let verbose = false;
  try {
    const args = parseArgs(argv);
    verbose = args.verbose;
    if (!args.command) {
      console.log(HELP);
      return 0;
    }
    const pretty = args.options.pretty === true;
    const client = await XTrawl.create({
      authToken: args.authToken,
      csrfToken: args.csrfToken,
      cookiesFile: args.cookiesFile,
      envFile: args.envFile,
      dbPath: args.dbPath,
      proxy: args.proxy,
      concurrency: args.concurrency,
      manifestScrapeOnInit: args.manifestScrapeOnInit,
    });
    try {
      if (verbose)
        console.error(
          `[xtrawl] accounts=${client.poolSummary.total} eligible=${client.poolSummary.eligible} concurrency=${client.config.concurrency}`,
        );
      let result: unknown;
      if (args.command === CLI_COMMAND.SEARCH)
        result = await client.search(args.values[0] ?? "", searchRequestFromCli(args));
      else if (args.command === CLI_COMMAND.TWEET) {
        const tweets = [];
        for (const value of args.values) tweets.push(await client.getTweet(value));
        result = tweets;
      } else if (args.command === CLI_COMMAND.USER_INFO)
        result = await client.getUserInfo(args.values, collectionOptionsFromCli(args));
      else if (args.command === CLI_COMMAND.PROFILE_TWEETS)
        result = await client.getProfileTweets(args.values, collectionOptionsFromCli(args));
      else if (args.command === CLI_COMMAND.FOLLOWERS)
        result = await client.getFollowers(args.values, collectionOptionsFromCli(args));
      else if (args.command === CLI_COMMAND.FOLLOWING)
        result = await client.getFollowing(args.values, collectionOptionsFromCli(args));
      else result = await client.getVerifiedFollowers(args.values, collectionOptionsFromCli(args));
      if (pretty) console.log(JSON.stringify(result, null, 2));
      return 0;
    } finally {
      client.close();
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error(HELP);
      return 2;
    }
    console.error(
      redactText(
        verbose && error instanceof Error
          ? (error.stack ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error),
      ),
    );
    return 1;
  }
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) process.exitCode = await runCli();
