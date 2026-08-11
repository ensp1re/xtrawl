import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { TweetRecord } from "../domain/records.js";
import { writeCsv } from "./csv-writer.js";
import { writeJson } from "./json-writer.js";

export type OutputFormat = "csv" | "json" | "both";

export async function saveRows(
  name: string,
  rows: readonly unknown[],
  options: { readonly directory: string; readonly format: OutputFormat },
): Promise<void> {
  await mkdir(options.directory, { recursive: true });
  if (options.format === "json" || options.format === "both")
    await writeJson(join(options.directory, `${name}.json`), rows);
  if (options.format === "csv" || options.format === "both")
    await writeCsv(join(options.directory, `${name}.csv`), rows.map(toFlatRow));
}

function toFlatRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value };
  const row = value as Record<string, unknown>;
  if ("tweetId" in row) {
    const tweet = row as unknown as TweetRecord;
    return {
      tweetId: tweet.tweetId,
      timestamp: tweet.timestamp,
      username: tweet.user.screenName,
      name: tweet.user.name,
      text: tweet.text,
      likes: tweet.likes,
      retweets: tweet.retweets,
      comments: tweet.comments,
      tweetUrl: tweet.tweetUrl,
      media: tweet.media.imageLinks,
    };
  }
  return row;
}
