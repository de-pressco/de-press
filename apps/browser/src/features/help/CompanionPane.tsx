import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type AiStreamHandlers } from "@/core/api/client";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";
import {
  addCompanionMessage,
  createCompanionChat,
  deleteCompanionChat,
  deriveChatTitle,
  listCompanionChats,
  listCompanionMessages,
  renameCompanionChat,
  touchCompanionChat,
  wipeAllMemory,
  type CompanionChat,
} from "@/core/memory/db";
import { takeQueuedCompanionShare } from "@/core/memory/companionShare";
import styles from "./CompanionPane.module.css";

type Turn = { role: "user" | "assistant"; content: string; crisis?: boolean };

/** Server keeps the last ≤12 messages per turn; match it client-side. */
const HISTORY_SENT_LIMIT = 12;

const LAST_CHAT_KEY = "depress_companion_chat";

/** Smooth-reveal state: full text accumulates, the visible part catches up. */
type RevealState = {
  acc: string;
  shown: number;
  done: boolean;
  crisis: boolean;
  active: boolean;
  last: number;
  token: number;
};

/**
 * Quiet Companion: AI chat via api.aiSupportStream(...) (SSE).
 * Dialogs live only in IndexedDB on this device (never synced); a new dialog
 * is titled from the first user message. Replies stream in with a smooth
 * reveal (crisis replies show at once); Stop aborts mid-stream.
 * Wiping uses the same wipe as patterns, with its own confirmation.
 * Crisis replies open Anti-Panic.
 */
