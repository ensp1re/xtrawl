import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const required = ["dist/index.js", "dist/cli/main.js", "dist/index.d.ts"];
for (const relative of required) {
  await access(join(root, relative));
}
if (packageJson.name !== "xtrawl") {
  throw new Error("unexpected package name");
}
if (packageJson.bin?.xtrawl !== "./dist/cli/main.js") {
  throw new Error("unexpected CLI binary");
}
const smoke = await execFileAsync(process.execPath, [join(root, "scripts/live-smoke.mjs"), "--help"], {
  cwd: root,
});
if (!smoke.stdout.includes("Run every XTrawl read endpoint")) {
  throw new Error("unexpected live smoke help output");
}
console.log("package_check=passed");
