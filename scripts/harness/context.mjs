import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

const work = JSON.parse(await readFile(".harness/state/work.json", "utf8"));
const handoff = JSON.parse(await readFile(".harness/state/handoff.json", "utf8"));
console.log(
  JSON.stringify(
    {
      root: process.cwd(),
      git: {
        branch: git(["branch", "--show-current"]),
        head: git(["rev-parse", "HEAD"]),
        status: git(["status", "--short"]),
      },
      task: { id: work.taskId, status: work.status, nextAction: work.nextAction },
      handoff: { status: handoff.status, nextActions: handoff.nextActions },
      verification: work.verification,
    },
    null,
    2,
  ),
);
