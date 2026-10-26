import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/core/api/client";
import { useI18n } from "@/core/i18n/context";
import { useHelperHeartbeat } from "./useHelperHeartbeat";
import { useHelperQueue } from "./useHelperQueue";
import styles from "./HelperQueue.module.css";

type Tab = "queue" | "clouds" | "summary";

export function HelperQueue() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("queue");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
  });

  const canHelper = Boolean(meQuery.data?.is_helper || meQuery.data?.is_staff);
  const isHelper = Boolean(meQuery.data?.is_helper);
  const onDuty = Boolean(meQuery.data?.is_on_duty);
  useHelperHeartbeat(isHelper);

  const duty = useMutation({
    mutationFn: (next: boolean) => api.setHelperDuty(next),
    onSuccess: async (me) => {
      queryClient.setQueryData(["me"], me);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
    },
  });

  const { queue: helpQueue, refresh: refreshQueue } = useHelperQueue(
    isHelper && tab === "queue",
  );

  const acceptHelp = useMutation({
    mutationFn: (requestId: string) => api.acceptHelpRequest(requestId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dialogues"] });
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
      refreshQueue();
    },
  });

  const queueQuery = useQuery({
    queryKey: ["moderation-queue"],
    queryFn: () => api.moderationQueue(),
    enabled: canHelper && tab === "clouds",
  });

  const dashQuery = useQuery({
    queryKey: ["moderation-dashboard"],
    queryFn: () => api.moderationDashboard(),
    enabled: canHelper && tab === "summary",
  });

  const invitesQuery = useQuery({
    queryKey: ["helper-invites"],
    queryFn: () => api.listHelperInvites(),
    enabled: canHelper && tab === "summary",
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.approveCloud(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["moderation-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["moderation-dashboard"] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.rejectCloud(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["moderation-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["moderation-dashboard"] });
    },
  });

  function reasonLabel(reason: string): string {
    if (reason === "abuse") return t.helper.reasonAbuse;
    if (reason === "spam") return t.helper.reasonSpam;
    if (reason === "self_harm") return t.helper.reasonSelfHarm;
    return t.helper.reasonOther;
  }

  if (meQuery.isLoading) {
    return <p className={styles.empty}>{t.helper.loading}</p>;
  }

  if (!canHelper) {
    return (
      <div className={styles.pane}>
        <h1 className={styles.title}>{t.helper.title}</h1>
        <p className={styles.empty}>{t.helper.needRole}</p>
      </div>
    );
  }

  const items = queueQuery.data ?? [];
  const dash = dashQuery.data;
  const invites = invitesQuery.data ?? [];

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t.helper.title}</h1>
        {isHelper ? (
          <div className={onDuty ? styles.dutyOn : styles.duty}>
            <div>
              <p className={styles.dutyStatus}>
                {onDuty ? t.helper.dutyOn : t.helper.dutyOff}
              </p>
              <p className={styles.dutyLead}>{t.helper.dutyLead}</p>
            </div>
            <button
              type="button"
              className={styles.dutyBtn}
              disabled={duty.isPending}
              aria-pressed={onDuty}
              onClick={() => duty.mutate(!onDuty)}
            >
              {onDuty ? t.helper.dutyToggleOff : t.helper.dutyToggleOn}
            </button>
          </div>
        ) : null}
        <p className={styles.lead}>
          {tab === "queue"
          ? t.help.humanLead
          : tab === "clouds"
            ? t.helper.lead
            : t.helper.dashboardLead}
        </p>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "queue"}
            className={tab === "queue" ? styles.tabOn : styles.tab}
            onClick={() => setTab("queue")}
          >
            {t.help.humanTitle}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "clouds"}
            className={tab === "clouds" ? styles.tabOn : styles.tab}
            onClick={() => setTab("clouds")}
          >
            {t.helper.tabClouds}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "summary"}
            className={tab === "summary" ? styles.tabOn : styles.tab}
            onClick={() => setTab("summary")}
          >
            {t.helper.tabSummary}
          </button>
        </div>
      </header>

      {tab === "queue" ? (
        !onDuty ? (
          <p className={styles.empty}>{t.helper.dutyLead}</p>
        ) : helpQueue.length === 0 ? (
          <p className={styles.empty}>{t.helper.empty}</p>
        ) : (
          <ul className={styles.list}>
            {helpQueue.map((row) => (
              <li key={row.id} className={styles.card}>
                <p className={styles.meta}>
                  {new Date(row.created_at).toLocaleString()}
                </p>
                {row.note ? <p className={styles.body}>{row.note}</p> : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.approve}
                    disabled={acceptHelp.isPending}
                    onClick={() => acceptHelp.mutate(row.id)}
                  >
                    {t.help.waitOpenChat}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tab === "clouds" ? (
        queueQuery.isLoading ? (
          <p className={styles.empty}>{t.helper.loading}</p>
        ) : queueQuery.isError ? (
        <p className={styles.empty}>
          {queueQuery.error instanceof ApiError
            ? queueQuery.error.message
            : t.common.error}
        </p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>{t.helper.empty}</p>
      ) : (
        <ul className={styles.list}>
          {items.map((cloud) => (
            <li key={cloud.id} className={styles.card}>
              <p className={styles.meta}>
                {t.helper.from} {cloud.pseudonym}
                {cloud.helper_badge ? ` · ${cloud.helper_badge}` : ""}
              </p>
              <p className={styles.preview}>{cloud.story_preview}</p>
              <p className={styles.body}>{cloud.body}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.approve}
                  disabled={approve.isPending || reject.isPending}
                  onClick={() => approve.mutate(cloud.id)}
                >
                  {t.helper.approve}
                </button>
                <button
                  type="button"
                  className={styles.reject}
                  disabled={approve.isPending || reject.isPending}
                  onClick={() => reject.mutate(cloud.id)}
                >
                  {t.helper.reject}
                </button>
              </div>
            </li>
          ))}
        </ul>
        )
      ) : dashQuery.isLoading ? (
        <p className={styles.empty}>{t.helper.loading}</p>
      ) : dashQuery.isError ? (
        <p className={styles.empty}>
          {dashQuery.error instanceof ApiError
            ? dashQuery.error.message
            : t.common.error}
        </p>
      ) : dash ? (
        <>
          <ul className={styles.metrics}>
            <li>
              {t.helper.pendingClouds}: {dash.pending_clouds}
            </li>
            <li>
              {t.helper.openReports}: {dash.open_reports}
            </li>
            <li>
              {t.helper.reviewingReports}: {dash.reviewing_reports}
            </li>
            <li>
              {t.helper.reports7d}: {dash.reports_last_7d}
            </li>
          </ul>
          <h2 className={styles.sub}>{t.helper.recentReports}</h2>
          {dash.recent_reports.length === 0 ? (
            <p className={styles.empty}>{t.helper.noReports}</p>
          ) : (
            <ul className={styles.list}>
              {dash.recent_reports.map((row) => (
                <li key={row.id} className={styles.card}>
                  <p className={styles.meta}>
                    {reasonLabel(row.reason)} · {row.status}
                  </p>
                  {row.story_preview ? (
                    <p className={styles.preview}>{row.story_preview}</p>
                  ) : null}
                  {row.details ? <p className={styles.body}>{row.details}</p> : null}
                </li>
              ))}
            </ul>
          )}
          <h2 className={styles.sub}>{t.helper.unusedInvites}</h2>
          {invites.length === 0 ? (
            <p className={styles.empty}>{t.helper.empty}</p>
          ) : (
            <ul className={styles.list}>
              {invites.map((inv) => (
                <li key={inv.token} className={styles.card}>
                  <p className={styles.meta}>
                    {inv.org || "—"}
                    {inv.used ? ` · ${t.helper.inviteUsed}` : ""}
                  </p>
                  <p className={styles.body}>/helper/join?token={inv.token}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
