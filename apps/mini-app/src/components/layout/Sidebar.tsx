import { useMemo, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useI18n } from "@/core/i18n/context";
import {
  readNavPrefs,
  type NavKey,
} from "@/core/navOrder";
import { IconPanic, NavIcon, type NavIconName } from "./NavIcons";
import { UserMenu } from "./UserMenu";
import styles from "./Sidebar.module.css";

const KEY_TO_ICON: Record<NavKey, NavIconName> = {
  feed: "feed",
  chat: "chat",
  help: "help",
  patterns: "patterns",
  therapy: "therapy",
  helper: "shield",
};

const KEY_TO_PATH: Record<NavKey, string> = {
  feed: "/feed",
  chat: "/chat",
  help: "/help",
  patterns: "/patterns",
  therapy: "/therapy",
  helper: "/helper",
};

/** Telegram Desktop-style icon rail (~72px). */
export function Sidebar() {
  const { t } = useI18n();
  const { enter } = useAntiPanic();
  const [menuOpen, setMenuOpen] = useState(false);
  const prefs = readNavPrefs();

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

  const isHelper = Boolean(meQuery.data?.is_helper);
  const pendingRequests = (requestsQuery.data ?? []).filter(
    (r) => r.status === "pending" || r.status === "approved" || !r.status,
  ).length;

  const labels = useMemo(
    (): Record<NavKey, string> => ({
      feed: t.nav.feed,
      chat: t.nav.me,
      help: t.nav.help,
      patterns: t.nav.patterns,
      therapy: t.nav.therapy,
      helper: t.nav.helper,
    }),
    [t],
  );

  const visibleKeys = useMemo(() => {
    return prefs.order.filter((key) => {
      if (key === "helper" && !isHelper) return false;
      if (prefs.hidden.includes(key)) return false;
      return true;
    });
  }, [prefs, isHelper]);

  function softFor(key: NavKey): number | undefined {
    if (key === "chat" && pendingRequests > 0) return pendingRequests;
    return undefined;
  }

  return (
    <aside className={styles.rail} aria-label={t.nav.ariaMain}>
      <button
        type="button"
        className={styles.burger}
        aria-label={t.nav.account}
        aria-expanded={menuOpen}
        title={meQuery.data?.pseudonym || t.nav.account}
        onClick={() => setMenuOpen(true)}
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
                isActive ? `${styles.item} ${styles.itemActive}` : styles.item
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
                  <NavIcon name={KEY_TO_ICON[key]} active={isActive} />
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

      <UserMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </aside>
  );
}
