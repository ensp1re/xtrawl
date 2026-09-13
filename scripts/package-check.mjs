import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const required = ["dist/index.js", "dist/cli/main.js", "dist/index.d.ts", "LICENSE"];
for (const relative of required) {
  await access(join(root, relative));
}
if (packageJson.name !== "xtrawl") {
  throw new Error("unexpected package name");
}
if (packageJson.version !== "0.1.3") {
  throw new Error("unexpected package version");
}
if (packageJson.license !== "MIT") {
  throw new Error("unexpected package license");
}
if (packageJson.main !== "./dist/index.js" || packageJson.types !== "./dist/index.d.ts") {
  throw new Error("unexpected package entry point");
}
if (packageJson.bin?.xtrawl !== "dist/cli/main.js") {
  throw new Error("unexpected CLI binary");
}
const expectedFiles = ["dist", "README.md", "DOCUMENTATION.md", "LICENSE", "docs"];
if (JSON.stringify(packageJson.files) !== JSON.stringify(expectedFiles)) {
  throw new Error("unexpected npm package allowlist");
}
if (packageJson.publishConfig?.access !== "public") {
  throw new Error("npm package must publish with public access");
}

const skill = await readFile(join(root, "skills/xtrawl/SKILL.md"), "utf8");
if (!skill.startsWith("---\nname: xtrawl\ndescription: ")) {
  throw new Error("agent skill frontmatter must start with name: xtrawl and a description");
}
if (!skill.includes(`xtrawl@${packageJson.version}`) || skill.includes("xtrawl@latest")) {
  throw new Error("agent skill must pin the current package version");
}
const skillAgents = [
  "claude-code",
  "cursor",
  "codex",
  "opencode",
  "github-copilot",
  "gemini-cli",
  "grok",
  "windsurf",
];
for (const agent of skillAgents) {
  if (!skill.includes(`npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent ${agent}\n`)) {
    throw new Error(`agent skill is missing the install line for ${agent}`);
  }
}

const smokeDirectory = await mkdtemp(join(tmpdir(), "xtrawl-package-check-"));
try {
  const cliLink = join(smokeDirectory, "xtrawl");
  await symlink(join(root, "dist/cli/main.js"), cliLink);
  const cli = spawnSync(process.execPath, [cliLink, "--help"], { encoding: "utf8" });
  if (cli.status !== 0 || !cli.stdout.includes("Usage:")) {
    throw new Error(`installed CLI smoke check failed: ${cli.stderr || cli.stdout}`);
  }
} finally {
  await rm(smokeDirectory, { recursive: true, force: true });
}

console.log("package_check=passed");
