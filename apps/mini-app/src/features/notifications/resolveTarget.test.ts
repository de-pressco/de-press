import { describe, expect, it } from "vitest";
import { resolveTarget } from "./resolveTarget";
import type { AppNotification } from "@/core/api/types";

function note(
  kind: AppNotification["kind"],
  payload: Record<string, string> = {},
): AppNotification {
  return {
    id: "n1",
    kind,
    payload,
    is_read: false,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("resolveTarget", () => {
  it("sends dialogue requests to the chat list, not the feed", () => {
    expect(resolveTarget(note("dialogue_request", { story_id: "s1" }))).toBe(
      "/chat",
    );
    expect(resolveTarget(note("dialogue_deleted"))).toBe("/chat");
  });

  it("deep-links dialogue events when payload carries the id", () => {
    expect(resolveTarget(note("message", { dialogue_id: "d7" }))).toBe(
      "/chat/d7",
    );
    expect(resolveTarget(note("outreach_intro", { dialogue_id: "d2" }))).toBe(
      "/chat/d2",
    );
  });

  it("routes helper pings to the helper queue", () => {
    expect(resolveTarget(note("help_requested", { request_id: "r1" }))).toBe(
      "/helper",
    );
    expect(
      resolveTarget(note("help_requested", { request_id: "r1", dialogue_id: "d4" })),
    ).toBe("/chat/d4");
    expect(resolveTarget(note("report_new", { report_id: "rp1" }))).toBe(
      "/helper",
    );
  });

  it("points silent empathy at the story", () => {
    expect(resolveTarget(note("silent_empathy", { story_id: "s5" }))).toBe(
      "/feed/s5",
    );
  });
});