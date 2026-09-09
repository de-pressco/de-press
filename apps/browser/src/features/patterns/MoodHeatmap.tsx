import { useI18n } from "@/core/i18n/context";
import type { DailyAverage } from "@/core/memory/db";
import styles from "./MoodHeatmap.module.css";

/** Brighter = relatively okay (5); faint = hard (1). Quiet, no judgment. */
const OPACITY = [0.15, 0.3, 0.5, 0.75, 1];

/** Calendar grid of daily mean levels, Monday-first columns. */
export function MoodHeatmap({ days }: { days: DailyAverage[] }) {
  const { t } = useI18n();

  // Pad the head so columns run Monday..Sunday; pad the tail to close the week.
  const lead =
    days.length > 0
      ? (new Date(days[0].date + "T00:00:00").getDay() + 6) % 7
      : 0;
  const cells: (DailyAverage | null)[] = [
    ...Array<DailyAverage | null>(lead).fill(null),
    ...days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const columns: (DailyAverage | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7));

  return (
    <>
      <h2 className={styles.title}>{t.patterns.heatmapTitle}</h2>
      <div className={styles.grid} role="img" aria-label={t.patterns.heatmapTitle}>
        {columns.map((col, ci) => (
          <div key={ci} className={styles.col}>
            {col.map((cell, ri) => {
              if (cell == null || cell.avg == null) {
                return <span key={ri} className={styles.cellEmpty} />;
              }
              const level = Math.min(5, Math.max(1, Math.round(cell.avg)));
              return (
                <span
                  key={ri}
                  className={styles.cell}
                  style={{ opacity: OPACITY[level - 1] }}
                  title={`${cell.date} · ${cell.avg}/5`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className={styles.legend}>{t.patterns.heatmapHint}</p>
    </>
  );
}