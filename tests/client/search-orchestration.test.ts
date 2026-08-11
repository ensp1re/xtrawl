import type { SearchRequest } from "../../src/domain/requests.js";
import { splitSearchTasks, withDefaultBounds } from "../../src/client/search.js";

describe("search orchestration", () => {
  test("defaults to a thirty-day UTC interval", () => {
    const request = withDefaultBounds({}, new Date("2026-08-11T18:00:00.000Z"));
    expect(request).toMatchObject({ since: "2026-07-12", until: "2026-08-11" });
  });

  test("splits a bounded interval without gaps", () => {
    const request: SearchRequest = { searchQuery: "typescript", since: "2026-08-01", until: "2026-08-11" };
    const tasks = splitSearchTasks(request, 5, 60_000);
    expect(tasks).toHaveLength(5);
    expect(tasks[0]?.request.since).toBe("2026-08-01_00:00:00_UTC");
    expect(tasks.at(-1)?.request.until).toBe("2026-08-11_00:00:00_UTC");
    for (let index = 1; index < tasks.length; index += 1)
      expect(tasks[index]?.request.since).toBe(tasks[index - 1]?.request.until);
  });

  test("does not produce intervals below the scheduler floor", () => {
    const request: SearchRequest = {
      since: "2026-08-11_10:00:00_UTC",
      until: "2026-08-11_10:04:00_UTC",
    };
    expect(splitSearchTasks(request, 5, 5 * 60_000)).toHaveLength(1);
  });
});
