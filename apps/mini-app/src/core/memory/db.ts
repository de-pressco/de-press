/**
 * Zero-Knowledge local memory — IndexedDB only.
 * Never sync raw mood maps to the server.
 */

const DB_NAME = "depress_zk";
const DB_VERSION = 4;
const STORE = "mood_entries";
const META = "meta";
const COMPANION_STORE = "companion_messages";
const REFLECTIONS = "week_reflections";
const PANIC_EPISODES = "panic_episodes";

export interface MoodEntry {
  id: string;
  at: string;
  level: number;
  note: string;
  tags: string[];
  /** Optional second axis, 1–5; absent when it was not captured. */
  energy?: number;
}

export interface CompanionMessage {
  id: string;
  at: string;
  role: "user" | "assistant";
  content: string;
  crisis?: boolean;
}

export interface MemoryMeta {
  analyticsEnabled: boolean;
}

/** One private reflection per Monday-based week, stored locally only. */
export interface WeekReflection {
  id: string;
  /** Monday of the week, local YYYY-MM-DD key. */
  weekStart: string;
  text: string;
  at: string;
}

/**
 * Anti-Panic episode marker: timestamps only, stored locally (ADR-0025).
 * Never uploaded — the server cannot know episodes happened.
 */
export interface PanicEpisode {
  id: string;
  startedAt: string;
  endedAt?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("at", "at", { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(COMPANION_STORE)) {
        const companion = db.createObjectStore(COMPANION_STORE, {
          keyPath: "id",
        });
        companion.createIndex("at", "at", { unique: false });
      }
      if (!db.objectStoreNames.contains(REFLECTIONS)) {
        const reflections = db.createObjectStore(REFLECTIONS, {
          keyPath: "id",
        });
        reflections.createIndex("weekStart", "weekStart", { unique: true });
      }
      if (!db.objectStoreNames.contains(PANIC_EPISODES)) {
        const episodes = db.createObjectStore(PANIC_EPISODES, {
          keyPath: "id",
        });
        episodes.createIndex("startedAt", "startedAt", { unique: false });
      }
    };
  });
}

function uuid(): string {
  return crypto.randomUUID();
}

