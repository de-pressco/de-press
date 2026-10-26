import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError, api } from "../core/api/client";
import { useI18n } from "../core/i18n/context";

export function Clouds({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [onlyPriority, setOnlyPriority] = useState(false);
  const query = useQuery({
    queryKey: ["admin-clouds"],
    queryFn: () => api.clouds(),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? api.approveCloud(id) : api.rejectCloud(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-clouds"] });
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
  if (query.isLoading) {
    return <p className="empty">{t.common.loading}</p>;
  }
  const all = query.data ?? [];
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (row) =>
      (!onlyPriority || row.is_priority) &&
      (!needle ||
        `${row.pseudonym} ${row.story_preview} ${row.body}`
          .toLowerCase()
          .includes(needle)),
  );

  return (
    <section>
      <h2 className="sub">{t.clouds.title}</h2>
      <p className="note">{t.clouds.lead}</p>
      <div className="filters">
        <input
          type="search"
          className="search"
          value={q}
          aria-label={t.clouds.search}
          placeholder={t.clouds.search}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className={onlyPriority ? "tab tab-on" : "tab"}
          aria-pressed={onlyPriority}
          onClick={() => setOnlyPriority((v) => !v)}
        >
          {t.clouds.priorityOnly}
        </button>
      </div>
      {decide.isSuccess ? <p className="badge">{t.clouds.saved}</p> : null}
      {decide.isError ? (
        <p className="err">
          {decide.error instanceof ApiError ? decide.error.message : t.common.error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="empty">
          {all.length === 0 ? t.clouds.empty : t.clouds.noMatch}
        </p>
      ) : (
        <ul className="list">
          {rows.map((row) => (
            <li key={row.id} className="card">
              <p className="meta">
                {t.clouds.from} {row.pseudonym}
                {row.helper_badge ? ` · ${row.helper_badge}` : ""}
                {" · "}
                {new Date(row.created_at).toLocaleString()}
              </p>
              <p className="preview">{row.story_preview}</p>
              <p className="body">{row.body}</p>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: row.id, approve: true })}
                >
                  {t.clouds.approve}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: row.id, approve: false })}
                >
                  {t.clouds.reject}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
