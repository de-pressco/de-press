/**
 * One-shot handoff of a locally composed share text to the companion composer.
 * sessionStorage only: the text lives in this tab until the companion reads it.
 * The companion only prefills its input — nothing is sent automatically.
 */
const KEY = "depress_companion_share";

export function queueCompanionShare(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // sessionStorage unavailable (e.g. private mode) — share simply won't prefill
  }
}

/** Read-and-clear: the queued text is consumed exactly once. */
export function takeQueuedCompanionShare(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value === null) return null;
    sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
