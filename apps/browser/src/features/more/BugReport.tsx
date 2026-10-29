import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useI18n } from "@/core/i18n/context";
import { ListRow } from "@/components/tg/ListRow";
import { IconBug } from "@/components/layout/NavIcons";
import styles from "./BugReport.module.css";

/**
 * "Report a bug" row in More: expands to a small textarea; the report lands
 * in the BugReport admin inbox with the reporter attached server-side.
 */
export function BugReport() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const send = useMutation({
    mutationFn: () => api.reportBug(text.trim(), window.location.pathname),
    onSuccess: () => setText(""),
  });

  const canSend = text.trim().length >= 5;

  return (
    <div className={styles.wrap}>
      <ListRow
        asButton
        title={t.more.reportBug}
        subtitle={open ? undefined : t.more.reportBugHint}
        avatarIcon={<IconBug />}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        send.isSuccess ? (
          <p className={styles.ok}>{t.more.reportBugSent}</p>
        ) : (
          <form
            className={styles.form}
            onSubmit={(ev) => {
              ev.preventDefault();
              if (canSend && !send.isPending) send.mutate();
            }}
          >
            <textarea
              className={styles.textarea}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder={t.more.reportBugPlaceholder}
              rows={4}
              maxLength={4000}
              autoFocus
            />
            {send.isError ? (
              <p className={styles.error}>{t.more.reportBugError}</p>
            ) : null}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setOpen(false)}
              >
                {t.more.reportBugCancel}
              </button>
              <button
                type="submit"
                className={`${styles.btn} ${styles.primary}`}
                disabled={!canSend || send.isPending}
              >
                {t.more.reportBugSend}
              </button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}
