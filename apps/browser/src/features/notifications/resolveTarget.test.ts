import { describe, expect, it } from "vitest";
import { resolveTarget } from "./resolveTarget";
import type { AppNotification } from "@/core/api/types";

function note(kind: AppNotification["kind"], payload: Record<string, string> = {}): AppNotification {
  return { id: "n1", kind, payload, is_read: false, created_at: "2026-01-01T00:00:00Z" };
}

describe("resolveTarget", () => {
  it("sends dialogue requests to the chat list, not the feed", () => {
    expect(resolveTarget(note("dialogue_request", { story_id: "s1" }))).toBe("/chat");
    expect(resolveTarget(note("dialogue_request_review", { request_id: "r2" }))).toBe(
      "/chat",
    );
    expect(resolveTarget(note("dialogue_deleted"))).toBe("/chat");
  });

  it("deep-links dialogue events when payload carries the id", () => {
    expect(resolveTarget(note("message", { dialogue_id: "d7" }))).toBe("/chat/d7");
    expect(resolveTarget(note("dialogue_opened"))).toBe("/chat");
    expect(resolveTarget(note("outreach_intro", { dialogue_id: "d2" }))).toBe("/chat/d2");
  });

  it("routes help request notifications", () => {
    expect(resolveTarget(note("help_requested", { request_id: "r1" }))).toBe(
      "/helper",
    );
    // instant match carries the dialogue: go straight to the chat
    expect(
      resolveTarget(note("help_requested", { request_id: "r1", dialogue_id: "d4" })),
    ).toBe("/chat/d4");
    expect(resolveTarget(note("report_new", { report_id: "rp1" }))).toBe(
      "/helper",
    );
    expect(resolveTarget(note("help_accepted", { dialogue_id: "d3" }))).toBe("/chat/d3");
    expect(resolveTarget(note("help_accepted"))).toBe("/help/wait");
  });

  it("points silent empathy at the story", () => {
    expect(resolveTarget(note("silent_empathy", { story_id: "s5" }))).toBe("/feed/s5");
    expect(resolveTarget(note("silent_empathy"))).toBe("/feed");
  });

  it("builds cloud query for support clouds and approvals", () => {
    expect(
      resolveTarget(note("support_cloud", { post_id: "p1", cloud_id: "c1", story_id: "p1" })),
    ).toBe("/feed/p1?cloud=c1");

    expect(
      resolveTarget(note("cloud_approved", { post_id: "p1", cloud_id: "c1", story_id: "e2" })),
    ).toBe("/feed/p1?cloud=c1&entry=e2");

    expect(resolveTarget(note("support_cloud"))).toBe("/feed");
  });

  it("falls back by payload for unknown kinds", () => {
    // A kind that does not exist in the union yet must still route sanely.
    const future = "future_kind" as AppNotification["kind"];
    expect(resolveTarget(note(future, { dialogue_id: "d9" }))).toBe("/chat/d9");
    expect(resolveTarget(note(future, { story_id: "s9" }))).toBe("/feed/s9");
    expect(resolveTarget(note(future))).toBeNull();
  });
});
