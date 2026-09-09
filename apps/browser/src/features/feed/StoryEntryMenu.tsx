import { useEffect, useRef } from "react";
import type { Story } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import { isOfflineTranscript } from "./voicePreview";
import styles from "@/features/chat/MessageMenu.module.css";

export interface StoryEntryMenuState {
  story: Story;
  x: number;
  y: number;
}

interface StoryEntryMenuProps {
  state: StoryEntryMenuState;
  onClose: () => void;
  onCopy: (s: Story) => void;
  onEdit: (s: Story) => void;
  onDelete: (s: Story) => void;
}

export function entryHasCopyableText(s: Story): boolean {
  const body = (s.body || "").trim();
  return Boolean(body) && !isOfflineTranscript(body);
}

export function StoryEntryMenu({
  state,
  onClose,
  onCopy,
  onEdit,
  onDelete,
}: StoryEntryMenuProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const s = state.story;
  const mine = Boolean(s.is_mine);
  const hasText = entryHasCopyableText(s);

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
  const top = Math.min(state.y, window.innerHeight - 180);

  if (!hasText && !mine) return null;

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left, top }}
    >
      {hasText ? (
        <button
          type="button"
          className={styles.item}
          onClick={() => onCopy(s)}
        >
          {t.chat.menuCopy}
        </button>
      ) : null}
      {mine && hasText ? (
        <button
          type="button"
          className={styles.item}
          onClick={() => onEdit(s)}
        >
          {t.chat.menuEdit}
        </button>
      ) : null}
      {mine ? (
        <button
          type="button"
          className={`${styles.item} ${styles.danger}`}
          onClick={() => onDelete(s)}
        >
          {t.chat.menuDeleteMsg}
        </button>
      ) : null}
    </div>
  );
}
