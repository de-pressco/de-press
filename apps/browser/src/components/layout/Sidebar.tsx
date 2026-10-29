import { useMemo, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useI18n } from "@/core/i18n/context";
import { visibleNavKeys, type NavKey } from "@/core/navOrder";
import { IconPanic, NavIcon, type NavIconName } from "./NavIcons";
import styles from "./Sidebar.module.css";

const KEY_TO_ICON: Record<NavKey, NavIconName> = {
  feed: "feed",
  chat: "chat",
  notifications: "bell",
  help: "help",
  patterns: "patterns",
  therapy: "therapy",
  helper: "shield",
  more: "more",
};

const KEY_TO_PATH: Record<NavKey, string> = {
  feed: "/feed",
  chat: "/chat",
  notifications: "/notifications",
  help: "/help",
  patterns: "/patterns",
  therapy: "/therapy",
  helper: "/helper",
  more: "/more",
};

/** Telegram Desktop-style icon rail (~72px). */
export function Sidebar({
  onOpenAccount,
  accountOpen,
}: {
  onOpenAccount: () => void;
  accountOpen: boolean;
}) {
  const { t } = useI18n();
  const { enter } = useAntiPanic();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    staleTime: 60_000,
  });

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

  const canHelper = Boolean(meQuery.data?.is_helper);
  const pendingRequests = (requestsQuery.data ?? []).filter(
    (r) => r.status === "pending" || r.status === "approved" || !r.status,
  ).length;
  const chatUnread = (dialoguesQuery.data ?? []).reduce(
    (sum, d) => sum + (d.unread_count ?? 0),
    0,
  );

  const labels = useMemo(
    (): Record<NavKey, string> => ({
      feed: t.nav.feed,
      chat: t.nav.me,
      notifications: t.notifications.title,
      help: t.nav.help,
      patterns: t.nav.patterns,
      therapy: t.nav.therapy,
      helper: t.nav.helper,
      more: t.nav.more,
    }),
    [t],
  );

  const visibleKeys = useMemo(() => visibleNavKeys(canHelper), [canHelper]);

  function softFor(key: NavKey): number | undefined {
    if (key === "chat" && chatUnread + pendingRequests > 0)
      return chatUnread + pendingRequests;
    const unread = unreadQuery.data?.count ?? 0;
    if (key === "notifications" && unread > 0) return unread;
    return undefined;
  }

  const { pathname } = useLocation();
  // /settings has no rail icon of its own — keep the More rail item lit.
  const moreSection = pathname.startsWith("/settings");

  return (
    <aside className={styles.rail} data-chrome="rail" aria-label={t.nav.ariaMain}>
      <button
        type="button"
        className={styles.burger}
        aria-label={t.nav.account}
        aria-expanded={accountOpen}
        title={meQuery.data?.pseudonym || t.nav.account}
        onClick={onOpenAccount}
      >
        <span className={styles.burgerAvatar} aria-hidden>
          {(meQuery.data?.pseudonym || "·").slice(0, 1).toUpperCase()}
        </span>
      </button>

      <nav className={styles.nav}>
        {visibleKeys.map((key) => {
          const soft = softFor(key);
          const label = labels[key];
          return (
            <NavLink
              key={key}
              to={KEY_TO_PATH[key]}
              className={({ isActive }) =>
                isActive || (key === "more" && moreSection)
                  ? `${styles.item} ${styles.itemActive}`
                  : styles.item
              }
              title={label}
              aria-label={
                soft != null && soft > 0
                  ? `${label}. ${soft}`
                  : label
              }
            >
              {({ isActive }): ReactNode => (
                <>
                  <NavIcon
                    name={KEY_TO_ICON[key]}
                    active={isActive || (key === "more" && moreSection)}
                  />
                  {soft != null && soft > 0 ? (
                    <span className={styles.dot} aria-hidden />
                  ) : null}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        className={styles.panic}
        onClick={enter}
        title={t.nav.panic}
        aria-label={t.nav.panic}
      >
        <IconPanic />
      </button>
    </aside>
  );
}
