import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import { killAllSockets, registerSocket } from "@/core/ws/registry";
import { buildWsBase } from "@/core/ws/url";

export type WsStatus = "connecting" | "open" | "closed" | "error";

/** Relay of a server `call.*` signaling event (ADR 0021). */
export interface CallSignalEvent {
  type: string;
  call_id?: string;
  reason?: string;
  sdp?: string;
  candidate?: unknown;
}

export interface ChatSocketOptions {
  onCall?: (ev: CallSignalEvent) => void;
}

interface ServerEnvelope {
  type: string;
  message?: ChatMessage & {
    from_account_id?: string | null;
    from_session_id?: string | null;
  };
  messages?: ChatMessage[];
  dialogue?: { id: string; status: string; closed_at?: string | null };
  status?: string;
  detail?: string;
  typing?: boolean;
  from_me?: boolean;
}

function buildWsUrl(dialogueId: string): string {
  return `${buildWsBase()}/ws/dialogues/${dialogueId}/`;
}

const PEER_TYPING_IDLE_MS = 3500;
const TYPING_DEBOUNCE_MS = 300;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 12_000;
const RECONNECT_MAX_ATTEMPTS = 8;

/**
 * Realtime dialogue + typing + reconnect with exponential backoff.
 */
export function useChatSocket(
  dialogueId: string,
  enabled = true,
  opts?: ChatSocketOptions,
  epoch = 0,
) {
  const { t } = useI18n();
  const [status, setStatus] = useState<WsStatus>("closed");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [dialogueStatus, setDialogueStatus] = useState<string>("open");
  const [error, setError] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const intentionalClose = useRef(false);
  const localTyping = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const enabledRef = useRef(enabled);

  enabledRef.current = enabled;

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearPeerIdle = useCallback(() => {
    if (peerIdleTimer.current) {
      clearTimeout(peerIdleTimer.current);
      peerIdleTimer.current = null;
    }
  }, []);

  const markPeerTyping = useCallback(
    (typing: boolean) => {
      clearPeerIdle();
      setPeerTyping(typing);
      if (typing) {
        peerIdleTimer.current = setTimeout(() => {
          setPeerTyping(false);
        }, PEER_TYPING_IDLE_MS);
      }
    },
    [clearPeerIdle],
  );

  const sendTypingRaw = useCallback((typing: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: typing ? "typing.start" : "typing.stop",
      }),
    );
    localTyping.current = typing;
  }, []);

  const setTyping = useCallback(
    (typing: boolean) => {
      if (typingDebounce.current) {
        clearTimeout(typingDebounce.current);
        typingDebounce.current = null;
      }
      if (typingStopTimer.current) {
        clearTimeout(typingStopTimer.current);
        typingStopTimer.current = null;
      }

      if (typing) {
        if (!localTyping.current) {
          typingDebounce.current = setTimeout(() => {
            sendTypingRaw(true);
          }, TYPING_DEBOUNCE_MS);
        }
        typingStopTimer.current = setTimeout(() => {
          if (localTyping.current) sendTypingRaw(false);
        }, PEER_TYPING_IDLE_MS);
      } else if (localTyping.current) {
        sendTypingRaw(false);
      }
    },
    [sendTypingRaw],
  );

  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (localTyping.current) sendTypingRaw(false);
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("closed");
    setPeerTyping(false);
    attemptRef.current = 0;
    setReconnectAttempt(0);
  }, [sendTypingRaw]);

  useEffect(() => {
    if (!enabled || !dialogueId) {
      return;
    }

    intentionalClose.current = false;
    let cancelled = false;

    const handleEnvelope = (data: ServerEnvelope) => {
      if (data.type === "history" && data.messages) {
        setMessages(data.messages);
        if (data.status) setDialogueStatus(data.status);
      } else if (data.type === "message.new" && data.message) {
        const m = data.message;
        if (!m.from_me) markPeerTyping(false);
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id)) return prev;
          return [
            ...prev,
            {
              id: m.id,
              kind: m.kind,
              body: m.body,
              display_text: m.display_text,
              source_lang: m.source_lang,
              translations: m.translations,
              duration_ms: m.duration_ms,
              audio_url: m.audio_url,
              created_at: m.created_at,
              from_me: Boolean(m.from_me),
              is_system: Boolean(m.is_system),
            },
          ];
        });
      } else if (data.type === "typing") {
        if (!data.from_me) markPeerTyping(Boolean(data.typing));
      } else if (data.type === "dialogue.closed") {
        setDialogueStatus("closed");
        setPeerTyping(false);
      } else if (data.type.startsWith("call.")) {
        optsRef.current?.onCall?.(data as CallSignalEvent);
      } else if (data.type === "error") {
        setError(data.detail || "WebSocket error");
      }
    };

    const connect = () => {
      if (cancelled || intentionalClose.current || !enabledRef.current) return;

      setStatus("connecting");
      setError(null);
      setPeerTyping(false);

      const url = buildWsUrl(dialogueId);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      registerSocket(ws);

      ws.onopen = () => {
        if (cancelled) return;
        setStatus("open");
        attemptRef.current = 0;
        setReconnectAttempt(0);
        setError(null);
      };

      ws.onmessage = (ev) => {
        try {
          handleEnvelope(JSON.parse(ev.data as string) as ServerEnvelope);
        } catch {
          setError(t.chat.wsBadPayload);
        }
      };

      ws.onerror = () => {
        // onclose will schedule reconnect
      };

      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        setPeerTyping(false);
        localTyping.current = false;

        if (intentionalClose.current) {
          setStatus("closed");
          return;
        }

        const attempt = attemptRef.current;
        if (attempt >= RECONNECT_MAX_ATTEMPTS) {
          setStatus("error");
          setError(t.chat.wsDead);
          return;
        }

        setStatus("connecting");
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attempt,
          RECONNECT_MAX_MS,
        );
        attemptRef.current = attempt + 1;
        setReconnectAttempt(attempt + 1);
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
      const ws = wsRef.current;
      if (ws && localTyping.current && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "typing.stop" }));
        } catch {
          /* ignore */
        }
      }
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      if (typingDebounce.current) clearTimeout(typingDebounce.current);
      clearPeerIdle();
      ws?.close();
      wsRef.current = null;
    };
  }, [dialogueId, enabled, epoch, markPeerTyping, clearPeerIdle]);

  const send = useCallback(
    (body: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("socket not open");
      }
      if (localTyping.current) sendTypingRaw(false);
      ws.send(JSON.stringify({ type: "message.send", body }));
    },
    [sendTypingRaw],
  );

  const closeDialogue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("socket not open");
    }
    if (localTyping.current) sendTypingRaw(false);
    ws.send(JSON.stringify({ type: "dialogue.close" }));
  }, [sendTypingRaw]);

  /** Fire-and-forget signaling send for the call UI (ADR 0021). */
  const sendCall = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  return {
    status,
    messages,
    setMessages,
    dialogueStatus,
    setDialogueStatus,
    peerTyping,
    setTyping,
    reconnectAttempt,
    error,
    send,
    closeDialogue,
    sendCall,
    disconnect,
    killAll: killAllSockets,
  };
}
