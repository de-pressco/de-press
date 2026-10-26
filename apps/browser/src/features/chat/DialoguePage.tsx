import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, API_URL } from "@/core/api/client";
import type { ChatMessage, Dialogue } from "@/core/api/types";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useChatSocket } from "@/core/hooks/useChatSocket";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";
import { isOfflineTranscript } from "../feed/voicePreview";
import { CircleBubble } from "./CircleBubble";
import {
  CircleRecorder,
  type CircleRecording,
} from "./CircleRecorder";
import { VoiceBubble } from "./VoiceBubble";
import { ForwardPicker } from "./ForwardPicker";
import { ChatMenu, type ChatMenuState } from "./ChatMenu";
import { MessageMenu, type MessageMenuState } from "./MessageMenu";
import { useDialogueActions } from "./useDialogueActions";
import { TipBanner } from "@/features/fund/TipBanner";
import { CallModal } from "@/features/calls/CallModal";
import { useCall } from "@/features/calls/useCall";
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

function isStubTranslation(text: string | undefined): boolean {
  return isOfflineTranscript(text || "");
}

function sourceLangOf(m: ChatMessage): string {
  return (m.source_lang || "ru").slice(0, 2);
}

export function DialoguePage() {
  const { id: dialogueId = "" } = useParams<{ id: string }>();
  const { locale, t } = useI18n();

  const intentLabel = (v: string | null | undefined): string =>
    v ? (t.intents[v] ?? v) : "";
  const { active: panic } = useAntiPanic();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wsEpoch, setWsEpoch] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [useHttpFallback, setUseHttpFallback] = useState(false);
  const [shownLang, setShownLang] = useState<Record<string, string>>({});
  const [chatMenu, setChatMenu] = useState<ChatMenuState | null>(null);
  const [recording, setRecording] = useState(false);
  const [circleOpen, setCircleOpen] = useState(false);

  const [ctxMenu, setCtxMenu] = useState<MessageMenuState | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [forwardFor, setForwardFor] = useState<ChatMessage | null>(null);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAt = useRef(0);
  const voiceReleasedRef = useRef(false);
  const voiceStartingRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const deletingEveryone = useRef(false);
  const translateInflight = useRef(new Set<string>());
  const markingRead = useRef(false);
  const lastReadMarked = useRef<string | null>(null);
  const [translating, setTranslating] = useState<Record<string, true>>({});

  const actions = useDialogueActions({
    onUpdated: (d) => {
      setDialogue(d);
      setDialogueStatus(d.status);
    },
    onCleared: (id) => {
      if (id === dialogueId) setMessages([]);
    },
  });

  const sendCallRef = useRef<(msg: Record<string, unknown>) => void>(() => {});
  const call = useCall((msg) => sendCallRef.current(msg));

  const {
    status: wsStatus,
    messages,
    setMessages,
    dialogueStatus,
    setDialogueStatus,
    abandoned,
    deletedForEveryone,
    pinnedId,
    setPinnedId,
    peerTyping,
    setTyping,
    error: wsError,
    send: wsSend,
    sendCall: wsSendCall,
  } = useChatSocket(
    dialogueId,
    Boolean(dialogueId) && !useHttpFallback && !panic,
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
      const d = await api.getDialogue(dialogueId);
      setDialogue(d);
      setDialogueStatus(d.status);
      setPinnedId(d.pinned_message_id ?? null);
    } catch (err) {
      setDialogue(null);
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  }, [dialogueId, setDialogueStatus, setPinnedId, t.common.error]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!deletedForEveryone || deletingEveryone.current) return;
    let cancelled = false;
    void (async () => {
      await toast.choose({
        message: t.chat.peerDeletedChat,
        actions: [{ id: "ok", label: t.chat.noticeOk }],
        cancelLabel: t.common.cancel,
      });
      if (cancelled) return;
      await queryClient.invalidateQueries({ queryKey: ["dialogues"] });
      navigate("/chat", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [deletedForEveryone, navigate, queryClient, t.chat.noticeOk, t.chat.peerDeletedChat, t.common.cancel, toast]);

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

  const markRead = useCallback(() => {
    if (!dialogueId || markingRead.current) return;
    markingRead.current = true;
    void api
      .markDialogueRead(dialogueId)
      .then((d) => {
        setDialogue((prev) => (prev ? { ...prev, ...d } : d));
        void queryClient.invalidateQueries({ queryKey: ["dialogues"] });
      })
      .catch(() => {
        /* list will catch up on next poll */
      })
      .finally(() => {
        markingRead.current = false;
      });
  }, [dialogueId, queryClient]);

  // Opening the dialogue (or switching between dialogues) reads it.
  useEffect(() => {
    lastReadMarked.current = null;
    markRead();
  }, [markRead]);

  // A peer message landing while the chat is open and the page is visible
  // is read immediately — the active chat must never gain an unread badge.
  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    const last = messages[messages.length - 1];
    if (!last || last.from_me) return;
    if (lastReadMarked.current === last.id) return;
    lastReadMarked.current = last.id;
    markRead();
  }, [messages, markRead]);

  // Coming back to a hidden/minimized window with the chat open → drop badge.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [markRead]);

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

  function translateTarget(m: ChatMessage): string {
    const source = sourceLangOf(m);
    const ui = locale.slice(0, 2);
    return source === ui ? (ui === "en" ? "ru" : "en") : ui;
  }

  function originalText(m: ChatMessage): string {
    if (m.display_text) return m.display_text;
    return m.body;
  }

  function beginTranslate(messageId: string) {
    const existing = messages.find((x) => x.id === messageId);
    if (!existing) return;
    const source = sourceLangOf(existing);
    const target = translateTarget(existing);
    const cached = existing.translations?.[target];
    if (cached && !isStubTranslation(cached)) {
      setShownLang((prev) => {
        const showingTranslation = prev[messageId] === target;
        return { ...prev, [messageId]: showingTranslation ? source : target };
      });
      return;
    }
    if (translateInflight.current.has(messageId)) return;
    translateInflight.current.add(messageId);
    setTranslating((prev) => ({ ...prev, [messageId]: true }));
    void api
      .translateMessage(messageId, target)
      .then((updated) => {
        const tr = updated.translations?.[target];
        if (!tr || isStubTranslation(tr)) {
          setError(t.common.error);
          return;
        }
        upsertMessage(updated);
        setShownLang((prev) => ({ ...prev, [messageId]: target }));
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t.common.error);
      })
      .finally(() => {
        translateInflight.current.delete(messageId);
        setTranslating((prev) => {
          const next = { ...prev };
          delete next[messageId];
          return next;
        });
      });
  }

  async function send() {
    if (!body.trim() || !dialogueId) return;
    setSending(true);
    setError(null);
    try {
      if (editing) {
        const m = await api.editMessage(editing.id, body.trim());
        upsertMessage(m);
        setEditing(null);
        setBody("");
        return;
      }
      if (replyTo || useHttpFallback || wsStatus !== "open") {
        const m = await api.sendMessage(
          dialogueId,
          body,
          locale,
          replyTo?.id,
        );
        upsertMessage(m);
      } else {
        setTyping(false);
        wsSend(body);
      }
      setBody("");
      setReplyTo(null);
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.common.error,
        "danger",
      );
    } finally {
      setSending(false);
    }
  }

  function openCtx(ev: ReactMouseEvent, m: ChatMessage) {
    if (m.is_system) return;
    ev.preventDefault();
    setCtxMenu({ message: m, x: ev.clientX, y: ev.clientY });
  }

  const bubbleHold = useRef<{
    id: string;
    x: number;
    y: number;
    timer: number;
  } | null>(null);

  function clearBubbleHold() {
    if (bubbleHold.current) {
      window.clearTimeout(bubbleHold.current.timer);
      bubbleHold.current = null;
    }
  }

  function onBubblePointerDown(ev: ReactPointerEvent, m: ChatMessage) {
    if (m.is_system) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const { clientX, clientY } = ev;
    const timer = window.setTimeout(() => {
      bubbleHold.current = null;
      setCtxMenu({ message: m, x: clientX, y: clientY });
    }, 500);
    bubbleHold.current = { id: m.id, x: clientX, y: clientY, timer };
  }

  function onBubblePointerMove(ev: ReactPointerEvent) {
    const hold = bubbleHold.current;
    if (!hold) return;
    if (Math.hypot(ev.clientX - hold.x, ev.clientY - hold.y) > 10) {
      clearBubbleHold();
    }
  }

  function copyMsg(m: ChatMessage) {
    const text = m.deleted
      ? t.chat.deletedMsg
      : messageText(m) || m.forwarded_preview || "";
    void navigator.clipboard?.writeText(text);
    toast.show(t.chat.copied);
    setCtxMenu(null);
  }

  async function pinMsg(m: ChatMessage) {
    setCtxMenu(null);
    try {
      const d = await api.pinMessage(dialogueId, m.id);
      setPinnedId(d.pinned_message_id ?? m.id);
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.common.error,
        "danger",
      );
    }
  }

  async function unpinMsg() {
    setCtxMenu(null);
    try {
      await api.unpinMessage(dialogueId);
      setPinnedId(null);
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.common.error,
        "danger",
      );
    }
  }

  async function deleteMsg(m: ChatMessage) {
    setCtxMenu(null);
    const pick = await toast.choose({
      message: t.chat.deleteMsgConfirm,
      actions: [
        { id: "me", label: t.chat.deleteForMe },
        { id: "everyone", label: t.chat.deleteForEveryone, danger: true },
      ],
      cancelLabel: t.chat.confirmNo,
    });
    if (!pick) return;
    try {
      await api.deleteMessage(m.id, pick);
      if (pick === "me") {
        setMessages((prev) => prev.filter((x) => x.id !== m.id));
      } else {
        upsertMessage({
          ...m,
          deleted: true,
          body: "",
          display_text: t.chat.deletedMsg,
          audio_url: null,
          video_url: null,
        });
      }
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.common.error,
        "danger",
      );
    }
  }

  async function doForward(targetId: string) {
    if (!forwardFor) return;
    try {
      await api.forwardMessage(forwardFor.id, targetId);
      toast.show(t.chat.menuForward);
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.common.error,
        "danger",
      );
    } finally {
      setForwardFor(null);
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
      setError(err instanceof ApiError ? err.message : t.common.error);
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
        setError(err instanceof ApiError ? err.message : t.common.error);
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

  async function refreshDialogueLists() {
    await queryClient.invalidateQueries({ queryKey: ["dialogues"] });
  }

  async function close() {
    setChatMenu(null);
    try {
      const d = await api.closeDialogue(dialogueId);
      setDialogue(d);
      setDialogueStatus(d.status);
      if (!useHttpFallback && wsStatus === "open") {
        setTyping(false);
      }
      toast.show(t.chat.closedDone);
      await refreshDialogueLists();
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.common.error,
        "danger",
      );
    }
  }

  async function reopen() {
    setChatMenu(null);
    try {
      const d = await api.reopenDialogue(dialogueId);
      setDialogue(d);
      setDialogueStatus(d.status);
      toast.show(t.chat.reopenDone);
      await refreshDialogueLists();
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.common.error,
        "danger",
      );
    }
  }

  async function reportMsg() {
    if (!reportTarget || !reportReason) return;
    try {
      const res = await api.reportMessage(
        reportTarget,
        reportReason,
        reportDetails.trim(),
      );
      setMsg(res.message);
      setReportTarget(null);
      setReportReason("");
      setReportDetails("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  }

  function onTranslate(messageId: string) {
    beginTranslate(messageId);
  }

  function messageText(m: ChatMessage): string {
    const source = sourceLangOf(m);
    const lang = shownLang[m.id];
    if (lang === source) return originalText(m);
    if (lang && m.translations?.[lang] && !isStubTranslation(m.translations[lang])) {
      return m.translations[lang];
    }
    return originalText(m);
  }

  const open = dialogueStatus === "open" && !abandoned;
  const pinMsgObj = pinnedId
    ? messages.find((x) => x.id === pinnedId)
    : null;
  const canSend = body.trim().length > 0;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [body]);

  if (!dialogueId) {
    return <p className={styles.meta}>{t.chat.dialogueClosed}</p>;
  }

  return (
    <div className={styles.page}>
      {error || wsError ? (
        <p className={styles.error}>{error || wsError}</p>
      ) : null}
      {msg ? <p className={styles.meta}>{msg}</p> : null}

      <header className={styles.chatHeader}>
        <Link to="/chat" className={styles.backLink} aria-label={t.nav.me}>
          ←
        </Link>
        <span className={styles.headerAvatar} aria-hidden>
          {(dialogue?.peer_label || intentLabel(dialogue?.intent) || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className={styles.chatMeta}>
          <p className={styles.chatTitle}>
            {dialogue ? dialogue.peer_label || intentLabel(dialogue.intent) : "…"}
          </p>
          <p className={styles.chatSub}>
            {peerTyping
              ? t.chat.typing
              : dialogue?.peer_label
                ? intentLabel(dialogue.intent)
                : dialogueStatus}
          </p>
        </div>
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={styles.callBtn}
            aria-label={t.calls.call}
            disabled={!open}
            onClick={() => call.start()}
          >
            📞
          </button>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label={t.chat.menuLabel}
            aria-expanded={Boolean(chatMenu)}
            disabled={!dialogue}
            onClick={(ev) => {
              if (!dialogue) return;
              setChatMenu({
                dialogue,
                x: ev.clientX,
                y: ev.clientY,
              });
            }}
          >
            ⋯
          </button>
        </div>
      </header>
      {chatMenu ? (
        <ChatMenu
          state={chatMenu}
          actions={actions}
          onClose={() => setChatMenu(null)}
          extra={
            open ? (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => void close()}
              >
                {t.chat.menuClose}
              </button>
            ) : dialogue?.can_reopen && !abandoned ? (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => void reopen()}
              >
                {t.chat.menuReopen}
              </button>
            ) : null
          }
        />
      ) : null}

      {dialogue?.peer_tip_wallet ? (
        <TipBanner
          wallet={dialogue.peer_tip_wallet}
          verified={dialogue.peer_tip_wallet_verified ?? false}
        />
      ) : null}

      {pinMsgObj && !pinMsgObj.deleted ? (
        <button
          type="button"
          className={styles.pinBar}
          onClick={() => {
            document
              .getElementById(`msg-${pinMsgObj.id}`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          <span>
            {t.chat.pinBar}: {messageText(pinMsgObj).slice(0, 80)}
          </span>
          {open ? (
            <span
              className={styles.pinX}
              onClick={(e) => {
                e.stopPropagation();
                void unpinMsg();
              }}
            >
              ×
            </span>
          ) : null}
        </button>
      ) : null}

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
          const busy = Boolean(translating[m.id]);
          return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={`${styles.msgBlock} ${withPrev ? styles.msgTight : styles.msgLoose}`}
              onContextMenu={(e) => openCtx(e, m)}
              onPointerDown={(e) => onBubblePointerDown(e, m)}
              onPointerMove={onBubblePointerMove}
              onPointerUp={clearBubbleHold}
              onPointerLeave={clearBubbleHold}
              onPointerCancel={clearBubbleHold}
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
                } ${isCircle ? styles.msgMedia : ""} ${groupClass} ${
                  busy ? styles.msgTranslating : ""
                }`}
                aria-busy={busy || undefined}
              >
                {busy ? (
                  <span className={styles.msgTranslateOverlay} aria-hidden>
                    <span className={styles.msgTranslateSpinner} />
                  </span>
                ) : null}
                {busy ? (
                  <span className={styles.srOnly}>{t.chat.translating}</span>
                ) : null}
                {m.deleted ? (
                  <div className={styles.msgDeleted}>{t.chat.deletedMsg}</div>
                ) : null}
                {!m.deleted && m.reply_to ? (
                  <button
                    type="button"
                    className={styles.quote}
                    onClick={() =>
                      document
                        .getElementById(`msg-${m.reply_to!.id}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" })
                    }
                  >
                    {m.reply_to.preview}
                  </button>
                ) : null}
                {!m.deleted && m.forwarded ? (
                  <div className={styles.fwd}>{t.chat.forwardedLabel}</div>
                ) : null}
                {!m.deleted && isCircle && video ? (
                  <CircleBubble
                    videoUrl={video}
                    durationMs={m.duration_ms}
                    fromMe={m.from_me}
                  />
                ) : null}
                {!m.deleted && isVoice && audio ? (
                  <VoiceBubble
                    src={audio}
                    durationMs={m.duration_ms}
                    fromMe={m.from_me}
                  />
                ) : null}
                {!m.deleted && !isCircle && !isVoice ? (
                  <div className={styles.msgBody}>{messageText(m)}</div>
                ) : null}
                {showMeta ? (
                  <div className={styles.msgMeta}>
                    {m.edited_at && !m.deleted ? (
                      <span className={styles.edited}>{t.chat.editedMark}</span>
                    ) : null}
                    {time ? (
                      <span className={styles.msgTime}>{time}</span>
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

      {reportTarget ? (
        <div
          className={styles.reportPanel}
          role="group"
          aria-label={t.report.report}
        >
          <p className={styles.reportTitle}>{t.report.report}</p>
          <div className={styles.reportReasons}>
            {(
              [
                ["abuse", t.report.reasonsAbuse],
                ["spam", t.report.reasonsSpam],
                ["self_harm", t.report.reasonsSelfHarm],
                ["other", t.report.reasonsOther],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={reportReason === key ? styles.reasonOn : styles.reason}
                aria-pressed={reportReason === key}
                onClick={() => setReportReason(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            className={styles.reportInput}
            rows={2}
            maxLength={2000}
            placeholder={t.report.details}
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
          />
          <div className={styles.reportActions}>
            <button
              type="button"
              className={styles.reportBtn}
              disabled={!reportReason}
              onClick={() => void reportMsg()}
            >
              {t.report.send}
            </button>
            <button
              type="button"
              className={styles.reportBtn}
              onClick={() => {
                setReportTarget(null);
                setReportReason("");
                setReportDetails("");
              }}
            >
              {t.report.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {open && (replyTo || editing) ? (
        <div className={styles.replyBar}>
          <span>
            {editing
              ? t.chat.menuEdit
              : `${t.chat.replyTo}: ${(replyTo?.display_text || replyTo?.body || "").slice(0, 80)}`}
          </span>
          <button
            type="button"
            className={styles.replyX}
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
            }}
            aria-label={t.auth.closeMenu}
          >
            ×
          </button>
        </div>
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
          <div className={styles.composerInput}>
            <textarea
              ref={taRef}
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
            {!editing ? (
              <button
                type="button"
                className={styles.composerBtn}
                aria-label={t.chat.circleAria}
                title={t.chat.circleTitle}
                disabled={sending}
                onPointerDown={() => setCircleOpen(true)}
                onContextMenu={(e) => e.preventDefault()}
              >
                <CircleIcon />
              </button>
            ) : null}
            {!editing && !canSend ? (
              <button
                type="button"
                className={`${styles.composerBtn} ${recording ? styles.recBtn : ""}`}
                aria-label={recording ? t.chat.stop : t.chat.micAria}
                title={recording ? t.chat.stop : t.chat.micAria}
                disabled={sending}
                onPointerDown={beginVoiceHold}
                onContextMenu={(e) => e.preventDefault()}
              >
                <MicIcon />
              </button>
            ) : null}
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
          releaseHint: t.chat.circleRelease,
        }}
      />

      {ctxMenu ? (
        <MessageMenu
          state={ctxMenu}
          chatOpen={open}
          pinnedId={pinnedId}
          onClose={() => setCtxMenu(null)}
          onReply={(m) => {
            setEditing(null);
            setReplyTo(m);
            setCtxMenu(null);
          }}
          onCopy={copyMsg}
          onForward={(m) => {
            setForwardFor(m);
            setCtxMenu(null);
          }}
          onPin={(m) => void pinMsg(m)}
          onUnpin={() => void unpinMsg()}
          onEdit={(m) => {
            setReplyTo(null);
            setEditing(m);
            setBody(m.body || "");
            setCtxMenu(null);
          }}
          onDelete={(m) => void deleteMsg(m)}
          onReport={(m) => {
            setCtxMenu(null);
            setReportReason("");
            setReportDetails("");
            setReportTarget(m.id);
          }}
          onTranslate={(m) => {
            setCtxMenu(null);
            void onTranslate(m.id);
          }}
        />
      ) : null}

      {forwardFor ? (
        <ForwardPicker
          currentId={dialogueId}
          onPick={(id) => void doForward(id)}
          onClose={() => setForwardFor(null)}
        />
      ) : null}

      <CallModal call={call} />
    </div>
  );
}
