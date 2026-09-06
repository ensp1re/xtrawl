import { openStorage } from "../../src/storage/index.js";
import { collectionIdentity } from "../../src/query/collection-id.js";

describe("durable collection progress", () => {
  test("commits a page of records with its cursor in one transaction", () => {
    const storage = openStorage(":memory:");
    const collectionId = collectionIdentity("search", { searchQuery: "hello", since: "2026-01-01" });
    storage.progress.commitPage({
      collectionId,
      taskId: "t1",
      state: "active",
      inputCursor: undefined,
      nextCursor: "next",
      records: [{ id: "1", payload: { tweetId: "1", text: "one" } }],
    });
    expect(storage.progress.accepted(collectionId).map((row) => row.id)).toEqual(["1"]);
    expect(storage.progress.task(collectionId, "t1")).toMatchObject({
      state: "active",
      cursor: "next",
    });
    storage.database.close();
  });

  test("keeps the input cursor when a page is capped", () => {
    const storage = openStorage(":memory:");
    const collectionId = "cap";
    storage.progress.commitPage({
      collectionId,
      taskId: "t1",
      state: "capped",
      inputCursor: "page-start",
      nextCursor: "page-end",
      records: [{ id: "1", payload: { tweetId: "1" } }],
    });
    expect(storage.progress.task(collectionId, "t1")?.cursor).toBe("page-start");
    expect(storage.progress.hasRecord(collectionId, "1")).toBe(true);
    storage.database.close();
  });

  test("ignores output paths when hashing collection identity", () => {
    expect(collectionIdentity("search", { searchQuery: "a", save: true, saveDir: "out" })).toBe(
      collectionIdentity("search", { searchQuery: "a", save: false, saveName: "other" }),
    );
    expect(collectionIdentity("search", { searchQuery: "a" })).not.toBe(
      collectionIdentity("search", { searchQuery: "b" }),
    );
  });
});
