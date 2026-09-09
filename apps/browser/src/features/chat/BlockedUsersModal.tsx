import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { friendlyError } from "@/core/api/errorCopy";
import {
  useFocusTrap,
  useInertBackground,
} from "@/core/hooks/useFocusTrap";
import { useI18n } from "@/core/i18n/context";
import styles from "./BlockedUsersModal.module.css";

interface BlockedUsersModalProps {
  onClose: () => void;
}

export function BlockedUsersModal({ onClose }: BlockedUsersModalProps) {
  const { t, locale } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panelRef, true);
  useInertBackground(panelRef, true);
  const queryClient = useQueryClient();
  const blocks = useQuery({
    queryKey: ["blocks"],
    queryFn: () => api.myBlocks(),
  });
  const unblock = useMutation({
    mutationFn: (blockId: string) => api.unblockById(blockId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["blocks"] });
      await queryClient.invalidateQueries({ queryKey: ["dialogues"] });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = blocks.data ?? [];

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t.chat.blockedTitle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className={styles.panel}>
        <div className={styles.head}>
          <h2 className={styles.title}>{t.chat.blockedTitle}</h2>
          <button
            type="button"
            className={styles.close}
            aria-label={t.common.close}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {blocks.isLoading ? (
          <p className={styles.note}>{t.common.loading}</p>
        ) : null}
        {!blocks.isLoading && items.length === 0 ? (
          <p className={styles.note}>{t.chat.blockedEmpty}</p>
        ) : null}
        {unblock.isError ? (
          <p className={styles.note}>
            {friendlyError(unblock.error, t.common.errorSoft)}
          </p>
        ) : null}

        <ul className={styles.rows}>
          {items.map((b) => (
            <li key={b.id} className={styles.row}>
              <span className={styles.who}>
                <span className={styles.label}>{b.label}</span>
                <span className={styles.date}>
                  {new Date(b.created_at).toLocaleDateString(locale)}
                </span>
              </span>
              <button
                type="button"
                className={styles.unblockBtn}
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(b.id)}
              >
                {t.chat.unblock}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}