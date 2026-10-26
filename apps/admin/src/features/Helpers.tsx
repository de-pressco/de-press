import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { ApiError, api } from "../core/api/client";
import { useI18n } from "../core/i18n/context";

export function Helpers({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-helpers"],
    queryFn: () => api.helpers(),
    retry: false,
  });

  const duty = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      api.setHelperDuty(id, on),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-helpers"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
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
  const rows = query.data ?? [];

  return (
    <section>
      <h2 className="sub">{t.helpers.title}</h2>
      <p className="note">{t.helpers.lead}</p>
      {duty.isSuccess ? <p className="badge">{t.helpers.saved}</p> : null}
      {duty.isError ? (
        <p className="err">
          {duty.error instanceof ApiError ? duty.error.message : t.common.error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="empty">{t.helpers.empty}</p>
      ) : (
        <ul className="list">
          {rows.map((row) => (
            <li key={row.id} className="card">
              <p className="meta">
                {row.email}
                {" · "}
                {row.is_on_duty ? t.helpers.onDuty : t.helpers.offDuty}
              </p>
              <p className="body">
                {t.helpers.org}: {row.helper_org || "—"}
              </p>
              <p className="body">
                {t.helpers.lastSeen}:{" "}
                {row.last_seen_at
                  ? new Date(row.last_seen_at).toLocaleString()
                  : t.helpers.never}
              </p>
              <button
                type="button"
                className="btn"
                disabled={duty.isPending}
                onClick={() => duty.mutate({ id: row.id, on: !row.is_on_duty })}
              >
                {row.is_on_duty ? t.helpers.dutyOff : t.helpers.dutyOn}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
