#!/usr/bin/env node
import { XTrawl } from "../client/client.js";
import { HELP } from "./help.js";
import { collectionOptionsFromCli, parseArgs, searchRequestFromCli, CliUsageError } from "./parser.js";

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv);
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
      let result: unknown;
      if (args.command === "search")
        result = await client.search(args.values[0] ?? "", searchRequestFromCli(args));
      else if (args.command === "user-info") result = await client.getUserInfo(args.values);
      else if (args.command === "profile-tweets")
        result = await client.getProfileTweets(args.values, collectionOptionsFromCli(args));
      else
        result =
          args.command === "followers"
            ? await client.getFollowers(args.values, collectionOptionsFromCli(args))
            : args.command === "following"
              ? await client.getFollowing(args.values, collectionOptionsFromCli(args))
              : await client.getVerifiedFollowers(args.values, collectionOptionsFromCli(args));
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
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await runCli();
