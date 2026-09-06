import type { ProfileRecord } from "../domain/records.js";
import type { TargetInput, UserInfoRequest } from "../domain/requests.js";
import { ConfigError, RunFailed } from "../domain/errors.js";
import { mapProfile } from "../engine/extractors.js";
import { saveRows } from "../output/writer.js";
import { targetOutputName } from "../output/names.js";
import { targetUsername } from "../query/builder.js";
import { ExecutionRunner } from "../runner/runner.js";
import type { CollectionContext } from "./collectors.js";

export async function collectProfiles(
  context: CollectionContext,
  targets: readonly TargetInput[],
  options: UserInfoRequest,
): Promise<readonly ProfileRecord[]> {
  const records = new Map<number, ProfileRecord>();
  for (const target of targets) {
    if (targetUsername(target)) continue;
    if (target.userId)
      throw new ConfigError(
        `Profile lookup requires a username; numeric id ${target.userId} is not supported.`,
      );
    throw new ConfigError("Profile lookup requires a username.");
  }
  const tasks = targets.map((target, index) => ({ index, target }));
  const runner = new ExecutionRunner<(typeof tasks)[number]>({
    concurrency: Math.max(
      1,
      Math.min(context.config.concurrency, context.pool.summary.eligible, tasks.length),
    ),
    maxAttempts: 1,
  });
  const outcome = await runner.run(tasks, async ({ index, target }) => {
    const username = targetUsername(target);
    if (!username) return;
    const user = await context.pool.execute(
      "user-info",
      ({ session, signal, chargeRequest }) =>
        context.engine.lookupUser(session, username, signal ?? context.signal, chargeRequest),
      context.signal ? { signal: context.signal } : {},
    );
    records.set(index, mapProfile(user, target, username));
  });
  if (outcome.failed.length > 0 && (context.config.strict || records.size === 0)) {
    const first = outcome.failed[0]?.error;
    throw first instanceof RunFailed
      ? first
      : new RunFailed(`Profile lookup failed for ${outcome.failed.length} target(s): ${String(first)}`);
  }
  const result = [...records.entries()].sort(([left], [right]) => left - right).map(([, value]) => value);
  if (options.save)
    await saveRows(options.saveName ?? targetOutputName("user_info", targets), result, {
      directory: options.saveDir ?? context.config.saveDir,
      format: options.saveFormat ?? context.config.saveFormat,
      append: true,
    });
  return result;
}
