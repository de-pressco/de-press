import { describe, expect, it } from "vitest";
import {
  computeInsights,
  dailyAverages,
  parseZkSnapshot,
  summarizePatterns,
  type MoodEntry,
} from "./db";

function entry(at: string, level: number): MoodEntry {
  return { id: `${at}-${level}`, at, level, note: "", tags: [] };
}

describe("dailyAverages", () => {
  // Local 2026-09-08 — day keys must follow the local timezone, not UTC.
  const today = new Date(2026, 8, 8, 15, 0, 0);

  it("returns one row per day, oldest first, null for empty days", () => {
    const rows = dailyAverages(
      [entry("2026-09-08T10:00:00", 2), entry("2026-09-06T22:00:00", 4)],
      3,
      today,
    );
    expect(rows.map((r) => r.date)).toEqual([
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ]);
    expect(rows[0].avg).toBe(4);
    expect(rows[1].avg).toBeNull();
    expect(rows[1].count).toBe(0);
    expect(rows[2].avg).toBe(2);
  });

  it("averages several entries of the same day", () => {
    const rows = dailyAverages(
      [entry("2026-09-08T08:00:00", 1), entry("2026-09-08T20:00:00", 3)],
      1,
      today,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].avg).toBe(2);
    expect(rows[0].count).toBe(2);
  });

  it("rounds the day mean to 0.1", () => {
    const rows = dailyAverages(
      [
        entry("2026-09-08T08:00:00", 1),
        entry("2026-09-08T12:00:00", 2),
        entry("2026-09-08T20:00:00", 2),
      ],
      1,
      today,
    );
    expect(rows[0].avg).toBe(1.7);
  });
});

describe("summarizePatterns", () => {
  const DAY = 24 * 3600 * 1000;
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  it("keeps the plain stats working", () => {
    const s = summarizePatterns([
      entry(iso(1 * DAY), 2),
      entry(iso(2 * DAY), 4),
    ]);
    expect(s.count).toBe(2);
    expect(s.avgLevel).toBe(3);
    expect(s.last7).toBe(2);
  });

  it("compares daily means: a heavy multi-entry day cannot fake a trend", () => {
    // Recent week: one day with 2+3 (mean 2.5). Previous week: one entry 5.
    const entries = [
      entry(iso(1 * DAY), 2),
      entry(iso(1 * DAY + 3600e3), 3),
      entry(iso(9 * DAY), 5),
    ];
    expect(summarizePatterns(entries).trend).toBe("down");
  });

  it("is up when recent days are higher", () => {
    const entries = [
      entry(iso(1 * DAY), 5),
      entry(iso(1 * DAY + 3600e3), 4),
      entry(iso(9 * DAY), 2),
    ];
    expect(summarizePatterns(entries).trend).toBe("up");
  });

  it("is flat when the difference stays within the threshold", () => {
    const entries = [
      entry(iso(1 * DAY), 3),
      entry(iso(1 * DAY + 3600e3), 4),
      entry(iso(9 * DAY), 3),
      entry(iso(9 * DAY + 3600e3), 4),
    ];
    expect(summarizePatterns(entries).trend).toBe("flat");
  });

  it("is unknown without data in the previous-week window", () => {
    const entries = [
      entry(iso(1 * DAY), 2),
      entry(iso(2 * DAY), 3),
      entry(iso(40 * DAY), 5),
    ];
    expect(summarizePatterns(entries).trend).toBe("unknown");
  });

  it("averages energy only over entries that captured it", () => {
    const s = summarizePatterns([
      entry(iso(1 * DAY), 3),
      { ...entry(iso(2 * DAY), 4), energy: 2 },
      { ...entry(iso(3 * DAY), 4), energy: 4 },
    ]);
    expect(s.avgEnergy).toBe(3);
    expect(s.avgLevel).toBe(3.7);
  });

  it("returns null avgEnergy when no entry captured it", () => {
    const s = summarizePatterns([entry(iso(1 * DAY), 3)]);
    expect(s.avgEnergy).toBeNull();
  });
});

