import { useState } from "react";
import { useLocalMemory } from "@/core/hooks/useLocalMemory";
import { useI18n } from "@/core/i18n/context";
import { ListRow } from "@/components/tg/ListRow";
import styles from "./QuickCheckin.module.css";

/**
 * Quick one-tap mood check-in from More: level only, saved on the device
 * (Zero-Knowledge). The full form with tags/energy lives in /patterns.
 */
export function QuickCheckin() {
  const { t } = useI18n();
  const { ready, meta, add } = useLocalMemory();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(3);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!ready || !meta.analyticsEnabled) {
    return (
      <div className={styles.wrap}>
        <ListRow
          asButton
          title={t.more.checkinRow}
          subtitle={ready ? t.patterns.disabled : t.patterns.loading}
          avatarText="◔"
          muted
        />
      </div>
    );
  }

  async function onSave() {
    setFailed(false);
    setBusy(true);
    try {
      await add({ level });
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <ListRow
        asButton
        title={t.more.checkinRow}
        subtitle={open ? undefined : t.more.checkinHint}
        avatarText="◔"
        onClick={() => {
          setSaved(false);
          setFailed(false);
          setOpen((v) => !v);
        }}
      />
      {open ? (
        <form
          className={styles.form}
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!busy) void onSave();
          }}
        >
          <p className={styles.label}>{t.patterns.howFeel}</p>
          <div
            className={styles.levels}
            role="group"
            aria-label={t.patterns.howFeel}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={n === level ? styles.levelActive : styles.level}
                onClick={() => setLevel(n)}
                aria-pressed={n === level}
              >
                {n}
              </button>
            ))}
          </div>
          {failed ? (
            <p className={styles.error}>{t.patterns.errorPrefix}</p>
          ) : null}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setOpen(false)}
            >
              {t.more.checkinClose}
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.primary}`}
              disabled={busy}
            >
              {t.patterns.saveLocal}
            </button>
          </div>
        </form>
      ) : saved ? (
        <p className={styles.ok}>{t.patterns.saved}</p>
      ) : null}
    </div>
  );
}