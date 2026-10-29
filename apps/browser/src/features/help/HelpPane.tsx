import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { useI18n } from "@/core/i18n/context";
import styles from "./HelpPane.module.css";

const HELP_REQUEST_ID_KEY = "depress_help_request_id";

function goBackOr(
  navigate: ReturnType<typeof useNavigate>,
  fallback: string,
): void {
  if (window.history.state?.idx > 0) navigate(-1);
  else navigate(fallback);
}

/**
 * Help gate: on desktop the page splits into three halves — AI (link to the
 * full-width /help/ai), human (one click creates a HelpRequest and leads to
 * /help/wait, where an on-duty Helper can pick it up) and therapy (link to
 * /therapy, rightmost). On phone/tablet the halves stack (≈ the previous
 * card layout) and the optional note stays.
 */
export function HelpPane() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const createRequest = useMutation({
    mutationFn: (text: string) => api.createHelpRequest(text),
    onSuccess: (req) => {
      sessionStorage.setItem(HELP_REQUEST_ID_KEY, req.id);
      queryClient.setQueryData(["help-mine"], req);
      navigate("/help/wait");
    },
    onError: () => {
      // Backend is idempotent for pending; still leave the wait surface.
      navigate("/help/wait");
    },
  });

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <button
          type="button"
          className={styles.back}
          onClick={() => goBackOr(navigate, "/feed")}
        >
          ← {t.common.back}
        </button>
        <h1 className={styles.title}>{t.help.title}</h1>
        <p className={styles.intro}>{t.help.intro}</p>
      </header>

      <section className={styles.gate} aria-label={t.help.title}>
        <Link to="/help/ai" className={`${styles.half} ${styles.halfAi}`}>
          <span className={styles.tag}>{t.help.aiTag}</span>
          <h2 className={styles.halfTitle}>{t.help.aiTitle}</h2>
          <p className={styles.halfLead}>{t.help.aiLead}</p>
          <span className={styles.halfCta}>{t.help.aiCta}</span>
        </Link>

        <article className={`${styles.half} ${styles.halfHuman}`}>
          <span className={styles.tag}>{t.help.humanTag}</span>
          <h2 className={styles.halfTitle}>{t.help.humanTitle}</h2>
          <p className={styles.halfLead}>{t.help.humanLead}</p>
          <button
            type="button"
            className={styles.halfCta}
            disabled={createRequest.isPending}
            onClick={() => createRequest.mutate(note.trim())}
          >
            {t.help.humanCta}
          </button>
          <label className={styles.noteLabel} htmlFor="help-human-note">
            {t.help.humanNoteLabel}
          </label>
          <textarea
            id="help-human-note"
            className={styles.note}
            rows={3}
            value={note}
            placeholder={t.help.humanNotePlaceholder}
            disabled={createRequest.isPending}
            onChange={(e) => setNote(e.target.value)}
          />
        </article>

        <Link to="/therapy" className={`${styles.half} ${styles.halfTherapy}`}>
          <span className={styles.tag}>{t.help.therapyTag}</span>
          <h2 className={styles.halfTitle}>{t.help.therapyTitle}</h2>
          <p className={styles.halfLead}>{t.help.therapyLead}</p>
          <span className={styles.halfCta}>{t.help.therapyCta}</span>
        </Link>
      </section>
    </div>
  );
}
