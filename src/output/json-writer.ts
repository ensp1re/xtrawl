import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { EngineError } from "../domain/errors.js";
import { withDestinationLock } from "./lock.js";

export async function writeJson(path: string, rows: readonly unknown[], append = false): Promise<void> {
  if (rows.length === 0) return;
  await withDestinationLock(path, async () => {
    let output = [...rows];
    if (append && (await exists(path))) {
      let current: unknown;
      try {
        current = JSON.parse(await readFile(path, "utf8")) as unknown;
      } catch {
        throw new EngineError(`Refusing to append to malformed JSON file: ${path}`);
      }
      if (!Array.isArray(current))
        throw new EngineError(`Refusing to append to a JSON file that is not an array: ${path}`);
      output = [...current, ...rows];
    }
    await atomicWrite(path, `${JSON.stringify(output, null, 2)}\n`);
  });
}

export async function writeNdjson(path: string, rows: readonly unknown[], append = false): Promise<void> {
  if (rows.length === 0) return;
  await withDestinationLock(path, async () => {
    const chunk = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    if (!append || !(await exists(path))) {
      await atomicWrite(path, chunk);
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, chunk, "utf8");
  });
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
