import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/core/api/client";
import { useI18n } from "@/core/i18n/context";
import styles from "./HelperJoin.module.css";

export function HelperInviteCreate() {
  const { t } = useI18n();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const [org, setOrg] = useState("");
  const [ttl, setTtl] = useState(168);
  const [link, setLink] = useState("");
  const allowed = Boolean(meQuery.data?.is_helper);

  const create = useMutation({
    mutationFn: () => api.createHelperInvite(org.trim(), ttl),
    onSuccess: (inv) => {
      const url = `${window.location.origin}/helper/join?token=${encodeURIComponent(inv.token)}`;
      setLink(url);
    },
  });

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t.helper.inviteTitle}</h1>
        <p className={styles.intro}>{t.helper.inviteLead}</p>
      </header>
      {!allowed ? (
        <p className={styles.body}>{t.helper.inviteNeedRole}</p>
      ) : (
        <form
          className={styles.card}
          onSubmit={(ev) => {
            ev.preventDefault();
            create.mutate();
          }}
        >
          <label className={styles.label}>
            {t.helper.inviteOrg}
            <input
              className={styles.input}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
            />
          </label>
          <label className={styles.label}>
            {'TTL'}
            <select
              className={styles.input}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
            >
              <option value={24}>24 h</option>
              <option value={168}>7 d</option>
              <option value={720}>30 d</option>
            </select>
          </label>
          <button
            type="submit"
            className={styles.primary}
            disabled={create.isPending}
          >
            {t.helper.inviteCreate}
          </button>
          {create.isError ? (
            <p className={styles.error}>
              {create.error instanceof ApiError
                ? create.error.message
                : t.common.error}
            </p>
          ) : null}
          {link ? (
            <p className={styles.body}>
              {t.helper.inviteCopy}: {link}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

export function HelperJoin() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const token = (params.get("token") || "").trim();
  const [pledge, setPledge] = useState(false);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const preview = useQuery({
    queryKey: ["helper-invite", token],
    queryFn: () => api.getHelperInvite(token),
    enabled: Boolean(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.acceptHelperInvite(token, true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const isAccount = Boolean(
    meQuery.data?.is_authenticated && meQuery.data.kind === "account",
  );

  const status = useMemo(() => {
    if (!token) return "missing" as const;
    if (preview.isError) return "bad" as const;
    if (accept.isSuccess) return "done" as const;
    return "form" as const;
  }, [token, preview.isError, accept.isSuccess]);

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t.helper.joinTitle}</h1>
        <p className={styles.intro}>{t.helper.joinLead}</p>
      </header>
      {status === "missing" ? (
        <p className={styles.body}>{t.helper.joinMissingToken}</p>
      ) : null}
      {status === "bad" ? (
        <p className={styles.error}>
          {preview.error instanceof ApiError
            ? preview.error.message
            : t.common.error}
        </p>
      ) : null}
      {status === "done" ? (
        <p className={styles.body}>
          {t.helper.joinDone}{" "}
          <Link to="/helper">{t.nav.helper}</Link>
        </p>
      ) : null}
      {status === "form" ? (
        <div className={styles.card}>
          {preview.data?.org ? (
            <p className={styles.body}>{preview.data.org}</p>
          ) : null}
          {!isAccount ? (
            <p className={styles.body}>{t.helper.joinNeedAccount}</p>
          ) : (
            <>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={pledge}
                  onChange={(e) => setPledge(e.target.checked)}
                />
                {t.helper.joinPledge}
              </label>
              <button
                type="button"
                className={styles.primary}
                disabled={!pledge || accept.isPending}
                onClick={() => accept.mutate()}
              >
                {t.helper.joinAccept}
              </button>
              {accept.isError ? (
                <p className={styles.error}>
                  {accept.error instanceof ApiError
                    ? accept.error.message
                    : t.common.error}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
