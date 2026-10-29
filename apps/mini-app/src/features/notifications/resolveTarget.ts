import type { AppNotification } from "@/core/api/types";

/** Kind first: payload.story_id must not steal dialogue_request onto the feed. */
export function resolveTarget(n: AppNotification): string | null {
  const p = n.payload ?? {};
  switch (n.kind) {
    case "dialogue_request":
    case "dialogue_request_review":
      return "/chat";
    case "dialogue_deleted":
      return "/chat";
    case "dialogue_opened":
    case "outreach_intro":
    case "message":
      return p.dialogue_id ? `/chat/${p.dialogue_id}` : "/chat";
    case "help_requested":
      // Helpers only: instant match carries dialogue_id, queue pings do not.
      return p.dialogue_id ? `/chat/${p.dialogue_id}` : "/helper";
    case "report_new":
      return "/helper";
    case "help_accepted":
      return p.dialogue_id ? `/chat/${p.dialogue_id}` : "/help/wait";
    case "silent_empathy":
      return p.story_id ? `/feed/${p.story_id}` : "/feed";
    case "support_cloud":
    case "cloud_approved": {
      const postId = p.post_id || p.story_id;
      if (!postId) return "/feed";
      const q = new URLSearchParams();
      if (p.cloud_id) q.set("cloud", p.cloud_id);
      if (p.story_id && p.story_id !== postId) q.set("entry", p.story_id);
      const qs = q.toString();
      return qs ? `/feed/${postId}?${qs}` : `/feed/${postId}`;
    }
    default:
      if (p.dialogue_id) return `/chat/${p.dialogue_id}`;
      if (p.story_id) return `/feed/${p.story_id}`;
      return null;
  }
}