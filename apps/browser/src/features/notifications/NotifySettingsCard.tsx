import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/core/api/client";
import type { NotificationKind } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import styles from "./NotifySettingsCard.module.css";

/** Helper-only kinds: hidden for everyone else (the backend gates them too). */
const HELPER_KINDS: ReadonlySet<NotificationKind> = new Set([
  "help_requested",
  "dialogue_request_review",
  "report_new",
]);

const KINDS: NotificationKind[] = [
  "message",
  "dialogue_request",
  "dialogue_opened",
  "outreach_intro",
  "dialogue_deleted",
  "support_cloud",
  "cloud_approved",
  "silent_empathy",
  "report_resolved",
  "help_requested",
  "dialogue_request_review",
  "report_new",
];

export function NotifySettingsCard({ isHelper }: { isHelper: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [error, setError] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["notify-settings"],
    queryFn: () => api.notifySettings(),
  });

  const setKind = useMutation({
    mutationFn: (args: { kind: NotificationKind; enabled: boolean }) =>
      api.updateNotifySettings({
        notify_kinds: { [args.kind]: args.enabled },
        // The endpoint resets omitted channel fields to their defaults —
        // pass the loaded values through (same pattern as mini UserMenu).
        notify_email_opt_in: settingsQuery.data?.notify_email_opt_in ?? false,
        notify_digest_frequency:
          settingsQuery.data?.notify_digest_frequency ?? "off",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notify-settings"] });
      setError(false);
    },
    onError: () => {
      setError(true);
    },
  });

  const stored = settingsQuery.data?.notify_kinds ?? {};
  const pending = setKind.isPending ? setKind.variables?.kind : undefined;

  return (
    <section className={styles.card}>
      <h2 className={styles.title}>{t.notifications.settings.title}</h2>
      <p className={styles.hint}>{t.notifications.settings.hint}</p>
      <ul className={styles.list}>
        {KINDS.filter((kind) => isHelper || !HELPER_KINDS.has(kind)).map(
          (kind) => (
            <li key={kind} className={styles.row}>
              <label className={styles.label}>
                <input
                  type="checkbox"
                  className={styles.toggle}
                  checked={stored[kind] ?? true}
                  disabled={settingsQuery.isPending || pending === kind}
                  onChange={(ev) =>
                    setKind.mutate({ kind, enabled: ev.target.checked })
                  }
                />
                <span className={styles.kindText}>
                  {t.notifications.kind[kind] ?? kind}
                </span>
              </label>
            </li>
          ),
        )}
      </ul>
      {error ? <p className={styles.error}>{t.common.error}</p> : null}
    </section>
  );
}