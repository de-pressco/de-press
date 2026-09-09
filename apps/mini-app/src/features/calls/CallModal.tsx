import { useEffect, useRef, useState } from "react";
import { useFocusTrap, useInertBackground } from "@/core/hooks/useFocusTrap";
import { useI18n } from "@/core/i18n/context";
import type { CallController } from "./useCall";
import styles from "./CallModal.module.css";

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const END_LABELS = {
  hangup: "ended",
  declined: "declined",
  busy: "busy",
  timeout: "timeout",
  connection: "connection",
  closed: "connection",
  cancelled: "ended",
  error: "micError",
} as const;

/** Overlay for the live 1:1 call (ADR 0021). Idle → renders nothing. */
export function CallModal({ call }: { call: CallController }) {
  const { t } = useI18n();
  const { state, muted } = call;
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(
    overlayRef,
    state.name !== "idle" && state.name !== "ended",
  );
  useInertBackground(
    overlayRef,
    state.name !== "idle" && state.name !== "ended",
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.name !== "active") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state]);

  if (state.name === "idle") return null;

  if (state.name === "ended") {
    const key = END_LABELS[state.reason] ?? "ended";
    return (
      <div className={styles.endedCard} role="status">
        {t.calls[key]}
      </div>
    );
  }

  const inCall = state.name === "active";
  const duration =
    inCall ? fmtDuration(Math.max(0, Math.floor((now - state.startedAt) / 1000))) : null;
  const statusLine =
    state.name === "incoming"
      ? t.calls.incoming
      : state.name === "outgoing"
        ? t.calls.outgoing
        : state.name === "connecting"
          ? t.calls.connecting
          : `${t.calls.active} · ${duration}`;

  return (
    <div ref={overlayRef} className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.card}>
        <span className={styles.avatar} aria-hidden>
          📞
        </span>
        <p className={styles.status}>{statusLine}</p>

        {state.name === "incoming" ? (
          <div className={styles.row}>
            <button
              type="button"
              className={`${styles.btn} ${styles.danger}`}
              onClick={call.decline}
            >
              {t.calls.decline}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.ok}`}
              onClick={() => void call.accept()}
            >
              {t.calls.accept}
            </button>
          </div>
        ) : (
          <div className={styles.row}>
            <button
              type="button"
              className={`${styles.btn} ${styles.neutral}`}
              onClick={call.toggleMute}
              disabled={!inCall}
            >
              {muted ? t.calls.unmute : t.calls.mute}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.danger}`}
              onClick={state.name === "outgoing" ? call.cancel : call.hangup}
            >
              {state.name === "outgoing" ? t.calls.cancel : t.calls.hangup}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
