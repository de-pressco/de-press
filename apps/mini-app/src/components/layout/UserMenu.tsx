import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/core/api/client";
import type { NotificationKind, VoiceRetention } from "@/core/api/types";
import { useHost } from "@/core/host/HostContext";
import { useI18n } from "@/core/i18n/context";
import { UI_LANGS, langLabel } from "@/core/i18n/uiLangs";
import { readVoiceRetention, writeVoiceRetention } from "@/core/mediaPrefs";
import { useFocusTrap, useInertBackground } from "@/core/hooks/useFocusTrap";
import { FundCard } from "@/features/fund/FundCard";
import { TipWalletForm } from "@/features/fund/TipWalletForm";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./UserMenu.module.css";

// Helper-only kinds: hidden for everyone else (the backend gates them too).
const HELPER_KINDS: ReadonlySet<NotificationKind> = new Set([
  "help_requested",
  "dialogue_request_review",
  "report_new",
]);

const KIND_LIST: NotificationKind[] = [
  "message",
  "dialogue_request",
  "dialogue_opened",
  "outreach_intro",
  "dialogue_deleted",
  "support_cloud",
  "cloud_approved",
  "silent_empathy",
  "report_resolved",
  "help_requested",
  "dialogue_request_review",
  "report_new",
];

interface UserMenuProps {
  open: boolean;
  onClose: () => void;
}

type Mode = "menu" | "login" | "register" | "langs";

