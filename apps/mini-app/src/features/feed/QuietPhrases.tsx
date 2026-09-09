import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/core/api/client";
import { friendlyError } from "@/core/api/errorCopy";
import { useI18n } from "@/core/i18n/context";
import { isHandwrittenLocale } from "@/core/i18n";
import { EmotionSticker, isGestureKey, type GestureKey } from "./EmotionSticker";
import styles from "./QuietPhrases.module.css";

interface QuietPhrasesProps {
  storyId: string;
  sentKey?: string;
  onSent?: (key: string) => void;
}

export function QuietPhrases({ storyId, sentKey, onSent }: QuietPhrasesProps) {
  const { locale, t } = useI18n();
  const [sent, setSent] = useState(Boolean(sentKey));
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setSent(Boolean(sentKey));
    setStatus(null);
  }, [storyId, sentKey]);

  const phrasesQuery = useQuery({
    queryKey: ["quiet-phrases", locale],
    queryFn: () =>
      api.quietPhrases(isHandwrittenLocale(locale) ? locale : "en"),
  });

  const already = Boolean(sentKey) || sent;

  const send = useMutation({
    mutationFn: (key: string) => api.sendQuietPhrase(storyId, key),
    onSuccess: (res, key) => {
      setSent(true);
      onSent?.(key);
      setStatus(
        res.created === false ? t.support.alreadySent : res.message || t.support.sentPhrase,
      );
    },
    onError: (err) => {
      const msg = friendlyError(err, t.common.errorSoft);
      setStatus(msg);
      // Duplicate-cloud is the only 400 this call can produce with a valid key;
      // never match on the localized message text.
      if (err instanceof ApiError && err.status === 400) setSent(true);
    },
  });

  const phrases = (phrasesQuery.data ?? []).filter((p): p is typeof p & { key: GestureKey } =>
    isGestureKey(p.key),
  );

  return (
    <section className={styles.wrap} aria-labelledby="quiet-phrases-title">
      <h2 id="quiet-phrases-title" className={styles.title}>
        {t.support.pickOne}
      </h2>
      <p className={styles.lead}>{t.support.lead}</p>

      {phrasesQuery.isLoading ? (
        <p className={styles.hint}>{t.common.loading}</p>
      ) : null}

      <ul className={styles.gestures}>
        {phrases.map((p) => (
          <li key={p.key}>
            <EmotionSticker
              gesture={p.key}
              label={p.text}
              caption={captionFor(p.key, t.support)}
              asButton
              disabled={already || send.isPending}
              sent={already}
              onClick={() => send.mutate(p.key)}
            />
          </li>
        ))}
      </ul>

      {status ? (
        <p className={styles.hint} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function captionFor(
  key: GestureKey,
  support: { gestureHere: string; gestureHear: string; gestureTogether: string },
): string {
  if (key === "i_am_here") return support.gestureHere;
  if (key === "i_hear") return support.gestureHear;
  return support.gestureTogether;
}
