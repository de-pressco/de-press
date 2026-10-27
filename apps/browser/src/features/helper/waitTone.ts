export type WaitTone = "fresh" | "warm" | "urgent";

const WARM_AFTER_MS = 5 * 60_000;
const URGENT_AFTER_MS = 15 * 60_000;

/**
 * Tone of a pending help request: after 5 minutes it warms up, after 15 it is
 * urgent. No counters — the chip only changes colour. Invalid input is fresh.
 */
export function waitTone(createdAtIso: string, nowMs: number): WaitTone {
  const waited = nowMs - new Date(createdAtIso).getTime();
  if (!Number.isFinite(waited)) return "fresh";
  if (waited >= URGENT_AFTER_MS) return "urgent";
  if (waited >= WARM_AFTER_MS) return "warm";
  return "fresh";
}