import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { registerSocket } from "@/core/ws/registry";
import { buildWsBase } from "@/core/ws/url";

export type HelperQueueStatus = "connecting" | "open" | "closed" | "error";

export interface HelperQueueEntry {
  id: string;
  note: string;
  created_at: string;
}

interface ServerEnvelope {
  type: string;
  queue?: HelperQueueEntry[];
  request?: HelperQueueEntry;
  id?: string;
}

function buildWsUrl(): string {
  return `${buildWsBase()}/ws/helper/queue/`;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
const RECONNECT_MAX_ATTEMPTS = 10;

/**
 * Live human-help queue for the Helper dashboard (P5, Q4).
 * WS primary; fresh snapshot on every (re)connect; `refresh` re-pulls
 * after a duty toggle. No HTTP polling.
 */
export function useHelperQueue(enabled: boolean) {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<HelperQueueEntry[]>([]);
  const [status, setStatus] = useState<HelperQueueStatus>("closed");
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalClose = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refresh = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "queue.refresh" }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setQueue([]);
      setStatus("closed");
      return;
    }

    intentionalClose.current = false;
    let cancelled = false;

    const handleEnvelope = (data: ServerEnvelope) => {
      if (data.type === "snapshot") {
        setQueue(data.queue ?? []);
      } else if (data.type === "queue.new" && data.request) {
        const entry = data.request;
        setQueue((prev) =>
          prev.some((x) => x.id === entry.id) ? prev : [entry, ...prev],
        );
      } else if (
        (data.type === "queue.taken" || data.type === "queue.cancelled") &&
        data.id
      ) {
        const removedId = data.id;
        setQueue((prev) => prev.filter((x) => x.id !== removedId));
        void queryClient.invalidateQueries({
          queryKey: ["helper-dashboard"],
        });
      }
    };

    const connect = () => {
      if (cancelled || intentionalClose.current || !enabledRef.current) return;
      setStatus("connecting");

      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;
      registerSocket(ws);

      ws.onopen = () => {
        if (cancelled) return;
        setStatus("open");
        attemptRef.current = 0;
      };

      ws.onmessage = (ev) => {
        try {
          handleEnvelope(JSON.parse(ev.data as string) as ServerEnvelope);
        } catch {
          /* bad payload — keep the last snapshot */
        }
      };

      ws.onerror = () => {
        /* onclose schedules reconnect */
      };

      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        if (intentionalClose.current) {
          setStatus("closed");
          return;
        }

        const attempt = attemptRef.current;
        if (attempt >= RECONNECT_MAX_ATTEMPTS) {
          setStatus("error");
          return;
        }

        setStatus("connecting");
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attempt,
          RECONNECT_MAX_MS,
        );
        attemptRef.current = attempt + 1;
        reconnectTimer.current = setTimeout(connect, delay);
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

  return { queue, status, refresh };
}
