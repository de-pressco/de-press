import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/core/api/client";
import { friendlyError } from "@/core/api/errorCopy";
import { useI18n } from "@/core/i18n/context";
import { fmt } from "@/core/i18n/flatten";
import { useHelperHeartbeat } from "./useHelperHeartbeat";
import { useHelperQueue } from "./useHelperQueue";
import { waitTone, type WaitTone } from "./waitTone";
import styles from "./HelperQueue.module.css";

type Tab = "queue" | "clouds" | "summary";

const TONE_CLASS: Record<WaitTone, string> = {
  fresh: "",
  warm: styles.chipWarm,
  urgent: styles.chipUrgent,
};

export function HelperQueue() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("queue");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
  });

  const canHelper = Boolean(meQuery.data?.is_helper);
  const isHelper = Boolean(meQuery.data?.is_helper);
  const onDuty = Boolean(meQuery.data?.is_on_duty);
  useHelperHeartbeat(isHelper);

  const { queue: helpQueue, refresh: refreshQueue } = useHelperQueue(
    isHelper && tab === "queue",
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!(isHelper && tab === "queue")) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isHelper, tab]);

  const duty = useMutation({
    mutationFn: (next: boolean) => api.setHelperDuty(next),
    onSuccess: async (me) => {
      queryClient.setQueryData(["me"], me);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["helper-dashboard"] });
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

  const revoke = useMutation({
    mutationFn: (token: string) => api.revokeHelperInvite(token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["helper-invites"] });
    },
  });

  const helpDashQuery = useQuery({
    queryKey: ["helper-dashboard"],
    queryFn: () => api.helperDashboard(),
    enabled: canHelper && tab === "queue",
  });

  const acceptHelp = useMutation({
    mutationFn: (requestId: string) => api.acceptHelpRequest(requestId),
    onSuccess: async (dialogue) => {
      await queryClient.invalidateQueries({ queryKey: ["dialogues"] });
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["helper-dashboard"] });
      navigate(`/chat/${dialogue.id}`);
    },
    // Another Helper won the race: the server refuses, the list must refresh.
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["helper-dashboard"] });
      refreshQueue();
    },
  });

  const skipHelp = useMutation({
    mutationFn: (requestId: string) => api.skipHelpRequest(requestId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
      refreshQueue();
    },
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

  function waitLabel(iso: string): string {
    const mins = Math.max(
      0,
      Math.floor((now - new Date(iso).getTime()) / 60_000),
    );
    if (mins < 1) return t.helper.waitLessMin;
    if (mins < 60) return fmt(t.helper.waitMin, { count: mins });
    return `${fmt(t.helper.waitHour, { count: Math.floor(mins / 60) })} ${fmt(
      t.helper.waitMin,
      { count: mins % 60 },
    )}`;
  }

  function medianLabel(seconds: number | null | undefined): string {
    if (seconds == null) return "—";
    return waitLabel(new Date(now - seconds * 1000).toISOString());
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
        {canHelper ? (
          <div className={onDuty ? styles.dutyOn : styles.duty}>
            <div>
              <p className={styles.dutyStatus}>
                {onDuty ? t.helper.dutyOn : t.helper.dutyOff}
              </p>
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
            ? t.helper.queueLead
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
            {t.helper.tabQueue}
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
        <>
          {helpDashQuery.data ? (
            <ul className={styles.stats}>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {helpDashQuery.data.queue_length}
                </span>
                <span className={styles.statLabel}>{t.helper.metricQueue}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {medianLabel(helpDashQuery.data.median_wait_seconds_7d)}
                </span>
                <span className={styles.statLabel}>
                  {t.helper.metricMedianWait}
                </span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {helpDashQuery.data.taken_24h}
                </span>
                <span className={styles.statLabel}>{t.helper.metricTaken24}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {helpDashQuery.data.closed_24h}
                </span>
                <span className={styles.statLabel}>
                  {t.helper.metricClosed24}
                </span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {helpDashQuery.data.taken_7d}
                </span>
                <span className={styles.statLabel}>{t.helper.metricTaken7d}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {helpDashQuery.data.closed_7d}
                </span>
                <span className={styles.statLabel}>
                  {t.helper.metricClosed7d}
                </span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {helpDashQuery.data.on_duty}
                </span>
                <span className={styles.statLabel}>{t.helper.metricOnDuty}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statValue}>
                  {helpDashQuery.data.online}
                </span>
                <span className={styles.statLabel}>{t.helper.metricOnline}</span>
              </li>
            </ul>
          ) : null}
          {acceptHelp.isError || skipHelp.isError ? (
            <p className={styles.error} role="alert">
              {friendlyError(
                acceptHelp.error ?? skipHelp.error,
                t.common.errorSoft,
              )}
            </p>
          ) : null}
          {helpQueue.length === 0 ? (
            <p className={styles.empty}>{t.helper.queueEmpty}</p>
          ) : (
            <ul className={styles.list}>
              {helpQueue.map((row) => (
                <li key={row.id} className={styles.card}>
                  <p className={styles.meta}>
                    <span
                      className={[
                        styles.chip,
                        TONE_CLASS[waitTone(row.created_at, now)],
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {waitLabel(row.created_at)}
                    </span>
                  </p>
                  {row.note ? <p className={styles.body}>{row.note}</p> : null}
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.approve}
                      disabled={acceptHelp.isPending || skipHelp.isPending}
                      onClick={() => acceptHelp.mutate(row.id)}
                    >
                      {t.helper.take}
                    </button>
                    <button
                      type="button"
                      className={styles.reject}
                      disabled={acceptHelp.isPending || skipHelp.isPending}
                      onClick={() => skipHelp.mutate(row.id)}
                    >
                      {t.help.requestSkip}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
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
          <ul className={styles.stats}>
            <li className={styles.stat}>
              <span className={styles.statValue}>{dash.pending_clouds}</span>
              <span className={styles.statLabel}>{t.helper.pendingClouds}</span>
            </li>
            <li className={styles.stat}>
              <span className={styles.statValue}>{dash.open_reports}</span>
              <span className={styles.statLabel}>{t.helper.openReports}</span>
            </li>
            <li className={styles.stat}>
              <span className={styles.statValue}>{dash.reviewing_reports}</span>
              <span className={styles.statLabel}>
                {t.helper.reviewingReports}
              </span>
            </li>
            <li className={styles.stat}>
              <span className={styles.statValue}>{dash.reports_last_7d}</span>
              <span className={styles.statLabel}>{t.helper.reports7d}</span>
            </li>
          </ul>
          <h2 className={styles.sub}>{t.helper.recentReports}</h2>
          {dash.recent_reports.length === 0 ? (
            <p className={styles.empty}>{t.helper.noReports}</p>
          ) : (
            <ul className={styles.list}>
              {dash.recent_reports.map((row) => (
                <li key={row.id} className={styles.card}>
                  <p className={styles.meta}>{reasonLabel(row.reason)}</p>
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
                  <p className={styles.body}>
                    /helper/join?token={inv.token}
                  </p>
                  {inv.used ? null : (
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.reject}
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(inv.token)}
                      >
                        {t.common.confirmDelete}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
