import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { EngineError } from "../../src/domain/errors.js";
import { writeCsv } from "../../src/output/csv-writer.js";
import { writeJson, writeNdjson } from "../../src/output/json-writer.js";
import { saveRows } from "../../src/output/writer.js";

describe("output writers", () => {
  test("writes CSV with stable preferred headers and escaped values", async () => {
    const root = mkdtempSync(join(tmpdir(), "graph-output-"));
    const path = join(root, "rows.csv");
    await writeCsv(path, [
      { text: "hello, world", likes: 2 },
      { text: "line\nbreak", likes: 3 },
    ]);
    const value = readFileSync(path, "utf8");
    expect(value).toContain('"hello, world"');
    expect(value).toContain('"line\nbreak",3');
  });

  test("appends JSON and CSV rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "graph-output-"));
    const json = join(root, "rows.json");
    const csv = join(root, "rows.csv");
    await writeJson(json, [{ id: 1 }]);
    await writeJson(json, [{ id: 2 }], true);
    expect(JSON.parse(readFileSync(json, "utf8")) as unknown).toEqual([{ id: 1 }, { id: 2 }]);
    await writeCsv(csv, [{ id: 1, text: "one" }]);
    await writeCsv(csv, [{ id: 2, text: "two" }], true);
    expect(readFileSync(csv, "utf8").split("\n")).toHaveLength(4);
  });

  test("rejects CSV appends that would change the header schema", async () => {
    const root = mkdtempSync(join(tmpdir(), "graph-output-"));
    const path = join(root, "mixed.csv");
    await writeCsv(path, [{ username: "one", text: "first" }]);
    await expect(writeCsv(path, [{ username: "two", likes: 2 }], true)).rejects.toBeInstanceOf(EngineError);
    expect(readFileSync(path, "utf8")).toContain("one");
    expect(readFileSync(path, "utf8")).not.toContain("likes");
  });

  test("preserves a corrupt JSON file instead of overwriting it on append", async () => {
    const root = mkdtempSync(join(tmpdir(), "graph-output-"));
    const path = join(root, "broken.json");
    writeFileSync(path, "[{");
    await expect(writeJson(path, [{ id: 1 }], true)).rejects.toBeInstanceOf(EngineError);
    expect(readFileSync(path, "utf8")).toBe("[{");
  });

  test("appends NDJSON without rereading the existing file as JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "graph-output-"));
    const path = join(root, "rows.ndjson");
    await writeNdjson(path, [{ id: 1 }]);
    await writeNdjson(path, [{ id: 2 }], true);
    expect(readFileSync(path, "utf8")).toBe('{"id":1}\n{"id":2}\n');
  });

  test("saves JSON and flattened CSV together", async () => {
    const root = mkdtempSync(join(tmpdir(), "graph-output-"));
    await saveRows(
      "tweets",
      [
        {
          tweetId: "1",
          user: { screenName: "demo", name: "Demo" },
          text: "hello",
          media: { imageLinks: [] },
          likes: 1,
          retweets: 0,
          comments: 0,
        },
      ],
      { directory: root, format: "both" },
    );
    expect(readFileSync(join(root, "tweets.json"), "utf8")).toContain("tweetId");
    expect(readFileSync(join(root, "tweets.csv"), "utf8")).toContain("tweetId");
  });

  test("does not create files for empty rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "graph-output-"));
    await writeJson(join(root, "empty.json"), []);
    await writeCsv(join(root, "empty.csv"), []);
    expect(() => readFileSync(join(root, "empty.json"))).toThrow();
    expect(() => readFileSync(join(root, "empty.csv"))).toThrow();
  });

  test("omits raw relationship payloads from CSV while retaining them in JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "xtrawl-output-"));
    await saveRows("followers", [{ userId: "1", username: "demo", raw: { private: "nested" } }], {
      directory: root,
      format: "both",
    });
    expect(readFileSync(join(root, "followers.csv"), "utf8")).not.toContain("private");
    expect(readFileSync(join(root, "followers.json"), "utf8")).toContain("private");
  });
});
