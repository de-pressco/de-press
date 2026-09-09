import { createContext, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useNotifications } from "@/core/hooks/useNotifications";
import { useVisualViewportInset } from "@/core/hooks/useVisualViewportInset";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";
import type { AppNotification, NotificationKind } from "@/core/api/types";
import { resolveTarget } from "@/features/notifications/resolveTarget";
import { AntiPanicOverlay } from "@/features/anti-panic/AntiPanicOverlay";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { UserMenu } from "./UserMenu";
import styles from "./Shell.module.css";

export const AccountMenuContext = createContext<{ open: () => void } | null>(
  null,
);

const CHAT_NOTICE_KINDS = new Set<NotificationKind>([
  "dialogue_request",
  "dialogue_opened",
  "outreach_intro",
  "dialogue_deleted",
  "support_cloud",
  "cloud_approved",
]);

/** Already looking at chats — list/inbox updates in place, no toast. */
const MUTE_ON_CHAT_PAGE = new Set<NotificationKind>([
  "dialogue_request",
  "dialogue_opened",
  "outreach_intro",
]);

function onChatPage(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

function LiveNotifications() {
  const { active } = useAntiPanic();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  useNotifications(!active, (n: AppNotification) => {
    if (active) return;
    if (!CHAT_NOTICE_KINDS.has(n.kind)) return;
    if (onChatPage(location.pathname) && MUTE_ON_CHAT_PAGE.has(n.kind)) return;
    const dialogueId = n.payload?.dialogue_id;
    if (dialogueId && location.pathname === `/chat/${dialogueId}`) return;
    void toast
      .choose({
        message: t.notifications.kind[n.kind] ?? n.kind,
        actions: [{ id: "open", label: t.notifications.openNotice }],
        cancelLabel: t.auth.closeMenu,
      })
      .then((id) => {
        if (id === "open") navigate(resolveTarget(n) ?? "/chat");
      });
  });
  return null;
}

export function Shell() {
  const { t } = useI18n();
  const [accountOpen, setAccountOpen] = useState(false);
  const keyboardInset = useVisualViewportInset();
  const account = useMemo(
    () => ({ open: () => setAccountOpen(true) }),
    [],
  );

  return (
    <AccountMenuContext.Provider value={account}>
      <div
        className={styles.shell}
        style={{ ["--keyboard-inset" as string]: `${keyboardInset}px` }}
      >
        <a href="#main" className={styles.skip}>
          {t.nav.skipToContent}
        </a>
        <Sidebar
          accountOpen={accountOpen}
          onOpenAccount={() => setAccountOpen(true)}
        />
        <main id="main" className={styles.content}>
          <Outlet />
        </main>
        <TabBar />
        <UserMenu open={accountOpen} onClose={() => setAccountOpen(false)} />
        <AntiPanicOverlay />
        <LiveNotifications />
      </div>
    </AccountMenuContext.Provider>
  );
}
