import { useEffect, useRef, type ReactNode } from "react";
import type { Dialogue } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import type { DialogueActions } from "./useDialogueActions";
import styles from "./ChatMenu.module.css";

export interface ChatMenuState {
  dialogue: Dialogue;
  x: number;
  y: number;
}

interface ChatMenuProps {
  state: ChatMenuState;
  actions: DialogueActions;
  onClose: () => void;
  extra?: ReactNode;
}

export function ChatMenu({ state, actions, onClose, extra }: ChatMenuProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const d = state.dialogue;
  const unread = (d.unread_count ?? 0) > 0 || false;

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const left = Math.min(state.x, window.innerWidth - 240);
  const top = Math.min(state.y, window.innerHeight - 360);

  function run(fn: (d: Dialogue) => unknown) {
    onClose();
    void fn(d);
  }

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left, top }}
    >
      {extra}
      {extra ? <hr className={styles.sep} /> : null}
      <button
        type="button"
        className={styles.item}
        onClick={() => run(d.pinned ? actions.unpin : actions.pin)}
      >
        {d.pinned ? t.chat.menuUnpinChat : t.chat.menuPinChat}
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={() => run(d.muted ? actions.unmute : actions.mute)}
      >
        {d.muted ? t.chat.menuUnmute : t.chat.menuMute}
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={() => run(unread ? actions.markRead : actions.markUnread)}
      >
        {unread ? t.chat.menuMarkRead : t.chat.menuMarkUnread}
      </button>
      <button
        type="button"
        className={`${styles.item} ${styles.danger}`}
        onClick={() => run(actions.clearHistory)}
      >
        {t.chat.menuClearHistory}
      </button>
      {d.peer_hidden ? (
        <button
          type="button"
          className={styles.item}
          onClick={() => run(actions.unblock)}
        >
          {t.chat.menuUnblock}
        </button>
      ) : (
        <button
          type="button"
          className={`${styles.item} ${styles.danger}`}
          onClick={() => run(actions.block)}
        >
          {t.chat.menuBlock}
        </button>
      )}
      <button
        type="button"
        className={`${styles.item} ${styles.danger}`}
        onClick={() => run(actions.remove)}
      >
        {t.chat.menuDelete}
      </button>
    </div>
  );
}
