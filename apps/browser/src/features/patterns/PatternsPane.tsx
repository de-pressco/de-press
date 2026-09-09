import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLocalMemory } from "@/core/hooks/useLocalMemory";
import {
  computeInsights,
  dailyAverages,
  exportZkSnapshot,
  importZkSnapshot,
  localWeekStart,
  type PanicEpisode,
} from "@/core/memory/db";
import { queueCompanionShare } from "@/core/memory/companionShare";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";
import { MoodChart } from "./MoodChart";
import { MoodHeatmap } from "./MoodHeatmap";
import styles from "./PatternsPane.module.css";

const PRESET_TAGS = [
  "sleep",
  "work",
  "people",
  "health",
  "money",
  "loneliness",
  "body",
  "weather",
] as const;

export function PatternsPane() {
  const { locale, t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    ready,
    error,
    entries,
    meta,
    reflections,
    episodes,
    summary,
    add,
    editNote,
    remove,
    saveReflection,
    removeReflection,
    removeEpisode,
    toggleAnalytics,
    wipe,
    refresh,
  } = useLocalMemory();
  const [level, setLevel] = useState(3);
  const [energy, setEnergy] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [range, setRange] = useState<30 | 90>(30);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareNotes, setShareNotes] = useState(false);
  const [reflectionDraft, setReflectionDraft] = useState("");
  const [reflectionLoaded, setReflectionLoaded] = useState(false);
  const [reflectionMsg, setReflectionMsg] = useState<string | null>(null);
  const [savingReflection, setSavingReflection] = useState(false);
  // All hooks must stay above the `if (!ready)` early return (React error #310).
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chartDays = useMemo(
    () => dailyAverages(entries, range),
    [entries, range],
  );
  const heatDays = useMemo(() => dailyAverages(entries, 84), [entries]);
  const insights = useMemo(() => computeInsights(entries), [entries]);
  const thisWeek = useMemo(() => localWeekStart(new Date()), []);

  // Load this week's saved reflection into the draft exactly once.
  useEffect(() => {
    if (!ready || reflectionLoaded) return;
    const existing = reflections.find((r) => r.weekStart === thisWeek);
    setReflectionDraft(existing ? existing.text : "");
    setReflectionLoaded(true);
  }, [ready, reflectionLoaded, reflections, thisWeek]);
  const tagLabels: Record<string, string> = {
    sleep: t.patterns.tagSleep,
    work: t.patterns.tagWork,
    people: t.patterns.tagPeople,
    health: t.patterns.tagHealth,
    money: t.patterns.tagMoney,
    loneliness: t.patterns.tagLoneliness,
    body: t.patterns.tagBody,
    weather: t.patterns.tagWeather,
  };
  const fmtTag = (tag: string) => tagLabels[tag] ?? tag;

  async function onAdd() {
    setMsg(null);
    setSaving(true);
    try {
      await add({
        level,
        note,
        tags: selectedTags,
        energy: energy ?? undefined,
      });
      setNote("");
      setSelectedTags([]);
      setCustomTag("");
      setEnergy(null);
      setMsg(t.patterns.saved);
    } catch (err) {
      setMsg(
        err instanceof Error
          ? `${t.patterns.errorPrefix}: ${err.message}`
          : t.patterns.errorPrefix,
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag)
        ? prev.filter((x) => x !== tag)
        : prev.length >= 6
          ? prev
          : [...prev, tag],
    );
  }

  function addCustomTag() {
    const tag = customTag.trim().slice(0, 24);
    if (!tag) return;
    toggleTag(tag);
    setCustomTag("");
  }

  async function onSaveNote(id: string) {
    try {
      await editNote(id, editingNote);
      setEditingId(null);
    } catch (err) {
      setMsg(
        err instanceof Error
          ? `${t.patterns.errorPrefix}: ${err.message}`
          : t.patterns.errorPrefix,
      );
    }
  }

  async function onDeleteEntry(id: string) {
    const ok = await toast.confirm({
      message: t.patterns.deleteConfirm,
      confirmLabel: t.chat.confirmYes,
      cancelLabel: t.chat.confirmNo,
      danger: true,
    });
    if (!ok) return;
    try {
      await remove(id);
    } catch (err) {
      setMsg(
        err instanceof Error
          ? `${t.patterns.errorPrefix}: ${err.message}`
          : t.patterns.errorPrefix,
      );
    }
  }

  if (!ready) {
    return (
      <div className={styles.pane}>
        <p className={styles.muted}>{t.patterns.loading}</p>
      </div>
    );
  }

  const trendLabel = {
    up: t.patterns.trendUp,
    down: t.patterns.trendDown,
    flat: t.patterns.trendFlat,
    unknown: t.patterns.trendUnknown,
  }[summary.trend];

  const weekdayName = (wd: number) =>
    new Date(2023, 0, 1 + wd, 12).toLocaleDateString(locale, {
      weekday: "long",
    });

  const insightRows: string[] = [];
  if (insights.hasData) {
    if (insights.streak > 0) {
      insightRows.push(`${t.patterns.insightsStreak}: ${insights.streak}`);
    }
    if (insights.bestWeekday) {
      insightRows.push(
        `${t.patterns.insightsBestDay}: ${weekdayName(insights.bestWeekday.weekday)}`,
      );
    }
    if (insights.hardWeekday) {
      insightRows.push(
        `${t.patterns.insightsHardDay}: ${weekdayName(insights.hardWeekday.weekday)}`,
      );
    }
    if (insights.topTags.length > 0) {
      insightRows.push(
        `${t.patterns.insightsTopTags}: ${insights.topTags.map(fmtTag).join(", ")}`,
      );
    }
    if (insights.hardTags.length > 0) {
      insightRows.push(
        `${t.patterns.insightsHardTags}: ${insights.hardTags.map(fmtTag).join(", ")}`,
      );
    }
  }

  // The exact text the companion will receive; server caps a message at 2000.
  let shareText = "";
  if (insights.hasData) {
    const lines: string[] = [t.patterns.shareIntro];
    lines.push(
      [
        `${t.patterns.statsCount}: ${summary.count}`,
        summary.avgLevel != null
          ? `${t.patterns.statsAvg}: ${summary.avgLevel}/5`
          : "",
        summary.avgEnergy != null
          ? `${t.patterns.statsEnergy}: ${summary.avgEnergy}/5`
          : "",
        `${t.patterns.statsLast7}: ${summary.last7}`,
        `${t.patterns.statsTrend}: ${trendLabel}`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    lines.push(...insightRows);
    if (shareNotes) {
      const noted = entries
        .filter((e) => e.note.trim().length > 0)
        .slice(0, 14);
      if (noted.length > 0) {
        lines.push(t.patterns.shareNotesHeader);
        for (const e of noted) {
          lines.push(
            `${new Date(e.at).toLocaleDateString(locale)} — ${e.note}`,
          );
        }
      }
    }
    shareText = lines.join("\n");
    if (shareText.length > 1900) shareText = `${shareText.slice(0, 1900)}…`;
  }

  function weekRange(weekStart: string) {
    const [y, m, d] = weekStart.split("-").map(Number);
    if (!y || !m || !d) return weekStart;
    const start = new Date(y, m - 1, d);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (x: Date) =>
      x.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
    return `${fmt(start)} – ${fmt(end)}`;
  }

  function onShareToCompanion() {
    queueCompanionShare(shareText);
    navigate("/help/ai");
  }

  function episodeDuration(ep: PanicEpisode): string {
    if (!ep.endedAt) return t.patterns.episodesOngoing;
    const mins = Math.max(
      1,
      Math.round((Date.parse(ep.endedAt) - Date.parse(ep.startedAt)) / 60000),
    );
    return `≈ ${mins} ${t.patterns.episodesMinutes}`;
  }

  async function onDeleteEpisode(id: string) {
    const ok = await toast.confirm({
      message: t.patterns.deleteConfirm,
      confirmLabel: t.chat.confirmYes,
      cancelLabel: t.chat.confirmNo,
      danger: true,
    });
    if (!ok) return;
    try {
      await removeEpisode(id);
    } catch (err) {
      setMsg(
        err instanceof Error
          ? `${t.patterns.errorPrefix}: ${err.message}`
          : t.patterns.errorPrefix,
      );
    }
  }

  function onExport() {
    void (async () => {
      try {
        const snapshot = await exportZkSnapshot();
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `de-press-zk-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setMsg(
          err instanceof Error
            ? `${t.patterns.errorPrefix}: ${err.message}`
            : t.patterns.errorPrefix,
        );
      }
    })();
  }

  async function onImportFile(file: File) {
    setMsg(null);
    const ok = await toast.confirm({
      message: t.patterns.dataImportConfirm,
      confirmLabel: t.chat.confirmYes,
      cancelLabel: t.chat.confirmNo,
    });
    if (!ok) return;
    try {
      const result = await importZkSnapshot(JSON.parse(await file.text()));
      await refresh();
      setMsg(
        `${t.patterns.dataImportedAdded}: ${result.added} · ${t.patterns.dataImportedSkipped}: ${result.skipped}`,
      );
    } catch {
      setMsg(t.patterns.dataImportError);
    }
  }

  async function onSaveReflection() {
    setReflectionMsg(null);
    setSavingReflection(true);
    try {
      await saveReflection(reflectionDraft);
      setReflectionMsg(t.patterns.saved);
    } catch (err) {
      setReflectionMsg(
        err instanceof Error
          ? `${t.patterns.errorPrefix}: ${err.message}`
          : t.patterns.errorPrefix,
      );
    } finally {
      setSavingReflection(false);
    }
  }

  async function onDeleteReflection(id: string) {
    const ok = await toast.confirm({
      message: t.patterns.deleteConfirm,
      confirmLabel: t.chat.confirmYes,
      cancelLabel: t.chat.confirmNo,
      danger: true,
    });
    if (!ok) return;
    try {
      await removeReflection(id);
    } catch (err) {
      setMsg(
        err instanceof Error
          ? `${t.patterns.errorPrefix}: ${err.message}`
          : t.patterns.errorPrefix,
      );
    }
  }

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t.patterns.title}</h1>
        <p className={styles.banner}>{t.patterns.zkBanner}</p>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.card}>
        <p className={styles.stat}>
          {t.patterns.statsCount}: {summary.count}
          {summary.avgLevel != null
            ? ` · ${t.patterns.statsAvg} ${summary.avgLevel}/5`
            : ""}
          {summary.avgEnergy != null
            ? ` · ${t.patterns.statsEnergy} ${summary.avgEnergy}/5`
            : ""}
          {` · ${t.patterns.statsLast7}: ${summary.last7}`}
          {` · ${t.patterns.statsTrend}: ${trendLabel}`}
        </p>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={meta.analyticsEnabled}
            onChange={(e) => void toggleAnalytics(e.target.checked)}
          />
          <span>{t.patterns.analyticsLabel}</span>
        </label>
      </section>

      <section className={styles.card}>
        <MoodChart days={chartDays} range={range} onRangeChange={setRange} />
      </section>

      <section className={styles.card}>
        <MoodHeatmap days={heatDays} />
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>{t.patterns.insightsTitle}</h2>
        {insightRows.length > 0 ? (
          <ul className={styles.insightList}>
            {insightRows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{t.patterns.insightsEmpty}</p>
        )}
        {insights.hasData && !shareOpen ? (
          <button
            type="button"
            className={styles.chip}
            onClick={() => setShareOpen(true)}
          >
            {t.patterns.share}
          </button>
        ) : null}
        {shareOpen && insights.hasData ? (
          <div className={styles.shareBox}>
            <p className={styles.subLabel}>{t.patterns.shareHint}</p>
            <pre className={styles.sharePreview}>{shareText}</pre>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={shareNotes}
                onChange={(e) => setShareNotes(e.target.checked)}
              />
              <span>{t.patterns.shareNotes}</span>
            </label>
            <div className={styles.shareActions}>
              <button
                type="button"
                className={styles.chip}
                aria-label={t.patterns.noteCancel}
                onClick={() => setShareOpen(false)}
              >
                ✕
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={onShareToCompanion}
              >
                {t.patterns.shareGo}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>{t.patterns.reflectionTitle}</h2>
        <textarea
          className={styles.reflectionInput}
          rows={3}
          value={reflectionDraft}
          maxLength={2000}
          placeholder={t.patterns.reflectionPlaceholder}
          aria-label={t.patterns.reflectionTitle}
          onChange={(e) => setReflectionDraft(e.target.value)}
        />
        <button
          type="button"
          className={styles.primary}
          disabled={savingReflection || !reflectionDraft.trim()}
          onClick={() => void onSaveReflection()}
        >
          {t.patterns.saveLocal}
        </button>
        {reflectionMsg ? (
          <p className={styles.muted} role="status">
            {reflectionMsg}
          </p>
        ) : null}
        {reflections.length > 0 ? (
          <ul className={styles.reflectionList}>
            {reflections.map((r) => (
              <li key={r.id} className={styles.reflectionItem}>
                <div className={styles.reflectionHead}>
                  <span className={styles.reflectionWeek}>
                    {weekRange(r.weekStart)}
                  </span>
                  <button
                    type="button"
                    className={styles.rowDelete}
                    aria-label={t.patterns.deleteEntry}
                    onClick={() => void onDeleteReflection(r.id)}
                  >
                    ×
                  </button>
                </div>
                <p className={styles.reflectionText}>{r.text}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {episodes.length > 0 ? (
        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>{t.patterns.episodesTitle}</h2>
          <p className={styles.muted}>{t.patterns.episodesHint}</p>
          <ul className={styles.list}>
            {episodes.map((ep) => (
              <li key={ep.id} className={styles.row}>
                <span className={styles.rowMain}>
                  {new Date(ep.startedAt).toLocaleString(locale)}
                </span>
                <span className={styles.rowSide}>
                  <span className={styles.rowTime}>
                    {episodeDuration(ep)}
                  </span>
                  <button
                    type="button"
                    className={styles.rowDelete}
                    aria-label={t.patterns.deleteEntry}
                    onClick={() => void onDeleteEpisode(ep.id)}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {meta.analyticsEnabled ? (
        <section className={styles.card}>
          <p className={styles.howFeel}>{t.patterns.howFeel}</p>
          <div className={styles.levels} role="group" aria-label={t.patterns.howFeel}>
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
          <p className={styles.subLabel}>{t.patterns.energyLabel}</p>
          <div
            className={styles.levels}
            role="group"
            aria-label={t.patterns.energyLabel}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={energy === n ? styles.levelActive : styles.level}
                onClick={() => setEnergy(energy === n ? null : n)}
                aria-pressed={energy === n}
              >
                {n}
              </button>
            ))}
          </div>
          <p className={styles.subLabel}>{t.patterns.tagsLabel}</p>
          <div
            className={styles.chipRow}
            role="group"
            aria-label={t.patterns.tagsLabel}
          >
            {PRESET_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className={
                  selectedTags.includes(tag) ? styles.chipActive : styles.chip
                }
                onClick={() => toggleTag(tag)}
                aria-pressed={selectedTags.includes(tag)}
              >
                {fmtTag(tag)}
              </button>
            ))}
            {selectedTags
              .filter(
                (tag) => !(PRESET_TAGS as readonly string[]).includes(tag),
              )
              .map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={styles.chipActive}
                  onClick={() => toggleTag(tag)}
                  aria-pressed={true}
                >
                  {fmtTag(tag)}
                </button>
              ))}
          </div>
          <div className={styles.customRow}>
            <input
              type="text"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomTag();
                }
              }}
              placeholder={t.patterns.tagCustomPlaceholder}
              maxLength={24}
              aria-label={t.patterns.tagAdd}
            />
            <button
              type="button"
              className={styles.chip}
              aria-label={t.patterns.tagAdd}
              onClick={addCustomTag}
            >
              +
            </button>
          </div>
          <label className={styles.field}>
            <span>{t.patterns.noteLabel}</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.patterns.notePlaceholder}
              maxLength={500}
            />
          </label>
          <button
            type="button"
            className={styles.primary}
            disabled={saving}
            onClick={() => void onAdd()}
          >
            {t.patterns.saveLocal}
          </button>
          {msg ? (
            <p className={styles.muted} role="status">
              {msg}
            </p>
          ) : null}
        </section>
      ) : (
        <p className={styles.muted}>{t.patterns.disabled}</p>
      )}

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>{t.patterns.recent}</h2>
        {entries.length === 0 ? (
          <p className={styles.muted}>{t.patterns.empty}</p>
        ) : (
          <ul className={styles.list}>
            {entries.slice(0, 20).map((e) => (
              <li key={e.id} className={styles.row}>
                {editingId === e.id ? (
                  <span className={styles.editRow}>
                    <input
                      className={styles.noteInput}
                      value={editingNote}
                      onChange={(ev) => setEditingNote(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") {
                          ev.preventDefault();
                          void onSaveNote(e.id);
                        }
                      }}
                      maxLength={500}
                      autoFocus
                      aria-label={t.patterns.noteEdit}
                    />
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={t.patterns.noteSave}
                      onClick={() => void onSaveNote(e.id)}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={t.patterns.noteCancel}
                      onClick={() => setEditingId(null)}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <>
                    <span className={styles.rowMain}>
                      <strong>{e.level}/5</strong>
                      {e.energy != null
                        ? ` · ${t.patterns.statsEnergy} ${e.energy}/5`
                        : ""}
                      {e.note ? ` — ${e.note}` : ""}
                      {e.tags.length > 0
                        ? ` · ${e.tags.map(fmtTag).join(", ")}`
                        : ""}
                    </span>
                    <span className={styles.rowSide}>
                      <time className={styles.rowTime}>
                        {new Date(e.at).toLocaleString(locale)}
                      </time>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={t.patterns.noteEdit}
                        onClick={() => {
                          setEditingId(e.id);
                          setEditingNote(e.note);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className={styles.rowDelete}
                        aria-label={t.patterns.deleteEntry}
                        onClick={() => void onDeleteEntry(e.id)}
                      >
                        ×
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>{t.patterns.dataTitle}</h2>
        <p className={styles.muted}>{t.patterns.dataHint}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImportFile(file);
          }}
        />
        <div className={styles.shareActions}>
          <button type="button" className={styles.chip} onClick={onExport}>
            {t.patterns.dataExport}
          </button>
          <button
            type="button"
            className={styles.chip}
            onClick={() => fileInputRef.current?.click()}
          >
            {t.patterns.dataImport}
          </button>
        </div>
      </section>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.danger}
          onClick={() => {
            void (async () => {
              const ok = await toast.confirm({
                message: t.patterns.wipeConfirm,
                confirmLabel: t.chat.confirmYes,
                cancelLabel: t.chat.confirmNo,
                danger: true,
              });
              if (ok) void wipe();
            })();
          }}
        >
          {t.patterns.wipe}
        </button>
      </div>
    </div>
  );
}
