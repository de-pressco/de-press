import { describe, expect, it } from "vitest";

import { waitTone } from "./waitTone";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("waitTone", () => {
  it("is fresh under five minutes", () => {
    expect(waitTone(ago(0), NOW)).toBe("fresh");
    expect(waitTone(ago(4 * 60_000 + 59_000), NOW)).toBe("fresh");
  });

  it("warms up at exactly five minutes", () => {
    expect(waitTone(ago(5 * 60_000), NOW)).toBe("warm");
    expect(waitTone(ago(14 * 60_000 + 59_000), NOW)).toBe("warm");
  });

  it("becomes urgent at fifteen minutes", () => {
    expect(waitTone(ago(15 * 60_000), NOW)).toBe("urgent");
    expect(waitTone(ago(3 * 60 * 60_000), NOW)).toBe("urgent");
  });

  it("treats an unparsable timestamp as fresh", () => {
    expect(waitTone("not-a-date", NOW)).toBe("fresh");
  });
});