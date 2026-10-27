import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api, ApiError } from "@/core/api/client";
import { useFocusTrap, useInertBackground } from "@/core/hooks/useFocusTrap";
import type { TherapySession } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import styles from "./TherapyPane.module.css";

type T = ReturnType<typeof useI18n>["t"];

const STATUS_KEY: Record<
  TherapySession["status"],
  keyof T["therapy"]
> = {
  awaiting_payment: "statusAwaiting",
  payment_claimed: "statusClaimed",
  paid: "statusPaid",
  declined: "statusDeclined",
  done: "statusDone",
};

function solanaPayUri(address: string, rate: number): string {
  return `solana:${address}?amount=${rate}&label=de-press-therapy`;
}

/** Solana Pay modal: QR + deep link + manual «Я оплатил» (ADR 0022). */
function PayModal({
  session,
  onClose,
}: {
  session: TherapySession;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claimed = session.status === "payment_claimed";
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(cardRef, true);
  useInertBackground(cardRef, true);

  // Generate once per session address (was started from the render body).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = await QRCode.toDataURL(
          solanaPayUri(session.solana_address, session.price_sol),
          { margin: 1, width: 220 },
        );
        if (!cancelled) setQr(url);
      } catch {
        if (!cancelled) setQr(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.solana_address, session.price_sol]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const markPaid = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.therapyIPaid(session.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.therapy.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={styles.card} ref={cardRef}>
        <h2 className={styles.cardTitle} id={titleId}>
          {t.therapy.payTitle}
        </h2>
        <p className={styles.muted}>{t.therapy.payText}</p>
        {claimed ? (
          <p className={styles.claimed}>{t.therapy.awaitingConfirm}</p>
        ) : (
          <>
            {qr ? (
              <img src={qr} alt="Solana Pay QR" className={styles.qr} />
            ) : (
              <div className={styles.qrFallback} aria-hidden />
            )}
            <code className={styles.addr}>{session.solana_address}</code>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                void navigator.clipboard.writeText(session.solana_address);
                setCopied(true);
              }}
            >
              {copied ? t.therapy.copied : t.therapy.copy}
            </button>
            <a
              className={styles.btn}
              href={solanaPayUri(session.solana_address, session.price_sol)}
            >
              {t.therapy.openWallet}
            </a>
            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              disabled={busy}
              onClick={() => void markPaid()}
            >
              {t.therapy.iPaid}
            </button>
          </>
        )}
        {error ? <p className={styles.error}>{error}</p> : null}
        <button type="button" className={styles.linkish} onClick={onClose}>
          {t.therapy.close}
        </button>
      </div>
    </div>
  );
}

