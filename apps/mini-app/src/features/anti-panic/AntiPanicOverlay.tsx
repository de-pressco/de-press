import { useEffect, useState } from "react";
import { useI18n } from "@/core/i18n/context";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import styles from "./AntiPanicOverlay.module.css";

/**
 * Minimal grounding canvas when Anti-Panic is active.
 * Round exit button pinned at the center of the breathing circle;
 * grounding prompts rotate every 5 s (fade-in via key remount).
 */
export function AntiPanicOverlay() {
  const { active, exit } = useAntiPanic();
  const { t } = useI18n();
  const prompts = t.antiPanic.groundSteps;
  const [promptIndex, setPromptIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(
      () => setPromptIndex((i) => (i + 1) % prompts.length),
      5000,
    );
    return () => window.clearInterval(id);
  }, [active, prompts.length]);

  if (!active) return null;

  const prompt = prompts[promptIndex % prompts.length];

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t.antiPanic.menuTitle}>
      <div className={styles.panel}>
        <p className={styles.title}>{t.antiPanic.menuTitle}</p>
        <p className={styles.hint}>{t.antiPanic.breatheHint}</p>
        <div className={styles.breath}>
          <span className={styles.circle} aria-hidden />
          <button type="button" className={styles.exit} onClick={exit} aria-label={t.nav.exitPanic}>
            {t.nav.exitPanic}
          </button>
        </div>
        <p className={styles.groundCaption}>{t.antiPanic.groundTitle}</p>
        <p key={promptIndex} className={styles.groundPrompt}>
          {prompt}
        </p>
      </div>
    </div>
  );
}
