import { useI18n } from "@/core/i18n/context";
import type { DailyAverage } from "@/core/memory/db";
import styles from "./MoodChart.module.css";

const W = 300;
const H = 120;
const PAD_X = 18;
const PAD_Y = 10;
const LEVELS = 5;

function xAt(index: number, total: number): number {
  return (
    Math.round(
      (PAD_X + (index / Math.max(total - 1, 1)) * (W - PAD_X * 2)) * 10,
    ) / 10
  );
}

function yAt(avg: number): number {
  return (
    Math.round((PAD_Y + ((LEVELS - avg) / (LEVELS - 1)) * (H - PAD_Y * 2)) * 10) /
    10
  );
}

/** Hand-rolled SVG line of daily mean levels. The card wrapper lives in the pane. */
export function MoodChart({
  days,
  range,
  onRangeChange,
}: {
  days: DailyAverage[];
  range: 30 | 90;
  onRangeChange: (range: 30 | 90) => void;
}) {
  const { t } = useI18n();

  // A run of consecutive filled days becomes one polyline; gaps split the line.
  const segments: string[] = [];
  let run: string[] = [];
  for (let i = 0; i < days.length; i++) {
    const avg = days[i].avg;
    if (avg == null) {
      if (run.length > 1) segments.push(run.join(" "));
      run = [];
    } else {
      run.push(`${xAt(i, days.length)},${yAt(avg)}`);
    }
  }
  if (run.length > 1) segments.push(run.join(" "));
  const hasData = segments.length > 0;

  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.title}>{t.patterns.chartTitle}</h2>
        <div
          className={styles.ranges}
          role="group"
          aria-label={t.patterns.chartTitle}
        >
          {([30, 90] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={r === range ? styles.rangeActive : styles.range}
              onClick={() => onRangeChange(r)}
              aria-pressed={r === range}
            >
              {r === 30 ? t.patterns.chart30 : t.patterns.chart90}
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <svg
          className={styles.chart}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t.patterns.chartTitle}
        >
          {[1, 2, 3, 4, 5].map((lvl) => {
            const y = yAt(lvl);
            return (
              <g key={lvl}>
                <line
                  className={styles.grid}
                  x1={PAD_X}
                  x2={W - PAD_X}
                  y1={y}
                  y2={y}
                />
                <text className={styles.gridLabel} x={2} y={y + 3}>
                  {lvl}
                </text>
              </g>
            );
          })}
          {segments.map((seg, i) => (
            <polyline key={i} className={styles.line} points={seg} />
          ))}
        </svg>
      ) : (
        <p className={styles.empty}>{t.patterns.chartEmpty}</p>
      )}
    </>
  );
}