/** Sidebar order / visibility — local-only (device preference). */

export type NavKey =
  | "feed"
  | "chat"
  | "help"
  | "patterns"
  | "therapy"
  | "more"
  | "helper";

export const DEFAULT_NAV_ORDER: NavKey[] = [
  "feed",
  "chat",
  "help",
  "patterns",
  "therapy",
  "helper",
  "more",
];

/**
 * Rail items for this role. `helper` is role-gated; therapy and more are always
 * there so the desktop rail reaches every pane (owner decision 2026-10-27).
 * Staff are Helpers by invariant (`is_staff ⇒ is_helper`), so `canHelper` is
 * just `me.is_helper`.
 */
export function visibleNavKeys(canHelper: boolean): NavKey[] {
  return DEFAULT_NAV_ORDER.filter((key) => key !== "helper" || canHelper);
}

