/** Sidebar order / visibility — local-only (device preference). */

export type NavKey =
  | "feed"
  | "chat"
  | "notifications"
  | "help"
  | "patterns"
  | "more"
  | "helper";

export const DEFAULT_NAV_ORDER: NavKey[] = [
  "feed",
  "chat",
  "notifications",
  "help",
  "patterns",
  "helper",
  "more",
];

/**
 * Rail items for this role. `helper` is role-gated; `more` is always there so
 * the desktop rail reaches the remaining panes. Therapy is not on the rail —
 * it lives inside the Help pane (owner decision 2026-10-29).
 * Staff are Helpers by invariant (`is_staff ⇒ is_helper`), so `canHelper` is
 * just `me.is_helper`.
 */
export function visibleNavKeys(canHelper: boolean): NavKey[] {
  return DEFAULT_NAV_ORDER.filter((key) => key !== "helper" || canHelper);
}

