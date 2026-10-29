import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useViewportMode } from "@/core/hooks/useViewportMode";
import { useI18n } from "@/core/i18n/context";
import {
  isMoreSectionPath,
  isPhoneNestedChromePath,
} from "@/core/viewport";
import { IconPanic, NavIcon, type NavIconName } from "./NavIcons";
import styles from "./TabBar.module.css";

const TABS: {
  key: "feed" | "chat" | "notifications" | "more";
  to: string;
  icon: NavIconName;
}[] = [
  { key: "feed", to: "/feed", icon: "feed" },
  { key: "chat", to: "/chat", icon: "chat" },
  { key: "notifications", to: "/notifications", icon: "bell" },
  { key: "more", to: "/more", icon: "more" },
];

function tabActive(key: (typeof TABS)[number]["key"], pathname: string): boolean {
  if (key === "feed") return pathname.startsWith("/feed");
  if (key === "chat") return pathname.startsWith("/chat");
  if (key === "notifications") return pathname.startsWith("/notifications");
  return isMoreSectionPath(pathname);
}

export function TabBar() {
  const mode = useViewportMode();
  const pathname = useLocation().pathname;
  const { t } = useI18n();
  const { enter } = useAntiPanic();

  const requestsQuery = useQuery({
    queryKey: ["dialogue-requests"],
    queryFn: () => api.dialogueInbox(),
    staleTime: 30_000,
  });
  const dialoguesQuery = useQuery({
    queryKey: ["dialogues"],
    queryFn: () => api.myDialogues(),
    staleTime: 5_000,
    refetchInterval: 20_000,
  });

  const unreadQuery = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => api.notificationsUnreadCount(),
    staleTime: 15_000,
    refetchInterval: 90_000,
  });

  if (mode === "desktop") return null;
  if (mode === "phone" && isPhoneNestedChromePath(pathname)) return null;

  const pendingRequests = (requestsQuery.data ?? []).filter(
    (r) => r.status === "pending" || r.status === "approved" || !r.status,
  ).length;
  const chatUnread = (dialoguesQuery.data ?? []).reduce(
    (sum, d) => sum + (d.unread_count ?? 0),
    0,
  );

  const labels = {
    feed: t.nav.feed,
    chat: t.nav.me,
    notifications: t.notifications.title,
    more: t.nav.more,
  };

  function softFor(key: (typeof TABS)[number]["key"]): number | undefined {
    if (key === "chat" && chatUnread + pendingRequests > 0)
      return chatUnread + pendingRequests;
    const unread = unreadQuery.data?.count ?? 0;
    if (key === "notifications" && unread > 0) return unread;
    return undefined;
  }

  return (
    <nav className={styles.bar} aria-label={t.nav.ariaMain} data-chrome="tabbar">
      {TABS.map((tab) => {
        const active = tabActive(tab.key, pathname);
        const label = labels[tab.key];
        const soft = softFor(tab.key);
        return (
          <NavLink
            key={tab.key}
            to={tab.to}
            className={
              active ? `${styles.tab} ${styles.tabActive}` : styles.tab
            }
            aria-current={active ? "page" : undefined}
            aria-label={
              soft != null && soft > 0 ? `${label}. ${soft}` : label
            }
          >
            <span className={styles.iconWrap}>
              <NavIcon name={tab.icon} active={active} />
              {soft != null && soft > 0 ? (
                <span className={styles.dot} aria-hidden />
              ) : null}
            </span>
            <span className={styles.label}>{label}</span>
          </NavLink>
        );
      })}
      <button
        type="button"
        className={styles.panic}
        onClick={enter}
        title={t.nav.panic}
        aria-label={t.nav.panic}
      >
        <span className={styles.iconWrap}>
          <IconPanic />
        </span>
        <span className={styles.label}>{t.nav.panic}</span>
      </button>
    </nav>
  );
}
