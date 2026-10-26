import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "../core/api/client";
import { useI18n } from "../core/i18n/context";

const THERAPY_LABELS: Record<string, Record<"en" | "ru", string>> = {
  awaiting_payment: { en: "Awaiting payment", ru: "Ожидает оплаты" },
  payment_claimed: { en: "Payment claimed", ru: "«Оплатил» — ждёт подтверждения" },
  paid: { en: "Paid", ru: "Оплачено" },
  declined: { en: "Declined", ru: "Отклонено" },
  done: { en: "Done", ru: "Завершено" },
};

export function Overview({ onError }: { onError: (e: unknown) => void }) {
  const { t, lang } = useI18n();
  const query = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api.overview(),
    retry: false,
  });

  useEffect(() => {
    if (query.isError) onError(query.error);
  }, [query.isError, query.error, onError]);

  if (query.isError) {
    return (
      <p className="empty">
        {t.common.error} — {String(query.error)}{" "}
        <button type="button" className="btn" onClick={() => query.refetch()}>
          {t.common.retry}
        </button>
      </p>
    );
  }
  if (query.isLoading || !query.data) {
    return <p className="empty">{t.common.loading}</p>;
  }
  const d = query.data;
  const therapy = Object.entries(d.therapy_by_status);

  return (
    <section>
      <div className="cards">
        <div className="card">
          <h2>{t.overview.visitors24}</h2>
          <p className="num">{d.sessions_24h}</p>
        </div>
        <div className="card">
          <h2>{t.overview.visitors7}</h2>
          <p className="num">{d.sessions_7d}</p>
        </div>
        <div className="card">
          <h2>{t.overview.visitorsTotal}</h2>
          <p className="num">{d.sessions_total}</p>
        </div>
        <div className="card">
          <h2>{t.overview.storiesTotal}</h2>
          <p className="num">{d.stories_total}</p>
        </div>
        <div className="card">
          <h2>{t.overview.stories7}</h2>
          <p className="num">{d.stories_7d}</p>
        </div>
        <div className="card">
          <h2>{t.overview.hears}</h2>
          <p className="num">{d.hears_total}</p>
        </div>
        <div className="card">
          <h2>{t.overview.dialoguesOpen}</h2>
          <p className="num">{d.dialogues_open}</p>
        </div>
        <div className="card">
          <h2>{t.overview.dialoguesClosed}</h2>
          <p className="num">{d.dialogues_closed}</p>
        </div>
        <div className="card">
          <h2>{t.overview.pendingClouds}</h2>
          <p className="num">{d.pending_clouds}</p>
        </div>
        <div className="card warn">
          <h2>{t.overview.reportsOpen}</h2>
          <p className="num">{d.reports_open}</p>
        </div>
        <div className="card">
          <h2>{t.overview.reportsReviewing}</h2>
          <p className="num">{d.reports_reviewing}</p>
        </div>
        <div className="card">
          <h2>{t.overview.reports7}</h2>
          <p className="num">{d.reports_7d}</p>
        </div>
        <div className="card warn">
          <h2>{t.overview.helpQueue}</h2>
          <p className="num">{d.help_queue}</p>
        </div>
        <div className="card">
          <h2>{t.overview.helpersOnDuty}</h2>
          <p className="num">{d.helpers_on_duty}</p>
        </div>
      </div>
      <p className="note">{t.overview.visitorsNote}</p>

      <h2 className="sub">{t.overview.reportsByReason}</h2>
      <ul className="kv">
        {Object.entries(d.reports_by_reason).map(([reason, count]) => (
          <li key={reason}>
            <span>{t.reasons[reason as keyof typeof t.reasons] ?? reason}</span>
            <span className="num-inline">{count}</span>
          </li>
        ))}
      </ul>

      <h2 className="sub">{t.overview.therapy}</h2>
      <ul className="kv">
        {therapy.map(([status, count]) => (
          <li key={status}>
            <span>{THERAPY_LABELS[status]?.[lang] ?? status}</span>
            <span className="num-inline">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
