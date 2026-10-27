import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError, api } from "../core/api/client";
import type { AdminReport, ResolveBody } from "../core/api/types";
import { useI18n } from "../core/i18n/context";

const QUEUE_FILTERS = ["open", "reviewing"];
const REASONS = ["abuse", "spam", "self_harm", "other"];
const DECISIONS: Array<ResolveBody["decision"]> = ["hide", "dismiss", "remove"];

type Mode = "queue" | "history";

export function Reports({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("queue");
  const [filter, setFilter] = useState("open");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const status = mode === "queue" ? filter : "resolved";

  const query = useInfiniteQuery({
    queryKey: ["admin-reports", status],
    queryFn: ({ pageParam }) => api.reports(status, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.length === 50 ? all.length * 50 : undefined,
    retry: false,
  });

  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResolveBody }) =>
      api.resolveReport(id, body),
    onSuccess: async () => {
      setResolvingId(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-log"] });
    },
  });

  useEffect(() => {
    if (query.isError) onError(query.error);
  }, [query.isError, query.error, onError]);

  if (query.isError) {
    return (
      <p className="empty">
        {t.common.error} —{" "}
        {query.error instanceof ApiError ? query.error.message : String(query.error)}
      </p>
    );
  }

  const rows = query.data?.pages.flat() ?? [];

  return (
    <section>
      <h2 className="sub">
        {mode === "queue" ? t.reports.queue : t.reports.history}
      </h2>
      <div className="filters">
        {(["queue", "history"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "tab tab-on" : "tab"}
            onClick={() => {
              setMode(m);
              setFilter("open");
              setResolvingId(null);
            }}
          >
            {m === "queue" ? t.reports.queueTab : t.reports.history}
          </button>
        ))}
        {mode === "queue"
          ? QUEUE_FILTERS.map((statusFilter) => (
              <button
                key={statusFilter}
                type="button"
                className={filter === statusFilter ? "btn" : "tab"}
                onClick={() => setFilter(statusFilter)}
              >
                {t.statuses[statusFilter as keyof typeof t.statuses] ??
                  statusFilter}
              </button>
            ))
          : null}
      </div>

      {resolve.isSuccess ? <p className="badge">{t.reports.saved}</p> : null}

      {query.isLoading ? (
        <p className="empty">{t.common.loading}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{t.reports.empty}</p>
      ) : (
        <ul className="list">
          {rows.map((row) => (
            <ReportRow
              key={row.id}
              row={row}
              open={resolvingId === row.id}
              pending={resolve.isPending}
              error={resolve.error instanceof ApiError ? resolve.error.message : null}
              onToggle={() => setResolvingId(resolvingId === row.id ? null : row.id)}
              onSubmit={(body) => resolve.mutate({ id: row.id, body })}
              onCancel={() => setResolvingId(null)}
            />
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <button
          type="button"
          className="btn ghost"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? t.common.loading : t.common.loadMore}
        </button>
      ) : null}
    </section>
  );
}

function ReportRow(props: {
  row: AdminReport;
  open: boolean;
  pending: boolean;
  error: string | null;
  onToggle: () => void;
  onSubmit: (body: ResolveBody) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { row, open, pending, error, onToggle, onSubmit, onCancel } = props;
  const [decision, setDecision] = useState<ResolveBody["decision"]>("hide");
  const [reason, setReason] = useState("abuse");
  const [note, setNote] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);

  function submit() {
    if (!REASONS.includes(reason)) {
      setReasonMissing(true);
      return;
    }
    setReasonMissing(false);
    onSubmit({ decision, reason, note });
  }

  const decisionLabel = (d: ResolveBody["decision"]): string => {
    const key = `decision${d[0].toUpperCase()}${d.slice(1)}` as keyof typeof t.reports;
    return t.reports[key] ?? d;
  };

  return (
    <li className="card">
      <p className="meta">
        {row.target_kind === "story" ? t.reports.targetStory : t.reports.targetMessage}
        {" · "}
        {(t.reasons[row.reason as keyof typeof t.reasons] ?? row.reason)}
        {" · "}
        {(t.statuses[row.status as keyof typeof t.statuses] ?? row.status)}
        {" · "}
        {new Date(row.created_at).toLocaleString()}
      </p>
      {row.target_text ? <p className="preview">{row.target_text}</p> : null}
      {row.target_hidden ? <p className="badge">{t.reports.alreadyHidden}</p> : null}
      {row.details ? (
        <p className="body">
          {t.reports.details}: {row.details}
        </p>
      ) : null}
      {row.resolved_note ? (
        <p className="body">
          {t.reports.resolvedNote}: {row.resolved_note}
        </p>
      ) : null}
      {row.decision ? (
        <p className="meta">
          {t.reports.closedBy}: {row.resolved_by || "—"} ·{" "}
          {t.reports.closedAt}: {new Date(row.resolved_at).toLocaleString()}
        </p>
      ) : null}
      {row.decision ? (
        <p className="meta">
          {t.reports.decision}:{" "}
          {t.actions[row.decision as keyof typeof t.actions] ?? row.decision} ·{" "}
          {t.reports.resolutionReason}:{" "}
          {t.reasons[row.resolution_reason as keyof typeof t.reasons] ??
            row.resolution_reason}
        </p>
      ) : null}

      {row.decision ? null : open ? (
        <div className="resolve-form">
          <label>
            {t.reports.decision}
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as ResolveBody["decision"])}
            >
              {DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {decisionLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.reports.reason}
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {(t.reasons[r as keyof typeof t.reasons] ?? r)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.reports.note}
            <textarea
              value={note}
              rows={2}
              placeholder={t.reports.reasonPlaceholder}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {reasonMissing ? <p className="err">{t.reports.reasonRequired}</p> : null}
          {error ? <p className="err">{error}</p> : null}
          <div className="row">
            <button type="button" className="btn" disabled={pending} onClick={submit}>
              {pending ? t.reports.resolving : t.reports.resolve}
            </button>
            <button type="button" className="btn ghost" onClick={onCancel}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn" onClick={onToggle}>
          {t.reports.resolve}
        </button>
      )}
    </li>
  );
}