describe("computeInsights", () => {
  // Local 2026-09-08 is a Tuesday.
  const today = new Date(2026, 8, 8, 15, 0, 0);
  const at = (y: number, m: number, d: number, h = 12) =>
    new Date(y, m, d, h).toISOString();

  it("reports no data without entries", () => {
    const ins = computeInsights([], today);
    expect(ins.hasData).toBe(false);
    expect(ins.streak).toBe(0);
    expect(ins.bestWeekday).toBeNull();
    expect(ins.topTags).toEqual([]);
  });

  it("counts the streak back from yesterday when today is empty", () => {
    const ins = computeInsights(
      [entry(at(2026, 8, 6), 3), entry(at(2026, 8, 7), 3)],
      today,
    );
    expect(ins.streak).toBe(2);
    expect(ins.days).toBe(2);
  });

  it("gives no streak when the last entry is older than yesterday", () => {
    const ins = computeInsights([entry(at(2026, 8, 4), 3)], today);
    expect(ins.streak).toBe(0);
  });

  it("uses day means for weekdays: a multi-entry day counts once", () => {
    // Tuesday: Sep 1 with 1+2+3 (mean 2) and Sep 8; Monday: 4 and 5.
    const entries = [
      entry(at(2026, 8, 1, 8), 1),
      entry(at(2026, 8, 1, 13), 2),
      entry(at(2026, 8, 1, 20), 3),
      entry(at(2026, 8, 8, 9), 2),
      entry(at(2026, 7, 31, 12), 4),
      entry(at(2026, 8, 7, 12), 5),
    ];
    const ins = computeInsights(entries, today);
    expect(ins.bestWeekday?.weekday).toBe(1); // Monday
    expect(ins.bestWeekday?.avg).toBe(4.5);
    expect(ins.hardWeekday?.weekday).toBe(2); // Tuesday
    expect(ins.hardWeekday?.avg).toBe(2);
  });

  it("skips the weekday pattern until two weekdays have two days each", () => {
    const ins = computeInsights(
      [
        entry(at(2026, 8, 1), 5),
        entry(at(2026, 8, 8, 9), 4),
        entry(at(2026, 8, 7), 2),
      ],
      today,
    );
    expect(ins.bestWeekday).toBeNull();
    expect(ins.hardWeekday).toBeNull();
  });

  it("returns no weekday pattern when every weekday averages the same", () => {
    const ins = computeInsights(
      [
        entry(at(2026, 8, 1), 3),
        entry(at(2026, 8, 8), 3),
        entry(at(2026, 7, 31), 3),
        entry(at(2026, 8, 7), 3),
      ],
      today,
    );
    expect(ins.bestWeekday).toBeNull();
    expect(ins.hardWeekday).toBeNull();
  });

  it("collects top tags overall and on hard days, requiring two hits", () => {
    const mk = (when: string, level: number, tags: string[]): MoodEntry => ({
      id: `${when}-${level}-${tags.join("-")}`,
      at: when,
      level,
      note: "",
      tags,
    });
    const ins = computeInsights(
      [
        mk(at(2026, 8, 8, 8), 1, ["sleep", "money"]),
        mk(at(2026, 8, 7, 8), 2, ["sleep"]),
        mk(at(2026, 8, 6, 8), 5, ["sleep"]),
        mk(at(2026, 8, 5, 8), 4, ["work"]),
      ],
      today,
    );
    expect(ins.topTags).toEqual(["sleep"]);
    expect(ins.hardTags).toEqual(["sleep"]);
  });
});

describe("parseZkSnapshot", () => {
  const snapshot = {
    app: "de-press-zk",
    version: 4,
    exportedAt: "2026-09-08T12:00:00Z",
    data: {
      mood_entries: [
        {
          id: "m1",
          at: "2026-09-08T10:00:00Z",
          level: 9,
          note: "hi",
          tags: ["sleep", "", "sleep"],
          energy: 0,
        },
        { id: "", at: "2026-09-08T10:00:00Z", level: 3 },
        { id: "m2", at: "not-a-date", level: 3 },
        "junk",
      ],
      week_reflections: [
        {
          id: "w1",
          weekStart: "2026-09-07",
          text: "ok week",
          at: "2026-09-08T10:00:00Z",
        },
        {
          id: "w2",
          weekStart: "2026-9-7",
          text: "bad format",
          at: "2026-09-08T10:00:00Z",
        },
      ],
      panic_episodes: [
        { id: "p1", startedAt: "2026-09-08T10:00:00Z" },
        { id: "p2", startedAt: "2026-09-08T10:00:00Z", endedAt: "nope" },
      ],
      companion_messages: [
        { id: "c1", at: "2026-09-08T10:00:00Z", role: "user", content: "hi" },
        { id: "c2", at: "2026-09-08T10:00:00Z", role: "admin", content: "hi" },
      ],
      meta: { analyticsEnabled: false },
    },
  };

  it("parses a valid snapshot and sanitizes rows", () => {
    const parsed = parseZkSnapshot(snapshot);
    expect(parsed).not.toBeNull();
    expect(parsed?.mood).toHaveLength(1);
    expect(parsed?.mood[0]?.level).toBe(5); // 9 clamps to 5
    expect(parsed?.mood[0]?.energy).toBe(1); // 0 clamps to 1
    expect(parsed?.mood[0]?.tags).toEqual(["sleep"]); // dedupe, drop empty
    expect(parsed?.reflections).toHaveLength(1);
    expect(parsed?.episodes).toHaveLength(1);
    expect(parsed?.companion).toHaveLength(1);
    expect(parsed?.meta).toEqual({ analyticsEnabled: false });
  });

  it("rejects foreign or malformed payloads", () => {
    expect(parseZkSnapshot(null)).toBeNull();
    expect(parseZkSnapshot({ app: "other", data: {} })).toBeNull();
    expect(parseZkSnapshot({ app: "de-press-zk" })).toBeNull();
  });
});