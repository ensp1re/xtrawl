import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeJson(path: string, rows: readonly unknown[], append = false): Promise<void> {
  if (rows.length === 0) return;
  let output = [...rows];
  if (append && (await exists(path))) {
    try {
      const current = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (Array.isArray(current)) output = [...current, ...rows];
    } catch {
      output = [...rows];
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
