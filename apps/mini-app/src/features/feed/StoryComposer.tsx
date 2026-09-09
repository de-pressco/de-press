import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/core/api/client";
import { useI18n } from "@/core/i18n/context";
import styles from "./StoryComposer.module.css";

export function StoryComposer() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);

  const topicsQuery = useQuery({
    queryKey: ["topics"],
    queryFn: () => api.topics(),
  });

  const publish = useMutation({
    mutationFn: () =>
      api.publishStory(body.trim(), {
        pseudonym: pseudonym.trim() || undefined,
        topic: topic || undefined,
      }),
    onSuccess: async (story) => {
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
      navigate(`/feed/${story.id}`, { replace: true });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? err.message
          : t.composer.publishError;
      setError(msg);
    },
  });

  const canSubmit = body.trim().length > 0 && !publish.isPending;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t.composer.title}</h1>
      <p className={styles.hint}>
        {t.composer.hint}
      </p>

      <label className={styles.field}>
        <span className={styles.label}>{t.composer.thoughtLabel}</span>
        <textarea
          className={styles.textarea}
          placeholder={t.composer.thoughtPlaceholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={8000}
          disabled={publish.isPending}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>{t.composer.aliasLabel}</span>
        <input
          type="text"
          className={styles.input}
          placeholder={t.composer.aliasPlaceholder}
          value={pseudonym}
          onChange={(e) => setPseudonym(e.target.value)}
          maxLength={64}
          disabled={publish.isPending}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>{t.composer.topicLabel}</span>
        <select
          className={styles.select}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={publish.isPending || topicsQuery.isLoading}
        >
          <option value="">{t.composer.topicNone}</option>
          {(topicsQuery.data ?? []).map((item) => (
            <option key={item.value} value={item.value}>
              {t.topics[item.value] ?? item.label}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className={styles.submit}
        disabled={!canSubmit}
        onClick={() => {
          setError(null);
          publish.mutate();
        }}
      >
        {publish.isPending ? t.composer.publishing : t.composer.publish}
      </button>
    </div>
  );
}
