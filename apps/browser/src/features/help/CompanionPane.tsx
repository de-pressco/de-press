import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type AiStreamHandlers } from "@/core/api/client";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";
import {
  addCompanionMessage,
  listCompanionMessages,
  wipeAllMemory,
} from "@/core/memory/db";
import { takeQueuedCompanionShare } from "@/core/memory/companionShare";
import styles from "./CompanionPane.module.css";

type Turn = { role: "user" | "assistant"; content: string; crisis?: boolean };

/** Server keeps the last ≤12 messages per turn; match it client-side. */
const HISTORY_SENT_LIMIT = 12;

/**
 * Quiet Companion: AI chat via api.aiSupportStream(...) (SSE).
 * Turns are remembered only in IndexedDB on this device (never synced);
 * wiping uses the same wipe as patterns, with its own confirmation.
 * Crisis replies open Anti-Panic.
 */
export function CompanionPane() {
  const { t } = useI18n();
  const { enter } = useAntiPanic();
  const toast = useToast();
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [disclaimer, setDisclaimer] = useState("");

  useEffect(() => {
    // Explicit share from Patterns: prefill the composer, the user still sends.
    const prefill = takeQueuedCompanionShare();
    if (prefill) setInput(prefill);
    let cancelled = false;
    listCompanionMessages()
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
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");

    const nextUser: Turn = { role: "user", content: text };
    const history = [...turns, nextUser];
    setTurns([...history, { role: "assistant", content: "" }]);
    void addCompanionMessage("user", text).catch(() => undefined);

    setStreaming(true);
    let acc = "";
    let crisis = false;
    try {
      const handlers: AiStreamHandlers = {
        onMeta: (meta) => setOffline(meta.offline),
        onDelta: (chunk) => {
          acc += chunk;
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: acc };
            }
            return next;
          });
        },
        onDone: (done) => {
          crisis = done.crisis;
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
      );
      if (acc) {
        void addCompanionMessage("assistant", acc, crisis).catch(
          () => undefined,
        );
        setTurns((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: acc, crisis };
          }
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.companion.error);
    } finally {
      // Drop the placeholder bubble if nothing ever arrived.
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
      setStreaming(false);
    }
  }

  async function onWipe() {
    const ok = await toast.confirm({
      message: t.companion.wipeConfirm,
      confirmLabel: t.chat.confirmYes,
      cancelLabel: t.chat.confirmNo,
      danger: true,
    });
    if (!ok) return;
    try {
      await wipeAllMemory();
      setTurns([]);
      setDisclaimer("");
      setError(null);
    } catch {
      setError(t.companion.error);
    }
  }

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <div className={styles.headRow}>
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
        {offline ? <p className={styles.offline}>{t.companion.offline}</p> : null}
      </header>

      <div className={styles.thread} aria-live="polite">
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
        <button
          type="button"
          className={styles.send}
          disabled={streaming || !input.trim()}
          onClick={() => void send()}
        >
          {streaming ? t.companion.sending : t.companion.send}
        </button>
        {disclaimer ? (
          <p className={styles.disclaimer}>{disclaimer}</p>
        ) : null}
      </div>
    </div>
  );
}
