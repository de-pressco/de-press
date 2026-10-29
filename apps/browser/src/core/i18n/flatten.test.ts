import { describe, expect, it } from "vitest";
import { en } from "./messages/en";
import { applyFlat, catalogHash, flattenMessages, fmt } from "./flatten";

describe("fmt", () => {
  it("replaces {count}", () => {
    expect(fmt("{count} unread", { count: 3 })).toBe("3 unread");
  });
});

describe("flattenMessages", () => {
  it("round-trips the English catalog strings", () => {
    const flat = flattenMessages(en);
    expect(flat["nav.feed"]).toBe("Feed");
    expect(flat["antiPanic.groundSteps.0"]).toBeTruthy();
    const back = applyFlat(en, flat);
    expect(flattenMessages(back)).toEqual(flat);
  });

  it("hash is stable for the same catalog", () => {
    const a = catalogHash(flattenMessages(en));
    const b = catalogHash(flattenMessages(en));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("applyFlat", () => {
  it("swaps leaf strings and keeps the rest of the tree", () => {
    const flat = flattenMessages(en);
    const translated = { ...flat, "nav.feed": "FEED!" };
    const out = applyFlat(en, translated);
    expect(flattenMessages(out)).toEqual(translated);
  });
});

describe("catalog budget", () => {
  it("stays under the backend MAX_KEYS limit (690)", () => {
    expect(Object.keys(flattenMessages(en)).length).toBeLessThanOrEqual(689);
  });
});