export function TherapyPane() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    staleTime: 60_000,
  });
  const me = meQuery.data;
  const profiles = useQuery({
    queryKey: ["therapy-profiles"],
    queryFn: () => api.therapistProfiles(),
  });
  const mine = useQuery({
    queryKey: ["therapy-mine"],
    queryFn: () => api.therapyMySessions(),
  });
  const inbox = useQuery({
    queryKey: ["therapy-inbox"],
    queryFn: () => api.therapyInbox(),
    enabled: Boolean(me?.is_therapist),
  });

  const [payFor, setPayFor] = useState<TherapySession | null>(null);
  const [claimToken, setClaimToken] = useState("");
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["therapy-mine"] });
    void qc.invalidateQueries({ queryKey: ["therapy-inbox"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
  };

  const requestSession = async (therapistId: string) => {
    setError(null);
    try {
      await api.therapyCreateSession(therapistId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.therapy.error);
    }
  };

  const claim = async () => {
    setError(null);
    setClaimMsg(null);
    try {
      await api.therapyClaim(claimToken.trim());
      setClaimMsg(t.therapy.claimed);
      setClaimToken("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.therapy.error);
    }
  };

  const act = async (
    id: string,
    action: "confirm" | "decline" | "complete",
  ) => {
    setError(null);
    try {
      if (action === "confirm") await api.therapyConfirm(id);
      else if (action === "decline") await api.therapyDecline(id);
      else await api.therapyComplete(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.therapy.error);
    }
  };

  const sessionRow = (s: TherapySession, asTherapist: boolean) => (
    <div key={s.id} className={styles.session}>
      <p className={styles.sessionTitle}>
        {asTherapist ? `${t.therapy.client}: ${s.client_label}` : s.therapist_label}
        {" · "}
        {s.price_sol} SOL
      </p>
      <p className={styles.status}>{t.therapy[STATUS_KEY[s.status]]}</p>
      <div className={styles.row}>
        {!asTherapist &&
        (s.status === "awaiting_payment" || s.status === "payment_claimed") ? (
          <button type="button" className={styles.btn} onClick={() => setPayFor(s)}>
            {t.therapy.payTitle}
          </button>
        ) : null}
        {s.dialogue_id && (s.status === "paid" || s.status === "done") ? (
          <Link className={styles.btn} to={`/chat/${s.dialogue_id}`}>
            {t.therapy.openDialogue}
          </Link>
        ) : null}
        {asTherapist && s.status === "payment_claimed" ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={() => void act(s.id, "confirm")}
          >
            {t.therapy.confirmPayment}
          </button>
        ) : null}
        {asTherapist &&
        (s.status === "awaiting_payment" || s.status === "payment_claimed") ? (
          <button
            type="button"
            className={styles.btn}
            onClick={() => void act(s.id, "decline")}
          >
            {t.therapy.decline}
          </button>
        ) : null}
        {asTherapist && s.status === "paid" ? (
          <button
            type="button"
            className={styles.btn}
            onClick={() => void act(s.id, "complete")}
          >
            {t.therapy.complete}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t.therapy.title}</h1>
      </header>
      <p className={styles.lead}>{t.therapy.lead}</p>
      {error ? <p className={styles.error}>{error}</p> : null}

      {me?.is_authenticated ? (
        <section className={styles.section}>
          <h2 className={styles.sub}>{t.therapy.mySessions}</h2>
          {(mine.data ?? []).length === 0 ? (
            <p className={styles.muted}>{t.therapy.empty}</p>
          ) : (
            (mine.data ?? []).map((s) => sessionRow(s, false))
          )}
        </section>
      ) : null}

      {me?.is_therapist ? (
        <section className={styles.section}>
          <h2 className={styles.sub}>{t.therapy.therapistCabinet}</h2>
          {(inbox.data ?? []).length === 0 ? (
            <p className={styles.muted}>{t.therapy.empty}</p>
          ) : (
            (inbox.data ?? []).map((s) => sessionRow(s, true))
          )}
        </section>
      ) : null}

      {me?.is_authenticated && !me.is_therapist ? (
        <section className={styles.section}>
          <h2 className={styles.sub}>{t.therapy.claimTitle}</h2>
          <p className={styles.muted}>{t.therapy.claimText}</p>
          <div className={styles.row}>
            <input
              className={styles.input}
              value={claimToken}
              placeholder={t.therapy.claimPlaceholder}
              onChange={(e) => setClaimToken(e.target.value)}
            />
            <button type="button" className={styles.btn} onClick={() => void claim()}>
              {t.therapy.claim}
            </button>
          </div>
          {claimMsg ? <p className={styles.claimed}>{claimMsg}</p> : null}
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sub}>{t.therapy.catalog}</h2>
        {(profiles.data ?? []).length === 0 ? (
          <p className={styles.muted}>{t.therapy.empty}</p>
        ) : (
          (profiles.data ?? []).map((p) => (
            <div key={p.id} className={styles.session}>
              <p className={styles.sessionTitle}>{p.pseudonym}</p>
              {p.approach ? <p className={styles.muted}>{p.approach}</p> : null}
              <p className={styles.muted}>
                {t.therapy.languages}: {p.languages} · {p.rate_sol} SOL
              </p>
              {me?.is_authenticated ? (
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => void requestSession(p.id)}
                >
                  {t.therapy.request}
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>

      {payFor ? (
        <PayModal
          session={payFor}
          onClose={() => {
            setPayFor(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
