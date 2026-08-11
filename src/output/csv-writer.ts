import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeCsv(
  path: string,
  rows: readonly Record<string, unknown>[],
  append = false,
): Promise<void> {
  if (rows.length === 0) return;
  const existing = append && (await exists(path)) ? await readFile(path, "utf8") : "";
  const parsedExisting = existing ? parseCsv(existing) : [];
  const currentHeaders = parsedExisting[0] ?? [];
  const headers = mergeHeaders(
    currentHeaders,
    rows.flatMap((row) => Object.keys(row)),
  );
  const existingRows = parsedExisting
    .slice(1)
    .map((values) =>
      Object.fromEntries(currentHeaders.map((header, index) => [header, values[index] ?? ""])),
    );
  const content = renderCsv(headers, [...existingRows, ...rows]);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function renderCsv(headers: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const body = rows.map((row) => headers.map((header) => escapeCsv(flattenValue(row[header]))).join(","));
  return `${headers.map(escapeCsv).join(",")}\n${body.join("\n")}\n`;
}

function mergeHeaders(existing: readonly string[], incoming: readonly string[]): string[] {
  const preferred = [
    "tweetId",
    "timestamp",
    "username",
    "name",
    "text",
    "likes",
    "retweets",
    "comments",
    "tweetUrl",
  ];
  const all = [...new Set([...existing, ...incoming])];
  return [...preferred.filter((key) => all.includes(key)), ...all.filter((key) => !preferred.includes(key))];
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function flattenValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function escapeCsv(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
