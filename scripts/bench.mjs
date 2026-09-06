import { ExecutionRunner } from "../dist/runner/runner.js";
import { openStorage } from "../dist/storage/index.js";

const started = Date.now();
const tasks = Array.from({ length: 10_000 }, (_, index) => index);
const seen = new Set();
const runner = new ExecutionRunner({ concurrency: 8, maxAttempts: 1 });
const result = await runner.run(tasks, async (value) => {
  seen.add(value);
});

const storage = openStorage(":memory:");
for (let index = 0; index < 20; index += 1) {
  storage.accounts.upsert({
    username: `user-${index}`,
    cookies: { auth_token: `auth-${index}`, ct0: `csrf-${index}` },
    authToken: `auth-${index}`,
    csrfToken: `csrf-${index}`,
  });
}
let acquires = 0;
for (let index = 0; index < 20; index += 1) {
  const lease = storage.accounts.lease({ requireAuthMaterial: true });
  if (lease) {
    acquires += 1;
    storage.accounts.completeLease({
      leaseId: lease.leaseId,
      now: Date.now(),
      utcDate: new Date().toISOString().slice(0, 10),
      pages: 1,
      tweets: 0,
      status: "healthy",
      availableUntil: 0,
    });
  }
}
storage.database.close();

const report = {
  node: process.version,
  platform: process.platform,
  tasks: tasks.length,
  completed: result.complete.length,
  unique: seen.size,
  duplicates: result.complete.length - seen.size,
  acquires,
  elapsedMs: Date.now() - started,
};
console.log(JSON.stringify(report, null, 2));
if (result.complete.length !== tasks.length || seen.size !== tasks.length) {
  process.exitCode = 1;
}