export function CompanionPane() {
  const { t } = useI18n();
  const { enter } = useAntiPanic();
  const toast = useToast();
  const navigate = useNavigate();
  const [chats, setChats] = useState<CompanionChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_CHAT_KEY);
    } catch {
      return null;
    }
  });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [disclaimer, setDisclaimer] = useState("");
  const [listOpen, setListOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 1099,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const skipLoadRef = useRef(false);
  const streamTokenRef = useRef(0);
  const revealRef = useRef<RevealState>({
    acc: "",
    shown: 0,
    done: false,
    crisis: false,
    active: false,
    last: 0,
    token: 0,
  });

  const refreshChats = useCallback(() => {
    listCompanionChats()
      .then(setChats)
      .catch(() => undefined); // no IndexedDB → session-only chat
  }, []);

  useEffect(() => {
    // Explicit share from Patterns: prefill the composer, the user still sends.
    const prefill = takeQueuedCompanionShare();
    if (prefill) setInput(prefill);
  }, []);

  useEffect(() => {
    listCompanionChats()
      .then((rows) => {
        setChats(rows);
        setActiveChatId((cur) =>
          cur && rows.some((c) => c.id === cur) ? cur : null,
        );
      })
      .catch(() => undefined); // no IndexedDB → session-only chat
  }, []);

  // Load the transcript whenever the active dialog changes from the outside
  // (list click, delete, wipe). send() sets skipLoadRef to keep its own
  // optimistic turns when it creates the dialog.
  useEffect(() => {
    if (skipLoadRef.current) {
      skipLoadRef.current = false;
      return;
    }
    let cancelled = false;
    if (!activeChatId) {
      setTurns([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    listCompanionMessages(activeChatId)
      .then((rows) => {
        if (cancelled) return;
        setTurns(
          rows.map((m) => ({
            role: m.role,
            content: m.content,
            crisis: m.crisis,
          })),
        );
      })
      .catch(() => undefined) // no IndexedDB → session-only chat
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  // Remember the last open dialog for the next visit.
  useEffect(() => {
    try {
      if (activeChatId) localStorage.setItem(LAST_CHAT_KEY, activeChatId);
      else localStorage.removeItem(LAST_CHAT_KEY);
    } catch {
      /* no localStorage → nothing to remember */
    }
  }, [activeChatId]);

  // Keep the thread pinned to the bottom while it grows (streaming), unless
  // the reader scrolled up.
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  function onThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  function startReveal() {
    const st = revealRef.current;
    if (st.active) return;
    st.active = true;
    st.last = performance.now();
    requestAnimationFrame(stepReveal);
  }

  function stepReveal() {
    const st = revealRef.current;
    if (!st.active) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - st.last) / 1000);
    st.last = now;
    const target = st.acc.length;
    if (st.crisis) {
      st.shown = target; // no typewriter over the 112 / 103 instructions
    } else if (st.shown < target) {
      const rate = Math.max(320, target / 2.5); // chars/s, catch-up ≤ ~2.5s
      st.shown = Math.min(target, st.shown + rate * dt);
    }
    const current = streamTokenRef.current === st.token;
    if (current) {
      const visible = st.acc.slice(0, Math.floor(st.shown));
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: visible,
            ...(st.crisis ? { crisis: true } : {}),
          };
        }
        return next;
      });
    }
    if (st.done && st.shown >= target) {
      st.active = false;
      if (current) setStreaming(false);
      return;
    }
    requestAnimationFrame(stepReveal);
  }

  function killStream() {
    abortRef.current?.abort();
    streamTokenRef.current += 1;
    revealRef.current.active = false;
    setStreaming(false);
  }

  function openChat(id: string | null) {
    setListOpen(false);
    if (id === activeChatId) return;
    if (streaming) killStream();
    setError(null);
    setDisclaimer("");
    skipLoadRef.current = false;
    setActiveChatId(id);
  }

  function newChat() {
    openChat(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");

    let chatId = activeChatId;
    if (!chatId) {
      try {
        // First message names the dialog (ChatGPT-style auto-naming).
        const chat = await createCompanionChat(deriveChatTitle(text));
        chatId = chat.id;
        skipLoadRef.current = true; // keep the optimistic turns below
        setChats((prev) => [chat, ...prev]);
        setActiveChatId(chat.id);
      } catch {
        chatId = null; // no IndexedDB → session-only chat
      }
    } else {
      void touchCompanionChat(chatId)
        .then(refreshChats)
        .catch(() => undefined);
    }

    const nextUser: Turn = { role: "user", content: text };
    const history = [...turns, nextUser];
    setTurns([...history, { role: "assistant", content: "" }]);
    if (chatId) {
      void addCompanionMessage(chatId, "user", text).catch(() => undefined);
    }

    const st = revealRef.current;
    st.acc = "";
    st.shown = 0;
    st.done = false;
    st.crisis = false;
    st.token = ++streamTokenRef.current;
    const token = st.token;

    setStreaming(true);
    stickRef.current = true;
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const handlers: AiStreamHandlers = {
        onMeta: (meta) => {
          setOffline(meta.offline);
          st.crisis = meta.crisis;
        },
        onDelta: (chunk) => {
          st.acc += chunk;
          startReveal();
        },
        onDone: (done) => {
          st.crisis = done.crisis;
          setDisclaimer(done.disclaimer);
        },
        onError: (detail) => setError(detail),
      };
      await api.aiSupportStream(
        history
          .slice(-HISTORY_SENT_LIMIT)
          .map((turn) => ({ role: turn.role, content: turn.content })),
        "companion",
        handlers,
        controller.signal,
      );
      st.done = true;
      if (st.acc && chatId) {
        void addCompanionMessage(chatId, "assistant", st.acc, st.crisis).catch(
          () => undefined,
        );
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) {
        setError(err instanceof ApiError ? err.message : t.companion.error);
      }
      // Stopped or mid-stream failure: keep what already arrived.
      st.done = true;
      if (st.acc && chatId) {
        void addCompanionMessage(chatId, "assistant", st.acc, st.crisis).catch(
          () => undefined,
        );
      }
    } finally {
      abortRef.current = null;
      if (!st.active) {
        // Nothing ever streamed (or the reveal loop was killed by a dialog
        // switch): drop the empty placeholder now; the loop handles the rest.
        setStreaming(false);
        if (streamTokenRef.current === token) {
          setTurns((prev) =>
            prev.filter(
              (turn, i) =>
                !(
                  i === prev.length - 1 &&
                  turn.role === "assistant" &&
                  !turn.content
                ),
            ),
          );
        }
      }
    }
  }

  function onStop() {
    abortRef.current?.abort();
    const st = revealRef.current;
    if (st.active) st.shown = st.acc.length; // snap the reveal tail
  }

  function startRename(chat: CompanionChat) {
    setRenamingId(chat.id);
    setRenameDraft(chat.title);
  }

  async function commitRename() {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const title = deriveChatTitle(renameDraft);
    if (!title) return;
    try {
      await renameCompanionChat(id, title);
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    } catch {
      setError(t.companion.error);
    }
  }

  async function onDeleteChat(id: string) {
    const ok = await toast.confirm({
      message: t.companion.deleteConfirm,
      confirmLabel: t.common.confirmDelete,
      cancelLabel: t.common.cancel,
      danger: true,
    });
    if (!ok) return;
    try {
      if (id === activeChatId && streaming) killStream();
      await deleteCompanionChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (id === activeChatId) openChat(null);
    } catch {
      setError(t.companion.error);
    }
  }

  async function onWipe() {
    const ok = await toast.confirm({
      message: t.companion.wipeConfirm,
      confirmLabel: t.common.confirmWipe,
      cancelLabel: t.common.cancel,
      danger: true,
    });
    if (!ok) return;
    try {
      if (streaming) killStream();
      await wipeAllMemory();
      setChats([]);
      setActiveChatId(null);
      setTurns([]);
      setDisclaimer("");
      setError(null);
    } catch {
      setError(t.companion.error);
    }
  }

  return (
    <div className={styles.pane}>
      {listOpen ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label={t.common.close}
          onClick={() => setListOpen(false)}
        />
      ) : null}
      <aside
        className={[styles.side, listOpen ? styles.sideOpen : ""]
          .filter(Boolean)
          .join(" ")}
        aria-label={t.companion.chats}
        inert={!listOpen}
      >
        <div className={styles.sideHead}>
          <h2 className={styles.sideTitle}>{t.companion.chats}</h2>
          <button
            type="button"
            className={styles.sideClose}
            aria-label={t.common.close}
            onClick={() => setListOpen(false)}
          >
            ✕
          </button>
        </div>
        <button
          type="button"
          className={styles.newChat}
          onClick={newChat}
          disabled={streaming}
        >
          + {t.companion.newChat}
        </button>
        <ul className={styles.chatList}>
          {chats.map((chat) => (
            <li
              key={chat.id}
              className={[
                styles.chatItem,
                chat.id === activeChatId ? styles.chatActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {renamingId === chat.id ? (
                <input
                  className={styles.renameInput}
                  value={renameDraft}
                  autoFocus
                  aria-label={t.companion.rename}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRename();
                    }
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.chatOpen}
                    disabled={streaming}
                    onClick={() => openChat(chat.id)}
                  >
                    {chat.title || t.companion.untitled}
                  </button>
                  <span className={styles.chatActions}>
                    <button
                      type="button"
                      className={styles.chatAction}
                      aria-label={t.companion.rename}
                      disabled={streaming}
                      onClick={() => startRename(chat)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className={styles.chatAction}
                      aria-label={t.companion.deleteChat}
                      disabled={streaming}
                      onClick={() => void onDeleteChat(chat.id)}
                    >
                      ✕
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <div className={styles.chatCol}>
        <header className={styles.head}>
          <div className={styles.headRow}>
            <button
              type="button"
              className={styles.listToggle}
              aria-expanded={listOpen}
              aria-label={t.companion.chats}
              onClick={() => setListOpen((o) => !o)}
            >
              ☰
            </button>
            <button
              type="button"
              className={styles.back}
              onClick={() => {
                if (window.history.state?.idx > 0) navigate(-1);
                else navigate("/help");
              }}
            >
              ← {t.common.back}
            </button>
            <h1 className={styles.title}>{t.companion.title}</h1>
            <button
              type="button"
              className={styles.wipe}
              onClick={() => void onWipe()}
            >
              {t.companion.wipe}
            </button>
          </div>
          <p className={styles.banner}>
            {t.companion.bannerPrefix}{" "}
            <strong>{t.companion.bannerAi}</strong>
            {t.companion.bannerSuffix}{" "}
            <button type="button" className={styles.bannerLink} onClick={enter}>
              {t.companion.bannerCrisis}
            </button>
            , 112 / 103.
          </p>
          {offline ? (
            <p className={styles.offline}>{t.companion.offline}</p>
          ) : null}
        </header>

        <div
          className={styles.thread}
          ref={threadRef}
          onScroll={onThreadScroll}
          aria-live="polite"
        >
          {loaded && turns.length === 0 ? (
            <p className={styles.empty}>{t.companion.empty}</p>
          ) : null}
          {turns.map((turn, i) => (
            <div
              key={`${turn.role}-${i}`}
              className={[
                styles.msg,
                turn.role === "user" ? styles.user : styles.assistant,
                turn.crisis ? styles.crisis : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <p className={styles.msgBody}>{turn.content}</p>
              {turn.crisis ? (
                <button
                  type="button"
                  className={styles.crisisBtn}
                  onClick={enter}
                >
                  {t.companion.bannerCrisis}
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className={styles.compose}>
          <label className={styles.label} htmlFor="companion-input">
            {t.companion.label}
          </label>
          <textarea
            id="companion-input"
            className={styles.input}
            rows={3}
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {streaming ? (
            <button type="button" className={styles.send} onClick={onStop}>
              {t.companion.stop}
            </button>
          ) : (
            <button
              type="button"
              className={styles.send}
              disabled={!input.trim()}
              onClick={() => void send()}
            >
              {t.companion.send}
            </button>
          )}
          {disclaimer ? (
            <p className={styles.disclaimer}>{disclaimer}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
