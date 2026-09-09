import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Story } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import styles from "@/features/chat/ChatMenu.module.css";

export interface FeedMenuState {
  story: Story;
  x: number;
  y: number;
}

interface FeedMenuProps {
  state: FeedMenuState;
  onClose: () => void;
  onHide: (s: Story) => void;
  onUnhide: (s: Story) => void;
  onDelete: (s: Story) => void;
}

export function FeedMenu({
  state,
  onClose,
  onHide,
  onUnhide,
  onDelete,
}: FeedMenuProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement | null>(null);
  const s = state.story;
  const mine = Boolean(s.is_mine);

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
  const top = Math.min(state.y, window.innerHeight - 220);

  return (
    <div ref={ref} className={styles.menu} style={{ left, top }}>
      {!mine ? (
        <>
          <button
            type="button"
            className={styles.item}
            onClick={() => {
              onClose();
              navigate(`/feed/${s.id}?request=1`);
            }}
          >
            {t.feed.requestChat}
          </button>
        </>
      ) : null}
      {mine && s.status === "hidden" ? (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            onClose();
            onUnhide(s);
          }}
        >
          {t.feed.unhide}
        </button>
      ) : null}
      {mine && s.status !== "hidden" ? (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            onClose();
            onHide(s);
          }}
        >
          {t.feed.hide}
        </button>
      ) : null}
      {mine ? (
        <button
          type="button"
          className={`${styles.item} ${styles.danger}`}
          onClick={() => {
            onClose();
            onDelete(s);
          }}
        >
          {t.feed.delete}
        </button>
      ) : null}
    </div>
  );
}
