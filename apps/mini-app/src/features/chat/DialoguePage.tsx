import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, API_URL } from "@/core/api/client";
import type { ChatMessage, Dialogue } from "@/core/api/types";
import { useChatSocket } from "@/core/hooks/useChatSocket";
import { useI18n } from "@/core/i18n/context";
import { TipBanner } from "@/features/fund/TipBanner";
import { CallModal } from "@/features/calls/CallModal";
import { useCall } from "@/features/calls/useCall";
import { CircleBubble } from "./CircleBubble";
import {
  CircleRecorder,
  type CircleRecording,
} from "./CircleRecorder";
import { useToast } from "@/core/toast";
import { friendlyError } from "@/core/api/errorCopy";
import styles from "./DialoguePage.module.css";

function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function formatTime(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDayLabel(
  iso: string,
  locale: string,
  labels: { today: string; yesterday: string },
): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const day = startOfLocalDay(d);
    const now = startOfLocalDay(new Date());
    const diffDays = Math.round((now - day) / 86_400_000);
    if (diffDays === 0) return labels.today;
    if (diffDays === 1) return labels.yesterday;
    return d.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "";
  }
}

/** Same sender grouping (TG Desktop stack). */
function sameAuthorCluster(a: ChatMessage, b: ChatMessage | undefined): boolean {
  if (!b || a.is_system || b.is_system) return false;
  if (a.from_me !== b.from_me) return false;
  if (dayKey(a.created_at) !== dayKey(b.created_at)) return false;
  // Don't glue circles tightly into text stacks
  if (a.kind === "circle" || b.kind === "circle") return false;
  return true;
}

function SendIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DialoguePage() {
  const { id: dialogueId = "" } = useParams<{ id: string }>();
  const { locale, t } = useI18n();
  const toast = useToast();
  const [wsEpoch, setWsEpoch] = useState(0);

  const intentLabel = (v: string | null | undefined): string =>
    v ? (t.intents[v] ?? v) : "";
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [useHttpFallback, setUseHttpFallback] = useState(false);
  const [shownLang, setShownLang] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [circleOpen, setCircleOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAt = useRef(0);
  const voiceReleasedRef = useRef(false);
  const voiceStartingRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const sendCallRef = useRef<(msg: Record<string, unknown>) => void>(() => {});
  const call = useCall((msg) => sendCallRef.current(msg));
  const callsSupported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices);

  const {
    status: wsStatus,
    messages,
    setMessages,
    dialogueStatus,
    setDialogueStatus,
    peerTyping,
    setTyping,
    reconnectAttempt,
    error: wsError,
    send: wsSend,
    closeDialogue: wsClose,
    sendCall: wsSendCall,
  } = useChatSocket(
    dialogueId,
    Boolean(dialogueId) && !useHttpFallback,
    { onCall: call.onSignal },
    wsEpoch,
  );

  sendCallRef.current = wsSendCall;

  // Signaling socket died (incl. Anti-Panic kill) → the call dies with it.
  useEffect(() => {
    if (wsStatus === "closed" || wsStatus === "error") call.onSocketDown();
  }, [wsStatus, call.onSocketDown]);

  const loadMeta = useCallback(async () => {
    if (!dialogueId) return;
    try {
      const list = await api.myDialogues();
      const d = list.find((x) => x.id === dialogueId) ?? null;
      setDialogue(d);
      if (d) setDialogueStatus(d.status);
    } catch (err) {
      setError(friendlyError(err, t.common.errorSoft));
    }
  }, [dialogueId, setDialogueStatus, t.common.error]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (wsStatus === "error") {
      setUseHttpFallback(true);
      void (async () => {
        try {
          const msgs = await api.dialogueMessages(dialogueId);
          setMessages(msgs);
        } catch {
          /* ignore */
        }
      })();
    }
  }, [wsStatus, dialogueId, setMessages]);

  useEffect(() => {
    if (!useHttpFallback || !dialogueId) return;
    const timer = window.setInterval(async () => {
      try {
        const msgs = await api.dialogueMessages(dialogueId);
        setMessages(msgs);
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [useHttpFallback, dialogueId, setMessages]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, peerTyping]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function onBodyChange(value: string) {
    setBody(value);
    if (!useHttpFallback && wsStatus === "open") {
      setTyping(value.trim().length > 0);
    }
  }

  function upsertMessage(m: ChatMessage) {
    setMessages((prev) =>
      prev.some((x) => x.id === m.id)
        ? prev.map((x) => (x.id === m.id ? { ...x, ...m } : x))
        : [...prev, m],
    );
  }

  async function send() {
    if (!body.trim() || !dialogueId) return;
    setSending(true);
    setError(null);
    try {
      if (!useHttpFallback && wsStatus === "open") {
        setTyping(false);
        wsSend(body);
        setBody("");
      } else {
        const m = await api.sendMessage(dialogueId, body, locale);
        upsertMessage(m);
        setBody("");
      }
    } catch (err) {
      setError(friendlyError(err, t.common.errorSoft));
    } finally {
      setSending(false);
    }
  }

  async function sendVoice(blob: Blob, durationMs: number) {
    if (!dialogueId) return;
    setSending(true);
    setError(null);
    try {
      const m = await api.sendVoiceMessage(dialogueId, blob, {
        durationMs,
        sourceLang: locale,
        filename: "note.webm",
      });
      upsertMessage(m);
    } catch (err) {
      setError(friendlyError(err, t.common.errorSoft));
    } finally {
      setSending(false);
    }
  }

  async function sendCircle(rec: CircleRecording) {
    if (!dialogueId) return;
    setSending(true);
    setError(null);
    setMsg(null);
    try {
      const m = await api.sendCircleMessage(dialogueId, rec.blob, {
        durationMs: rec.durationMs,
        sourceLang: locale,
        filename: "circle.webm",
      });
      upsertMessage(m);
      if (rec.objectUrl) URL.revokeObjectURL(rec.objectUrl);
      setCircleOpen(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501 || err.status === 405)) {
        setMsg(t.chat.circleNotReady);
        setCircleOpen(false);
      } else {
        setError(friendlyError(err, t.common.errorSoft));
      }
    } finally {
      setSending(false);
    }
  }

  function stopVoice() {
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
  }

  async function startVoice() {
    if (voiceStartingRef.current || recording) return;
    voiceStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const duration = Date.now() - startedAt.current;
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        if (blob.size > 0) void sendVoice(blob, duration);
      };
      mediaRef.current = recorder;
      startedAt.current = Date.now();
      recorder.start();
      setRecording(true);
      // The finger was released while the mic permission was still pending.
      if (voiceReleasedRef.current) stopVoice();
    } catch {
      setError(t.chat.unsupported);
    } finally {
      voiceStartingRef.current = false;
    }
  }

  // Hold the mic to record; releasing sends the voice immediately.
  function beginVoiceHold() {
    if (sending) return;
    voiceReleasedRef.current = false;
    void startVoice();
    const release = () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      voiceReleasedRef.current = true;
      stopVoice();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }

  async function close() {
    setMenuOpen(false);
    try {
      if (!useHttpFallback && wsStatus === "open") {
        setTyping(false);
        wsClose();
        setDialogueStatus("closed");
      } else {
        const d = await api.closeDialogue(dialogueId);
        setDialogue(d);
        setDialogueStatus(d.status);
      }
    } catch (err) {
      setError(friendlyError(err, t.common.errorSoft));
    }
  }

  async function blockPeer() {
    setMenuOpen(false);
    const ok = await toast.confirm({
      message: t.chat.hidePeerConfirm,
      confirmLabel: t.chat.confirmBlock,
      cancelLabel: t.common.cancel,
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.blockPeerInDialogue(dialogueId);
      setMsg(res.message);
      await close();
    } catch (err) {
      setError(friendlyError(err, t.common.errorSoft));
    }
  }

  async function reportMsg(messageId: string) {
    try {
      const res = await api.reportMessage(messageId, "abuse");
      setMsg(res.message);
    } catch (err) {
      setError(friendlyError(err, t.common.errorSoft));
    }
  }

  async function onTranslate(messageId: string) {
    try {
      const existing = messages.find((x) => x.id === messageId);
      const source = (existing?.source_lang || "ru").slice(0, 2);
      const ui = locale.slice(0, 2);
      const target = source === ui ? (ui === "en" ? "ru" : "en") : ui;
      const m = await api.translateMessage(messageId, target);
      upsertMessage(m);
      setShownLang((prev) => ({ ...prev, [messageId]: target }));
    } catch (err) {
      setError(friendlyError(err, t.common.errorSoft));
    }
  }

  function messageText(m: ChatMessage): string {
    const lang = shownLang[m.id];
    if (lang && m.translations?.[lang]) return m.translations[lang];
    if (m.display_text) return m.display_text;
    return m.body;
  }

  const open = dialogueStatus === "open";
  const canSend = body.trim().length > 0;
  const statusLabel = useHttpFallback
    ? "HTTP"
    : wsStatus === "open"
      ? t.chat.statusLive
      : wsStatus === "connecting" && reconnectAttempt > 0
        ? t.chat.statusReconnect(reconnectAttempt)
        : wsStatus === "connecting"
          ? t.chat.statusConnecting
          : wsStatus === "closed"
            ? t.chat.statusClosed
            : t.chat.statusError;

  if (!dialogueId) {
    return <p className={styles.meta}>{t.chat.dialogueClosed}</p>;
  }

  return (
    <div className={styles.page}>
      {dialogue?.rules ? (
        <div className={styles.rules}>{dialogue.rules}</div>
      ) : null}
      {error || wsError ? (
        <p className={styles.error}>{error || wsError}</p>
      ) : null}
      {msg ? <p className={styles.meta}>{msg}</p> : null}

      <header className={styles.chatHeader}>
        <Link to="/chat" className={styles.backLink} aria-label={t.nav.me}>
          ←
        </Link>
        <span className={styles.headerAvatar} aria-hidden>
          {(intentLabel(dialogue?.intent) || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className={styles.chatMeta}>
          <p className={styles.chatTitle}>
            {dialogue ? intentLabel(dialogue.intent) : "…"}
          </p>
          <p className={styles.chatSub}>
            {dialogueStatus} · {statusLabel}
          </p>
        </div>
        {callsSupported ? (
          <button
            type="button"
            className={styles.callBtn}
            aria-label={t.calls.call}
            disabled={!open}
            onClick={() => call.start()}
          >
            📞
          </button>
        ) : null}
        <div className={styles.menuWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label={t.chat.menuLabel}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className={styles.menu}>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => void close()}
              >
                {t.chat.menuClose}
              </button>
              <button
                type="button"
                className={styles.menuItemDanger}
                onClick={() => void blockPeer()}
              >
                {t.chat.menuHide}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className={styles.thread} ref={threadRef}>
        {messages.map((m, i) => {
          const audio = mediaUrl(m.audio_url);
          const video = mediaUrl(m.video_url);
          const isCircle = m.kind === "circle" || !!video;
          const isVoice = !isCircle && (m.kind === "voice" || !!audio);
          const time = formatTime(m.created_at, locale);
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const showDay =
            !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const withPrev = sameAuthorCluster(m, prev);
          const withNext = sameAuthorCluster(m, next);
          const groupClass = m.is_system
            ? ""
            : withPrev && withNext
              ? styles.groupMid
              : withPrev && !withNext
                ? styles.groupLast
                : !withPrev && withNext
                  ? styles.groupFirst
                  : styles.groupSolo;
          const showMeta = !m.is_system && !withNext;
          return (
            <div
              key={m.id}
              className={`${styles.msgBlock} ${withPrev ? styles.msgTight : styles.msgLoose}`}
            >
              {showDay ? (
                <div className={styles.dateChip}>
                  {formatDayLabel(m.created_at, locale, {
                    today: t.chat.dayToday,
                    yesterday: t.chat.dayYesterday,
                  })}
                </div>
              ) : null}
              <div
                className={`${styles.msg} ${
                  m.is_system
                    ? styles.system
                    : m.from_me
                      ? styles.me
                      : styles.them
                } ${isCircle ? styles.msgMedia : ""} ${groupClass}`}
              >
                {isCircle && video ? (
                  <CircleBubble
                    videoUrl={video}
                    durationMs={m.duration_ms}
                    fromMe={m.from_me}
                  />
                ) : null}
                {isVoice && audio ? (
                  <audio
                    className={styles.audio}
                    controls
                    src={audio}
                    preload="metadata"
                  />
                ) : null}
                {!isCircle && !isVoice ? (
                  <div className={styles.msgBody}>{messageText(m)}</div>
                ) : null}
                {showMeta ? (
                  <div className={styles.msgMeta}>
                    {time ? (
                      <span className={styles.msgTime}>{time}</span>
                    ) : null}
                  </div>
                ) : null}
                {showMeta && !isCircle ? (
                  <div className={styles.msgActions}>
                    {!isVoice ? (
                      <button
                        type="button"
                        className={styles.msgAction}
                        onClick={() => void onTranslate(m.id)}
                      >
                        {t.chat.translate}
                      </button>
                    ) : null}
                    {!m.from_me ? (
                      <button
                        type="button"
                        className={styles.msgAction}
                        onClick={() => void reportMsg(m.id)}
                      >
                        {t.report.report.toLowerCase()}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {peerTyping ? (
          <div className={styles.typing} aria-live="polite">
            <span className={styles.dots} aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {t.chat.typing}
          </div>
        ) : null}
      </div>

      {dialogue?.peer_tip_wallet ? (
        <TipBanner
          wallet={dialogue.peer_tip_wallet}
          verified={dialogue.peer_tip_wallet_verified ?? false}
        />
      ) : null}

      {open ? (
        <>
        {wsStatus === "error" ? (
          <div className={styles.wsBanner} role="status">
            <span>{wsError ?? t.chat.wsDead}</span>
            <button type="button" onClick={() => setWsEpoch((e) => e + 1)}>
              {t.common.retry}
            </button>
          </div>
        ) : null}
        <div className={styles.composer}>
          <button
            type="button"
            className={styles.composerBtn}
            aria-label={t.chat.circleAria}
            title={t.chat.circleTitle}
            disabled={sending}
            onClick={() => setCircleOpen(true)}
          >
            <CircleIcon />
          </button>
          <div className={styles.composerInput}>
            <textarea
              className={styles.composerTextarea}
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              onBlur={() => {
                if (!useHttpFallback && wsStatus === "open") setTyping(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={t.chat.composerPlaceholder}
              aria-label={t.chat.composerPlaceholder}
            />
          </div>
          <button
            type="button"
            className={`${styles.composerBtn} ${recording ? styles.recBtn : ""}`}
            aria-label={recording ? t.chat.stop : t.chat.micAria}
            disabled={sending}
            onPointerDown={beginVoiceHold}
            onContextMenu={(e) => e.preventDefault()}
          >
            <MicIcon />
          </button>
          {canSend ? (
            <button
              type="button"
              className={`${styles.composerBtn} ${styles.sendBtn}`}
              onClick={() => void send()}
              disabled={sending}
              aria-label={t.chat.sendAria}
              title={t.chat.send}
            >
              <SendIcon />
            </button>
          ) : null}
        </div>
        </>
      ) : (
        <p className={styles.meta}>{t.chat.dialogueClosed}</p>
      )}

      <CircleRecorder
        open={circleOpen}
        onClose={() => setCircleOpen(false)}
        onRecorded={sendCircle}
        busy={sending}
        labels={{
          title: t.chat.circleTitle,
          start: t.chat.circleStart,
          stop: t.chat.stop,
          send: t.chat.circleSend,
          retake: t.chat.circleRetake,
          cancel: t.common.cancel,
          unsupported: t.chat.unsupported,
          recording: t.chat.recording,
          preview: t.chat.circlePreview,
          ephemeralHint: t.chat.circleEphemeral,
          maxSec: t.chat.circleMax,
        }}
      />

      <CallModal call={call} />
    </div>
  );
}
