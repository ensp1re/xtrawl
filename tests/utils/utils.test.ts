import {
  asBoolean,
  asInteger,
  asNumber,
  asRecord,
  asString,
  asStringList,
  isRecord,
} from "../../src/utils/guards.js";
import { stableJson, tokenFingerprint } from "../../src/utils/fingerprint.js";

describe("runtime guards and fingerprints", () => {
  test("coerces boundary values predictably", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(asRecord(null)).toEqual({});
    expect(asString("  value ")).toBe("value");
    expect(asString(" ")).toBeUndefined();
    expect(asNumber("2.5")).toBe(2.5);
    expect(asInteger("2.9")).toBe(2);
    expect(asBoolean("yes")).toBe(true);
    expect(asBoolean("off")).toBe(false);
    expect(asStringList([" a ", "", 2])).toEqual(["a", "2"]);
  });

  test("produces stable non-secret fingerprints and ordered JSON", () => {
    expect(tokenFingerprint("secret")).toMatch(/^[a-f0-9]{10}$/u);
    expect(tokenFingerprint("secret")).toBe(tokenFingerprint("secret"));
    expect(stableJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
