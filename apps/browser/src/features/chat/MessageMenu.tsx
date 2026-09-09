import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import styles from "./MessageMenu.module.css";

export interface MessageMenuState {
  message: ChatMessage;
  x: number;
  y: number;
}

interface MessageMenuProps {
  state: MessageMenuState;
  chatOpen: boolean;
  pinnedId?: string | null;
  onClose: () => void;
  onReply: (m: ChatMessage) => void;
  onCopy: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
  onPin: (m: ChatMessage) => void;
  onUnpin: () => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onReport: (m: ChatMessage) => void;
  onTranslate: (m: ChatMessage) => void;
}

export function MessageMenu({
  state,
  chatOpen,
  pinnedId,
  onClose,
  onReply,
  onCopy,
  onForward,
  onPin,
  onUnpin,
  onEdit,
  onDelete,
  onReport,
  onTranslate,
}: MessageMenuProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const m = state.message;
  const own = Boolean(m.from_me) && !m.is_system;
  const pinned = pinnedId === m.id;
  const canWrite = chatOpen && !m.deleted && !m.is_system;

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

  const left = Math.min(state.x, window.innerWidth - 200);
  const top = Math.min(state.y, window.innerHeight - 280);

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left, top }}
    >
      {canWrite ? (
        <button type="button" className={styles.item} onClick={() => onReply(m)}>
          {t.chat.menuReply}
        </button>
      ) : null}
      <button type="button" className={styles.item} onClick={() => onCopy(m)}>
        {t.chat.menuCopy}
      </button>
      {canWrite ? (
        <button type="button" className={styles.item} onClick={() => onForward(m)}>
          {t.chat.menuForward}
        </button>
      ) : null}
      {canWrite ? (
        <button
          type="button"
          className={styles.item}
          onClick={() => (pinned ? onUnpin() : onPin(m))}
        >
          {pinned ? t.chat.menuUnpin : t.chat.menuPin}
        </button>
      ) : null}
      {own && canWrite && m.kind === "text" ? (
        <button type="button" className={styles.item} onClick={() => onEdit(m)}>
          {t.chat.menuEdit}
        </button>
      ) : null}
      {!m.is_system && m.kind === "text" ? (
        <button type="button" className={styles.item} onClick={() => onTranslate(m)}>
          {t.chat.translate}
        </button>
      ) : null}
      {!own && !m.is_system ? (
        <button type="button" className={styles.item} onClick={() => onReport(m)}>
          {t.report.report}
        </button>
      ) : null}
      {!m.is_system ? (
        <button
          type="button"
          className={`${styles.item} ${styles.danger}`}
          onClick={() => onDelete(m)}
        >
          {t.chat.menuDeleteMsg}
        </button>
      ) : null}
    </div>
  );
}
