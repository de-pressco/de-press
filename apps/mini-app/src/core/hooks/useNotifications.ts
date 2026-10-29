import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AppNotification } from "@/core/api/types";
import { registerSocket } from "@/core/ws/registry";
import { buildWsBase } from "@/core/ws/url";

interface ServerEnvelope {
  type: string;
  notification?: AppNotification;
}

function buildWsUrl(): string {
  return `${buildWsBase()}/ws/notifications/`;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
const RECONNECT_MAX_ATTEMPTS = 10;

/**
 * Live notifications over WS: cache invalidations + the onNew toast
 * callback. No HTTP fallback (same as browser host).
 */
export function useNotifications(
  enabled = true,
  onNew?: (n: AppNotification) => void,
) {
  const queryClient = useQueryClient();

  const wsRef = useRef<WebSocket | null>(null);
  const intentionalClose = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const enabledRef = useRef(enabled);
  const onNewRef = useRef(onNew);

  enabledRef.current = enabled;
  onNewRef.current = onNew;

  useEffect(() => {
    if (!enabled) return;

    intentionalClose.current = false;
    let cancelled = false;

    const handleEnvelope = (data: ServerEnvelope) => {
      if (data.type === "notification.new" && data.notification) {
        const kind = data.notification.kind;
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        void queryClient.invalidateQueries({
          queryKey: ["notifications-unread"],
        });
        if (
          kind === "dialogue_request" ||
          kind === "dialogue_opened" ||
          kind === "outreach_intro" ||
          kind === "message" ||
          kind === "dialogue_deleted"
        ) {
          void queryClient.invalidateQueries({ queryKey: ["dialogues"] });
          void queryClient.invalidateQueries({
            queryKey: ["dialogue-requests"],
          });
        }
        if (
          kind === "support_cloud" ||
          kind === "cloud_approved" ||
          kind === "silent_empathy"
        ) {
          void queryClient.invalidateQueries({ queryKey: ["story"] });
          void queryClient.invalidateQueries({ queryKey: ["feed"] });
          void queryClient.invalidateQueries({ queryKey: ["my-stories"] });
          void queryClient.invalidateQueries({ queryKey: ["hearers"] });
        }
        if (kind === "help_requested") {
          void queryClient.invalidateQueries({ queryKey: ["help-requests"] });
        }
        if (kind === "help_accepted") {
          void queryClient.invalidateQueries({ queryKey: ["help-mine"] });
          void queryClient.invalidateQueries({ queryKey: ["dialogues"] });
        }
        if (
          kind !== "support_cloud" &&
          kind !== "cloud_approved" &&
          kind !== "silent_empathy"
        ) {
          onNewRef.current?.(data.notification);
        }
      }
    };

    const connect = () => {
      if (cancelled || intentionalClose.current || !enabledRef.current) return;

      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;
      registerSocket(ws);

      ws.onopen = () => {
        if (cancelled) return;
        attemptRef.current = 0;
      };

      ws.onmessage = (ev) => {
        try {
          handleEnvelope(JSON.parse(ev.data as string) as ServerEnvelope);
        } catch {
          /* ignore malformed payloads */
        }
      };

      ws.onerror = () => {
        /* onclose schedules reconnect */
      };

      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        if (intentionalClose.current) return;

        const attempt = attemptRef.current;
        if (attempt >= RECONNECT_MAX_ATTEMPTS) return;

        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attempt,
          RECONNECT_MAX_MS,
        );
        attemptRef.current = attempt + 1;
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      intentionalClose.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, queryClient]);
}