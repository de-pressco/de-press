export type ViewportMode = "phone" | "tablet" | "desktop";

export const BP_PHONE_MAX = 759;
export const BP_TABLET_MAX = 1099;

export function modeFromWidth(width: number): ViewportMode {
  if (width <= BP_PHONE_MAX) return "phone";
  if (width <= BP_TABLET_MAX) return "tablet";
  return "desktop";
}

export function isSplitIndexPath(pathname: string): boolean {
  return (
    pathname === "/feed" ||
    pathname === "/feed/" ||
    pathname === "/feed/mine" ||
    pathname === "/chat" ||
    pathname === "/chat/"
  );
}

export function isPhoneNestedChromePath(pathname: string): boolean {
  if (isSplitIndexPath(pathname)) return false;
  return pathname.startsWith("/feed") || pathname.startsWith("/chat");
}

export function isMoreSectionPath(pathname: string): boolean {
  return (
    pathname === "/more" ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/help") ||
    pathname.startsWith("/patterns") ||
    pathname.startsWith("/helper") ||
    pathname.startsWith("/inbox")
  );
}