export function UserMenu({ open, onClose }: UserMenuProps) {
  const { t, locale, setLocale, loading: localeLoading, catalogUnavailable } = useI18n();
  const { isTelegram, telegramAuthError } = useHost();
  const queryClient = useQueryClient();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  useFocusTrap(panelRef, open);
  useInertBackground(panelRef, open);

  const [mode, setMode] = useState<Mode>("menu");
  const [langQ, setLangQ] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [voiceRetention, setVoiceRetention] = useState<VoiceRetention>(() =>
    readVoiceRetention(),
  );

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    enabled: open,
  });

  const notifyQuery = useQuery({
    queryKey: ["notify-settings"],
    queryFn: () => api.notifySettings(),
    enabled: open,
  });

  const me = meQuery.data;
  const isAccount = Boolean(me?.is_authenticated && me.kind === "account");
  const isHelper = Boolean(me?.is_helper);
  const notifySettings = notifyQuery.data;
  const hasTelegram = Boolean(notifySettings?.has_telegram);

  useEffect(() => {
    if (!open) {
      setMode("menu");
      setError(null);
      setPassword("");
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const tmr = window.setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(tmr);
    };
  }, [open, onClose, mode]);

  useEffect(() => {
    if (!open) return;
    const onClick = (ev: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(ev.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  const login = useMutation({
    mutationFn: () => api.login(email.trim(), password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setPassword("");
      setMode("menu");
      setError(null);
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : t.auth.loginErrorFallback,
      );
    },
  });

  const register = useMutation({
    mutationFn: () =>
      api.register(email.trim(), password, pseudonym.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setPassword("");
      setMode("menu");
      setError(null);
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : t.auth.registerErrorFallback,
      );
    },
  });

  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t.common.error);
    },
  });

  const duty = useMutation({
    mutationFn: (next: boolean) => api.setHelperDuty(next),
    onSuccess: async (nextMe) => {
      queryClient.setQueryData(["me"], nextMe);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t.common.error);
    },
  });

  const saveTelegramNotify = useMutation({
    mutationFn: (payload: {
      optIn: boolean;
      frequency?: "immediate" | "daily" | "off";
    }) =>
      api.updateNotifySettings({
        notify_telegram_opt_in: payload.optIn,
        notify_email_opt_in: notifySettings?.notify_email_opt_in ?? false,
        notify_digest_frequency: payload.optIn
          ? (payload.frequency ??
            (notifySettings?.notify_digest_frequency === "off"
              ? "daily"
              : (notifySettings?.notify_digest_frequency ?? "daily")))
          : (notifySettings?.notify_digest_frequency ?? "off"),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notify-settings"] });
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t.common.error);
    },
  });

  const testTelegramDigest = useMutation({
    mutationFn: () => api.testTelegramDigest(),
    onSuccess: (res) => {
      setError(null);
      // reuse error line for soft status is awkward; show as error style only on fail
      if (!res.ok) setError(res.message);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t.common.error);
    },
  });

  const saveKind = useMutation({
    mutationFn: (args: { kind: NotificationKind; enabled: boolean }) =>
      api.updateNotifySettings({
        notify_kinds: { [args.kind]: args.enabled },
        // The endpoint resets omitted channel fields to their defaults —
        // pass the loaded values through (same pattern as saveTelegramNotify).
        notify_email_opt_in: notifySettings?.notify_email_opt_in ?? false,
        notify_digest_frequency:
          notifySettings?.notify_digest_frequency ?? "off",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notify-settings"] });
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t.common.error);
    },
  });

  if (!open) return null;

  const busy =
    login.isPending ||
    register.isPending ||
    logout.isPending ||
    duty.isPending ||
    saveTelegramNotify.isPending ||
    saveKind.isPending ||
    testTelegramDigest.isPending;

  const tgFreq =
    notifySettings?.notify_digest_frequency === "immediate"
      ? "immediate"
      : "daily";

  return (
    <div className={styles.backdrop} role="presentation">
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {mode === "login"
              ? t.auth.loginTitle
              : mode === "register"
                ? t.auth.registerTitle
                : mode === "langs"
                  ? t.locale.label
                  : t.nav.account}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t.auth.closeMenu}
          >
            ×
          </button>
        </header>

        {mode === "langs" ? (
          <div className={styles.body}>
            <input
              type="search"
              className={styles.langSearch}
              value={langQ}
              onChange={(e) => setLangQ(e.target.value)}
              placeholder={t.locale.search}
              aria-label={t.locale.search}
            />
            <ul className={styles.langList}>
              {UI_LANGS.filter((code) => {
                const q = langQ.trim().toLowerCase();
                if (!q) return true;
                const label = langLabel(code, locale).toLowerCase();
                return code.includes(q) || label.includes(q);
              }).map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    className={
                      locale === code ? styles.langActive : styles.langItem
                    }
                    onClick={() => {
                      setLocale(code);
                      setMode("menu");
                      setLangQ("");
                    }}
                  >
                    {langLabel(code, locale)}
                    <span className={styles.langCode}>{code}</span>
                  </button>
                </li>
              ))}
            </ul>
            {catalogUnavailable && !localeLoading ? (
              <p className={styles.langNote}>{t.locale.unavailable}</p>
            ) : null}
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => {
                setMode("menu");
                setLangQ("");
              }}
            >
              {t.dialogue.cancel}
            </button>
          </div>
        ) : mode === "menu" ? (
          <div className={styles.body}>
            <div className={styles.profile}>
              <span className={styles.avatar} aria-hidden>
                {(me?.pseudonym || "·").slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{me?.pseudonym || "…"}</strong>
                <p className={styles.meta}>
                  {isTelegram
                    ? t.auth.telegramHostLabel
                    : isAccount
                      ? me?.email?.endsWith("@users.de-press.local")
                        ? t.auth.accountLabel
                        : me?.email || t.auth.accountLabel
                      : t.auth.anonymousLabel}
                </p>
                {telegramAuthError ? (
                  <p className={styles.meta} role="status">
                    TG auth: {telegramAuthError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className={styles.themeBlock}>
              <ThemeSwitch />
            </div>

            <div className={styles.localeRow} role="group" aria-label={t.locale.label}>
              <button
                type="button"
                className={
                  locale === "ru" ? styles.localeActive : styles.localeBtn
                }
                onClick={() => setLocale("ru")}
              >
                {t.locale.ru}
              </button>
              <button
                type="button"
                className={
                  locale === "en" ? styles.localeActive : styles.localeBtn
                }
                onClick={() => setLocale("en")}
              >
                {t.locale.en}
              </button>
              <button
                type="button"
                className={styles.localeBtn}
                onClick={() => {
                  setLangQ("");
                  setMode("langs");
                }}
              >
                {langLabel(locale, locale)}
                {localeLoading ? ` · ${t.common.loading}` : ""}
              </button>
            </div>

            <fieldset className={styles.voiceField}>
              <legend>{t.chat.voiceRetention}</legend>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="voice-retention"
                  checked={voiceRetention === "delete_on_close"}
                  onChange={() => {
                    setVoiceRetention("delete_on_close");
                    writeVoiceRetention("delete_on_close");
                  }}
                />
                <span>{t.chat.voiceRetentionDelete}</span>
              </label>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="voice-retention"
                  checked={voiceRetention === "keep"}
                  onChange={() => {
                    setVoiceRetention("keep");
                    writeVoiceRetention("keep");
                  }}
                />
                <span>{t.chat.voiceRetentionKeep}</span>
              </label>
            </fieldset>

            {hasTelegram ? (
              <fieldset className={styles.voiceField}>
                <legend>{t.notify.telegramOptIn}</legend>
                <label className={styles.radio}>
                  <input
                    type="checkbox"
                    checked={Boolean(notifySettings?.notify_telegram_opt_in)}
                    disabled={busy || notifyQuery.isLoading}
                    onChange={(e) => {
                      saveTelegramNotify.mutate({ optIn: e.target.checked });
                    }}
                  />
                  <span>{t.notify.telegramOptIn}</span>
                </label>
                {notifySettings?.notify_telegram_opt_in ? (
                  <>
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        name="tg-freq"
                        checked={tgFreq === "immediate"}
                        disabled={busy}
                        onChange={() =>
                          saveTelegramNotify.mutate({
                            optIn: true,
                            frequency: "immediate",
                          })
                        }
                      />
                      <span>{t.notify.telegramFreqImmediate}</span>
                    </label>
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        name="tg-freq"
                        checked={tgFreq === "daily"}
                        disabled={busy}
                        onChange={() =>
                          saveTelegramNotify.mutate({
                            optIn: true,
                            frequency: "daily",
                          })
                        }
                      />
                      <span>{t.notify.telegramFreqDaily}</span>
                    </label>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      disabled={busy}
                      onClick={() => testTelegramDigest.mutate()}
                    >
                      {t.notify.telegramTest}
                    </button>
                  </>
                ) : null}
                <p className={styles.hint}>{t.notify.telegramHint}</p>
              </fieldset>
            ) : null}

            <fieldset className={styles.voiceField}>
              <legend>{t.notify.kindsTitle}</legend>
              {KIND_LIST.filter(
                (kind) => isHelper || !HELPER_KINDS.has(kind),
              ).map((kind) => (
                <label key={kind} className={styles.radio}>
                  <input
                    type="checkbox"
                    checked={notifySettings?.notify_kinds?.[kind] ?? true}
                    disabled={busy || notifyQuery.isLoading}
                    onChange={(e) => {
                      saveKind.mutate({ kind, enabled: e.target.checked });
                    }}
                  />
                  <span>{t.notifications.kind[kind] ?? kind}</span>
                </label>
              ))}
              <p className={styles.hint}>{t.notify.kindsHint}</p>
            </fieldset>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            {isAccount && me?.is_helper ? (
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={busy}
                aria-pressed={Boolean(me.is_on_duty)}
                onClick={() => duty.mutate(!me.is_on_duty)}
              >
                {me.is_on_duty ? t.helper.dutyToggleOff : t.helper.dutyToggleOn}
              </button>
            ) : null}

            {isAccount && me?.is_helper ? (
              <Link
                to="/helper/invite"
                className={styles.ghostBtn}
                onClick={() => onClose()}
              >
                {t.helper.inviteTitle}
              </Link>
            ) : null}

            <FundCard />
            {isAccount && me?.is_helper ? (
              <TipWalletForm
                current={me.tip_wallet_address ?? ""}
                verified={me.tip_wallet_verified ?? false}
              />
            ) : null}

            {isAccount ? (
              <button
                type="button"
                className={styles.dangerBtn}
                disabled={busy}
                onClick={() => logout.mutate()}
              >
                {t.auth.logout}
              </button>
            ) : (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  {t.auth.submitLogin}
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                >
                  {t.auth.submitRegister}
                </button>
                <p className={styles.hint}>{t.auth.registerOptional}</p>
              </div>
            )}
          </div>
        ) : (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "login") login.mutate();
              else register.mutate();
            }}
          >
            <label className={styles.field}>
              <span>{t.auth.email}</span>
              <input
                ref={firstFieldRef}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className={styles.field}>
              <span>
                {mode === "register" ? t.auth.passwordMin : t.auth.password}
              </span>
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "register" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            {mode === "register" ? (
              <label className={styles.field}>
                <span>{t.auth.pseudonym}</span>
                <input
                  type="text"
                  autoComplete="nickname"
                  placeholder={t.auth.pseudonymPlaceholder}
                  value={pseudonym}
                  onChange={(e) => setPseudonym(e.target.value)}
                  maxLength={64}
                  disabled={busy}
                />
              </label>
            ) : null}

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <button type="submit" className={styles.primaryBtn} disabled={busy}>
              {mode === "login" ? t.auth.submitLogin : t.auth.submitRegister}
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={busy}
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
            >
              {mode === "login" ? t.auth.toRegister : t.auth.toLogin}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
