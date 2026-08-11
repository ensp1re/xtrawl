import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

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
console.log("package_check=passed");