export async function getMeta(): Promise<MemoryMeta> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, "readonly");
    const req = tx.objectStore(META).get("settings");
    req.onsuccess = () => {
      const row = req.result as { key: string; value: MemoryMeta } | undefined;
      resolve(row?.value ?? { analyticsEnabled: true });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(meta: MemoryMeta): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put({ key: "settings", value: meta });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Trim, cap at 24 chars, dedupe, keep at most 6 tags per entry. */
function sanitizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().slice(0, 24);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

export async function addMoodEntry(input: {
  level: number;
  note?: string;
  tags?: string[];
  energy?: number;
}): Promise<MoodEntry> {
  const entry: MoodEntry = {
    id: uuid(),
    at: new Date().toISOString(),
    level: Math.min(5, Math.max(1, Math.round(input.level))),
    note: (input.note || "").slice(0, 500),
    tags: sanitizeTags(input.tags),
    ...(input.energy != null
      ? { energy: Math.min(5, Math.max(1, Math.round(input.energy))) }
      : {}),
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve(entry);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listMoodEntries(limit = 90): Promise<MoodEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as MoodEntry[]).sort((a, b) =>
        a.at < b.at ? 1 : -1,
      );
      resolve(rows.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMoodEntry(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateMoodEntryNote(
  id: string,
  note: string,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result as MoodEntry | undefined;
      if (row) {
        store.put({ ...row, note: (note || "").slice(0, 500) });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Create or update the reflection of a week; one row per week. */
export async function saveWeekReflection(
  weekStart: string,
  text: string,
): Promise<WeekReflection> {
  const db = await openDb();
  const trimmed = (text || "").trim().slice(0, 2000);
  return new Promise((resolve, reject) => {
    let saved: WeekReflection;
    const tx = db.transaction(REFLECTIONS, "readwrite");
    const store = tx.objectStore(REFLECTIONS);
    const req = store.index("weekStart").get(weekStart);
    req.onsuccess = () => {
      const existing = req.result as WeekReflection | undefined;
      saved = existing
        ? { ...existing, text: trimmed, at: new Date().toISOString() }
        : { id: uuid(), weekStart, text: trimmed, at: new Date().toISOString() };
      store.put(saved);
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(tx.error);
  });
}

/** Newest weeks first, capped to the last `limit`. */
export async function listWeekReflections(
  limit = 12,
): Promise<WeekReflection[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFLECTIONS, "readonly");
    const req = tx.objectStore(REFLECTIONS).getAll();
    req.onsuccess = () => {
      const rows = (req.result as WeekReflection[]).sort((a, b) =>
        a.weekStart < b.weekStart ? 1 : -1,
      );
      resolve(rows.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteWeekReflection(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFLECTIONS, "readwrite");
    tx.objectStore(REFLECTIONS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** An open episode older than this is a crashed session, not a live one. */
const STALE_EPISODE_MS = 24 * 3600 * 1000;

/**
 * Mark a panic episode start. If one is already open and fresh (persisted
 * across a reload), it is reused; a stale open episode closes now instead.
 */
export async function startPanicEpisode(
  startedAt: string,
): Promise<PanicEpisode> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let result: PanicEpisode;
    const tx = db.transaction(PANIC_EPISODES, "readwrite");
    const store = tx.objectStore(PANIC_EPISODES);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = req.result as PanicEpisode[];
      const open = rows.find((r) => !r.endedAt);
      if (
        open &&
        Date.parse(startedAt) - Date.parse(open.startedAt) < STALE_EPISODE_MS
      ) {
        result = open; // still inside the same session — no new row
        return;
      }
      for (const row of rows) {
        if (!row.endedAt) store.put({ ...row, endedAt: startedAt });
      }
      result = { id: uuid(), startedAt };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Close every open episode (exit, or the app came back mid-episode). */
export async function endOpenPanicEpisodes(endedAt: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PANIC_EPISODES, "readwrite");
    const store = tx.objectStore(PANIC_EPISODES);
    const req = store.getAll();
    req.onsuccess = () => {
      for (const row of req.result as PanicEpisode[]) {
        if (!row.endedAt) store.put({ ...row, endedAt });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Newest first, capped to the last `limit`. */
export async function listPanicEpisodes(limit = 8): Promise<PanicEpisode[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PANIC_EPISODES, "readonly");
    const req = tx.objectStore(PANIC_EPISODES).getAll();
    req.onsuccess = () => {
      const rows = (req.result as PanicEpisode[]).sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : -1,
      );
      resolve(rows.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deletePanicEpisode(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PANIC_EPISODES, "readwrite");
    tx.objectStore(PANIC_EPISODES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function addCompanionMessage(
  role: "user" | "assistant",
  content: string,
  crisis?: boolean,
): Promise<CompanionMessage> {
  const message: CompanionMessage = {
    id: uuid(),
    at: new Date().toISOString(),
    role,
    content,
    ...(crisis ? { crisis: true } : {}),
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COMPANION_STORE, "readwrite");
    tx.objectStore(COMPANION_STORE).put(message);
    tx.oncomplete = () => resolve(message);
    tx.onerror = () => reject(tx.error);
  });
}

/** Chronological transcript (oldest first), capped to the last `limit`. */
export async function listCompanionMessages(
  limit = 200,
): Promise<CompanionMessage[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COMPANION_STORE, "readonly");
    const req = tx.objectStore(COMPANION_STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as CompanionMessage[]).sort((a, b) =>
        a.at < b.at ? -1 : 1,
      );
      resolve(rows.slice(-limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function wipeAllMemory(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORE, META, COMPANION_STORE, REFLECTIONS, PANIC_EPISODES],
      "readwrite",
    );
    tx.objectStore(STORE).clear();
    tx.objectStore(META).clear();
    tx.objectStore(COMPANION_STORE).clear();
    tx.objectStore(REFLECTIONS).clear();
    tx.objectStore(PANIC_EPISODES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`, as a local YYYY-MM-DD key. */
export function localWeekStart(d: Date): string {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateKey(date);
}

/** Mean of per-day means (days with entries only) — resists multi-entry days. */
function dailyMean(entries: MoodEntry[]): number | null {
  const byDay = new Map<string, { sum: number; count: number }>();
  for (const e of entries) {
    const key = localDateKey(new Date(e.at));
    const bucket = byDay.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += e.level;
    bucket.count += 1;
    byDay.set(key, bucket);
  }
  if (byDay.size === 0) return null;
  let sum = 0;
  for (const b of byDay.values()) sum += b.sum / b.count;
  return sum / byDay.size;
}

/** One row per local day for the last `days` days, oldest first. */
export interface DailyAverage {
  date: string;
  /** Day mean of levels rounded to 0.1; null when the day has no entries. */
  avg: number | null;
  count: number;
}

export function dailyAverages(
  entries: MoodEntry[],
  days = 30,
  today: Date = new Date(),
): DailyAverage[] {
  const byDay = new Map<string, { sum: number; count: number }>();
  for (const e of entries) {
    const key = localDateKey(new Date(e.at));
    const bucket = byDay.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += e.level;
    bucket.count += 1;
    byDay.set(key, bucket);
  }
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const out: DailyAverage[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const bucket = byDay.get(key);
    out.push({
      date: key,
      avg: bucket ? Math.round((bucket.sum / bucket.count) * 10) / 10 : null,
      count: bucket ? bucket.count : 0,
    });
  }
  return out;
}

export function summarizePatterns(entries: MoodEntry[]): {
  count: number;
  avgLevel: number | null;
  avgEnergy: number | null;
  last7: number;
  trend: "up" | "down" | "flat" | "unknown";
} {
  if (entries.length === 0) {
    return {
      count: 0,
      avgLevel: null,
      avgEnergy: null,
      last7: 0,
      trend: "unknown",
    };
  }
  const avg =
    entries.reduce((s, e) => s + e.level, 0) / Math.max(entries.length, 1);
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const twoWeeksAgo = now - 14 * 24 * 3600 * 1000;
  const last7 = entries.filter((e) => new Date(e.at).getTime() >= weekAgo);
  const prev7 = entries.filter((e) => {
    const t = new Date(e.at).getTime();
    return t >= twoWeeksAgo && t < weekAgo;
  });
  let trend: "up" | "down" | "flat" | "unknown" = "unknown";
  if (last7.length >= 2 && prev7.length >= 1) {
    const a = dailyMean(last7);
    const b = dailyMean(prev7);
    if (a != null && b != null) {
      if (a - b > 0.4) trend = "up";
      else if (b - a > 0.4) trend = "down";
      else trend = "flat";
    }
  }
  const withEnergy = entries.filter((e) => e.energy != null);
  const avgEnergy =
    withEnergy.length > 0
      ? Math.round(
          (withEnergy.reduce((s, e) => s + (e.energy ?? 0), 0) /
            withEnergy.length) *
            10,
        ) / 10
      : null;
  return {
    count: entries.length,
    avgLevel: Math.round(avg * 10) / 10,
    avgEnergy,
    last7: last7.length,
    trend,
  };
}

/** Up to `max` tags seen on at least 2 entries, most frequent first. */
function topTags(entries: MoodEntry[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const tag of e.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([tag]) => tag);
}

export interface LocalInsights {
  hasData: boolean;
  total: number;
  /** Distinct local days with at least one entry. */
  days: number;
  /** Consecutive local days with entries, ending today (or yesterday if today is empty). */
  streak: number;
  /** Weekday with the highest day-mean (getDay(): 0=Sun…6=Sat). Needs ≥2 days on ≥2 weekdays. */
  bestWeekday: { weekday: number; avg: number } | null;
  /** Weekday with the lowest day-mean, same rule; null when it matches best. */
  hardWeekday: { weekday: number; avg: number } | null;
  /** Up to 3 tags appearing on ≥2 entries overall. */
  topTags: string[];
  /** Up to 3 tags appearing on ≥2 hard entries (level ≤ 2). */
  hardTags: string[];
}

/** Local mood-day means grouped by weekday, so a multi-entry day counts once. */
function weekdayDayMeans(entries: MoodEntry[]): Map<number, number[]> {
  const perDay = new Map<
    string,
    { weekday: number; sum: number; count: number }
  >();
  for (const e of entries) {
    const d = new Date(e.at);
    const key = localDateKey(d);
    const bucket = perDay.get(key) ?? { weekday: d.getDay(), sum: 0, count: 0 };
    bucket.sum += e.level;
    bucket.count += 1;
    perDay.set(key, bucket);
  }
  const byWeekday = new Map<number, number[]>();
  for (const b of perDay.values()) {
    const list = byWeekday.get(b.weekday) ?? [];
    list.push(b.sum / b.count);
    byWeekday.set(b.weekday, list);
  }
  return byWeekday;
}

/**
 * Quiet observations computed entirely on the device.
 * Only structure here — wording/labels live in the UI layer.
 */
export function computeInsights(
  entries: MoodEntry[],
  today: Date = new Date(),
): LocalInsights {
  if (entries.length === 0) {
    return {
      hasData: false,
      total: 0,
      days: 0,
      streak: 0,
      bestWeekday: null,
      hardWeekday: null,
      topTags: [],
      hardTags: [],
    };
  }
  const days = new Set(entries.map((e) => localDateKey(new Date(e.at))));

  const hasDay = (d: Date) => days.has(localDateKey(d));
  const cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  if (!hasDay(cursor)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (hasDay(cursor)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  let bestWeekday: LocalInsights["bestWeekday"] = null;
  let hardWeekday: LocalInsights["hardWeekday"] = null;
  const qualified = [...weekdayDayMeans(entries).entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([weekday, list]) => ({
      weekday,
      avg: list.reduce((s, v) => s + v, 0) / list.length,
    }))
    .sort((a, b) => b.avg - a.avg);
  if (qualified.length >= 2) {
    const best = qualified[0];
    const hard = qualified[qualified.length - 1];
    // Keep only a difference that survives 0.1 rounding — no noise patterns.
    const bestAvg = Math.round(best.avg * 10) / 10;
    const hardAvg = Math.round(hard.avg * 10) / 10;
    if (bestAvg > hardAvg) {
      bestWeekday = { weekday: best.weekday, avg: bestAvg };
      hardWeekday = { weekday: hard.weekday, avg: hardAvg };
    }
  }

  return {
    hasData: true,
    total: entries.length,
    days: days.size,
    streak,
    bestWeekday,
    hardWeekday,
    topTags: topTags(entries),
    hardTags: topTags(
      entries.filter((e) => e.level <= 2),
    ),
  };
}

// --- Export / import of the whole ZK memory (local JSON file) ---

export const ZK_SNAPSHOT_APP = "de-press-zk";
const ZK_SNAPSHOT_VERSION = 4;

export interface ZkSnapshot {
  app: typeof ZK_SNAPSHOT_APP;
  version: number;
  exportedAt: string;
  data: {
    mood_entries: MoodEntry[];
    week_reflections: WeekReflection[];
    panic_episodes: PanicEpisode[];
    companion_messages: CompanionMessage[];
    meta: MemoryMeta;
  };
}

export async function exportZkSnapshot(): Promise<ZkSnapshot> {
  const db = await openDb();
  const [mood, reflections, episodes, companion, meta] = await Promise.all([
    readAll<MoodEntry>(db, STORE),
    readAll<WeekReflection>(db, REFLECTIONS),
    readAll<PanicEpisode>(db, PANIC_EPISODES),
    readAll<CompanionMessage>(db, COMPANION_STORE),
    getMeta(),
  ]);
  return {
    app: ZK_SNAPSHOT_APP,
    version: ZK_SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      mood_entries: mood,
      week_reflections: reflections,
      panic_episodes: episodes,
      companion_messages: companion,
      meta,
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function clamp5(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function shortId(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 64) : "";
}

export function sanitizeImportedMoodEntry(raw: unknown): MoodEntry | null {
  if (!isRecord(raw)) return null;
  const id = shortId(raw.id);
  const at = isoOrNull(raw.at);
  const level = clamp5(raw.level);
  if (!id || !at || level === null) return null;
  const note = typeof raw.note === "string" ? raw.note.slice(0, 500) : "";
  const tags = sanitizeTags(
    Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : [],
  );
  const energy = raw.energy == null ? null : clamp5(raw.energy);
  return { id, at, level, note, tags, ...(energy != null ? { energy } : {}) };
}

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeImportedReflection(
  raw: unknown,
): WeekReflection | null {
  if (!isRecord(raw)) return null;
  const id = shortId(raw.id);
  const weekStart = typeof raw.weekStart === "string" ? raw.weekStart : "";
  const at = isoOrNull(raw.at);
  if (!id || !WEEK_RE.test(weekStart) || !at) return null;
  const text = typeof raw.text === "string" ? raw.text.slice(0, 2000) : "";
  return { id, weekStart, text, at };
}

export function sanitizeImportedEpisode(raw: unknown): PanicEpisode | null {
  if (!isRecord(raw)) return null;
  const id = shortId(raw.id);
  const startedAt = isoOrNull(raw.startedAt);
  if (!id || !startedAt) return null;
  if (raw.endedAt != null) {
    // A corrupt end timestamp would make the episode stay open forever.
    const endedAt = isoOrNull(raw.endedAt);
    if (!endedAt) return null;
    return { id, startedAt, endedAt };
  }
  return { id, startedAt };
}

export function sanitizeImportedCompanionMessage(
  raw: unknown,
): CompanionMessage | null {
  if (!isRecord(raw)) return null;
  const id = shortId(raw.id);
  const at = isoOrNull(raw.at);
  const role =
    raw.role === "user" || raw.role === "assistant" ? raw.role : null;
  if (!id || !at || role === null || typeof raw.content !== "string") {
    return null;
  }
  const content = raw.content.slice(0, 20000);
  const crisis = raw.crisis === true;
  return { id, at, role, content, ...(crisis ? { crisis: true } : {}) };
}

export interface ZkParsed {
  mood: MoodEntry[];
  reflections: WeekReflection[];
  episodes: PanicEpisode[];
  companion: CompanionMessage[];
  meta: MemoryMeta | null;
}

/** Validate + sanitize a snapshot without touching IndexedDB (pure). */
export function parseZkSnapshot(raw: unknown): ZkParsed | null {
  if (!isRecord(raw) || raw.app !== ZK_SNAPSHOT_APP || !isRecord(raw.data)) {
    return null;
  }
  const data = raw.data as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const mood: MoodEntry[] = [];
  for (const row of arr(data.mood_entries)) {
    const e = sanitizeImportedMoodEntry(row);
    if (e) mood.push(e);
  }
  const reflections: WeekReflection[] = [];
  for (const row of arr(data.week_reflections)) {
    const r = sanitizeImportedReflection(row);
    if (r) reflections.push(r);
  }
  const episodes: PanicEpisode[] = [];
  for (const row of arr(data.panic_episodes)) {
    const e = sanitizeImportedEpisode(row);
    if (e) episodes.push(e);
  }
  const companion: CompanionMessage[] = [];
  for (const row of arr(data.companion_messages)) {
    const c = sanitizeImportedCompanionMessage(row);
    if (c) companion.push(c);
  }
  let meta: MemoryMeta | null = null;
  if (isRecord(data.meta) && typeof data.meta.analyticsEnabled === "boolean") {
    meta = { analyticsEnabled: data.meta.analyticsEnabled };
  }
  return { mood, reflections, episodes, companion, meta };
}

export interface ZkImportResult {
  added: number;
  skipped: number;
}

/** Merge a snapshot into local stores: additive, never deletes or overwrites. */
export async function importZkSnapshot(raw: unknown): Promise<ZkImportResult> {
  const parsed = parseZkSnapshot(raw);
  if (!parsed) throw new Error("Invalid de-press ZK export file");
  const db = await openDb();
  let added = 0;
  let skipped = 0;

  const moodIds = new Set(
    (await readAll<MoodEntry>(db, STORE)).map((r) => r.id),
  );
  const freshMood = parsed.mood.filter((r) => !moodIds.has(r.id));
  skipped += parsed.mood.length - freshMood.length;
  added += freshMood.length;

  // week_reflections has a unique index on weekStart: skip known ids and weeks.
  const reflRows = await readAll<WeekReflection>(db, REFLECTIONS);
  const reflIds = new Set(reflRows.map((r) => r.id));
  const reflWeeks = new Set(reflRows.map((r) => r.weekStart));
  const freshRefl = parsed.reflections.filter(
    (r) => !reflIds.has(r.id) && !reflWeeks.has(r.weekStart),
  );
  skipped += parsed.reflections.length - freshRefl.length;
  added += freshRefl.length;

  const episodeIds = new Set(
    (await readAll<PanicEpisode>(db, PANIC_EPISODES)).map((r) => r.id),
  );
  const freshEpisodes = parsed.episodes.filter((r) => !episodeIds.has(r.id));
  skipped += parsed.episodes.length - freshEpisodes.length;
  added += freshEpisodes.length;

  const companionIds = new Set(
    (await readAll<CompanionMessage>(db, COMPANION_STORE)).map((r) => r.id),
  );
  const freshCompanion = parsed.companion.filter(
    (r) => !companionIds.has(r.id),
  );
  skipped += parsed.companion.length - freshCompanion.length;
  added += freshCompanion.length;

  if (added > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE, REFLECTIONS, PANIC_EPISODES, COMPANION_STORE],
        "readwrite",
      );
      for (const row of freshMood) tx.objectStore(STORE).put(row);
      for (const row of freshRefl) tx.objectStore(REFLECTIONS).put(row);
      for (const row of freshEpisodes) tx.objectStore(PANIC_EPISODES).put(row);
      for (const row of freshCompanion) {
        tx.objectStore(COMPANION_STORE).put(row);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  if (parsed.meta) await setMeta(parsed.meta);
  return { added, skipped };
}
