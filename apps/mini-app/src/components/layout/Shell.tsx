import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/core/i18n/context";
import { useNotifications } from "@/core/hooks/useNotifications";
import { useToast } from "@/core/toast";
import type { AppNotification } from "@/core/api/types";
import { resolveTarget } from "@/features/notifications/resolveTarget";
import { AntiPanicOverlay } from "@/features/anti-panic/AntiPanicOverlay";
import { Sidebar } from "./Sidebar";
import styles from "./Shell.module.css";

const MUTE_ON_CHAT_PAGE_KINDS = new Set<AppNotification["kind"]>([
  "dialogue_request",
  "dialogue_opened",
  "outreach_intro",
  "message",
]);

/** Live nudges over WS: toast + tap-to-open. */
function LiveNotifications() {
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  useNotifications(true, (n: AppNotification) => {
    const dialogueId = n.payload?.dialogue_id;
    if (
      dialogueId &&
      MUTE_ON_CHAT_PAGE_KINDS.has(n.kind) &&
      location.pathname === `/chat/${dialogueId}`
    ) {
      return; // already reading this dialogue
    }
    void toast
      .choose({
        message: t.notifications.kind[n.kind] ?? n.kind,
        actions: [{ id: "open", label: t.notifications.openNotice }],
        cancelLabel: t.auth.closeMenu,
      })
      .then((id) => {
        if (id === "open") {
          const target = resolveTarget(n);
          if (target) navigate(target);
        }
      });
  });
  return null;
}

export function Shell() {
  const { t } = useI18n();
  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        {t.nav.skipToContent}
      </a>
      <Sidebar />
      <main id="main" className={styles.content}>
        <Outlet />
      </main>
      <AntiPanicOverlay />
      <LiveNotifications />
    </div>
  );
}
