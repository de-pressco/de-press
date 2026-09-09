import { ApiError } from "@de-press/api-client";

/**
 * Единая тональность ошибок для уязвимой аудитории: технический detail
 * бэкенда остаётся в debug-логе, в UI уходит мягкая локализованная фраза.
 */
export function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    console.debug(`[api] ${err.status} ${err.message}`);
  } else {
    console.debug("[network]", err);
  }
  return fallback;
}