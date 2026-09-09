import { useCallback, useEffect, useState } from "react";
import {
  addMoodEntry,
  deleteMoodEntry,
  deletePanicEpisode,
  deleteWeekReflection,
  getMeta,
  listMoodEntries,
  listPanicEpisodes,
  listWeekReflections,
  localWeekStart,
  saveWeekReflection,
  setMeta,
  summarizePatterns,
  updateMoodEntryNote,
  wipeAllMemory,
  type MemoryMeta,
  type MoodEntry,
  type PanicEpisode,
  type WeekReflection,
} from "@/core/memory/db";

/**
 * Zero-Knowledge local memory.
 * Interface: entries, meta, reflections (one per week), episodes (Anti-Panic
 * markers) + add/remove/saveReflection/removeReflection/removeEpisode/
 * toggleAnalytics/wipe/summary. Data never leaves the device.
 */
export function useLocalMemory() {
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [meta, setMetaState] = useState<MemoryMeta>({ analyticsEnabled: true });
  const [reflections, setReflections] = useState<WeekReflection[]>([]);
  const [episodes, setEpisodes] = useState<PanicEpisode[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [e, m, r, p] = await Promise.all([
        listMoodEntries(),
        getMeta(),
        listWeekReflections(),
        listPanicEpisodes(),
      ]);
      setEntries(e);
      setMetaState(m);
      setReflections(r);
      setEpisodes(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "IndexedDB unavailable");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (input: {
      level: number;
      note?: string;
      tags?: string[];
      energy?: number;
    }) => {
      if (!meta.analyticsEnabled) {
        throw new Error("local analytics disabled");
      }
      await addMoodEntry(input);
      await refresh();
    },
    [meta.analyticsEnabled, refresh],
  );

  const editNote = useCallback(
    async (id: string, note: string) => {
      await updateMoodEntryNote(id, note);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteMoodEntry(id);
      await refresh();
    },
    [refresh],
  );

  const saveReflection = useCallback(
    async (text: string) => {
      await saveWeekReflection(localWeekStart(new Date()), text);
      await refresh();
    },
    [refresh],
  );

  const removeReflection = useCallback(
    async (id: string) => {
      await deleteWeekReflection(id);
      await refresh();
    },
    [refresh],
  );

  const removeEpisode = useCallback(
    async (id: string) => {
      await deletePanicEpisode(id);
      await refresh();
    },
    [refresh],
  );

  const toggleAnalytics = useCallback(async (enabled: boolean) => {
    const next = { analyticsEnabled: enabled };
    await setMeta(next);
    setMetaState(next);
  }, []);

  const wipe = useCallback(async () => {
    await wipeAllMemory();
    setEntries([]);
    setReflections([]);
    setEpisodes([]);
    setMetaState({ analyticsEnabled: true });
  }, []);

  const summary = summarizePatterns(entries);

  return {
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
  };
}
