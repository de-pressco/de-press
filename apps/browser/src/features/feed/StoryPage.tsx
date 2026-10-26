import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, API_URL } from "@/core/api/client";
import { friendlyError } from "@/core/api/errorCopy";
import { useVoiceRecorder } from "@/core/hooks/useVoiceRecorder";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";
import type { Story, StoryThread } from "@/core/api/types";
import { VoiceBubble } from "@/features/chat/VoiceBubble";
import { useFeedLive } from "./feedLiveContext";
import { type FeedInfinite } from "./applyFeedEvent";
import { QuietPhrases } from "./QuietPhrases";
import {
  StoryEntryMenu,
  entryHasCopyableText,
  type StoryEntryMenuState,
} from "./StoryEntryMenu";
import { isOfflineTranscript } from "./voicePreview";
import chat from "@/features/chat/DialoguePage.module.css";
import styles from "./StoryPage.module.css";

function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function formatTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDayLabel(
  iso: string | null,
  locale: string,
  labels: { today: string; yesterday: string },
): string {
  if (!iso) return "";
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

function sameDayCluster(a: Story, b: Story | undefined): boolean {
  if (!b) return false;
  return dayKey(a.published_at) === dayKey(b.published_at);
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

export function StoryPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { locale, t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(
    () => params.get("request") === "1",
  );
  const [intent, setIntent] = useState("listen");
  const [note, setNote] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [nextBody, setNextBody] = useState("");
  const [editing, setEditing] = useState<Story | null>(null);
  const [ctxMenu, setCtxMenu] = useState<StoryEntryMenuState | null>(null);
  const live = useFeedLive();
  const livePoll = live.status === "open" ? false : 20_000;
  const seenStory = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const bubbleHold = useRef<{
    id: string;
    x: number;
    y: number;
    timer: number;
  } | null>(null);

  const query = useQuery({
    queryKey: ["story", id],
    queryFn: () => api.getStory(id ?? ""),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    refetchInterval: livePoll,
  });

  useEffect(() => {
    if (params.get("request") === "1") setShowRequest(true);
  }, [params]);

  useEffect(() => {
    seenStory.current = false;
  }, [id]);

  useEffect(() => {
    if (query.data) seenStory.current = true;
  }, [query.data]);

  useEffect(() => {
    if (!seenStory.current || !id) return;
    const gone =
      query.isError ||
      (query.data != null && query.data.status === "removed");
    if (gone) navigate("/feed", { replace: true });
  }, [id, navigate, query.data, query.isError]);

  const intentsQuery = useQuery({
    queryKey: ["dialogue-intents"],
    queryFn: () => api.dialogueIntents(),
    enabled: showRequest,
  });

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
  });

  const threadQuery = useQuery({
    queryKey: ["story-thread", id],
    queryFn: () => api.storyThread(id ?? ""),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    refetchInterval: livePoll,
  });

  const hearersQuery = useQuery({
    queryKey: ["hearers", id],
    queryFn: () => api.storyHearers(id ?? ""),
    enabled: Boolean(id) && meQuery.isSuccess,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const isAuthor = Boolean(query.data?.is_mine) || hearersQuery.isSuccess;
  const markedReadFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthor || !id) return;
    if (markedReadFor.current === id) return;
    markedReadFor.current = id;
    void api
      .markCloudsRead(id)
      .then(() => {
        queryClient.setQueryData<FeedInfinite>(["feed"], (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pages: prev.pages.map((page) => ({
              ...page,
              items: page.items.map((s) =>
                s.id === id ? { ...s, cloud_unread: 0 } : s,
              ),
            })),
          };
        });
        queryClient.setQueryData<Story[]>(["my-stories"], (prev) =>
          prev?.map((s) =>
            s.id === id ? { ...s, cloud_unread: 0 } : s,
          ),
        );
      })
      .catch(() => {
        markedReadFor.current = null;
      });
  }, [isAuthor, id, queryClient]);

  const requestDialogue = useMutation({
    mutationFn: () =>
      api.requestDialogue(
        threadQuery.data?.items?.[0]?.id ?? id ?? "",
        intent,
        note.trim(),
      ),
    onSuccess: () => {
      setStatusMsg(t.dialogue.requestSent);
      setShowRequest(false);
      setNote("");
    },
    onError: (err) => {
      setStatusMsg(friendlyError(err, t.common.errorSoft));
    },
  });

  const outreach = useMutation({
    mutationFn: (payload: {
      mode: "one" | "random";
      hearer_refs?: string[];
    }) =>
      api.authorOutreach(id ?? "", {
        mode: payload.mode,
        hearer_refs: payload.hearer_refs ?? [],
        intent: "listen",
      }),
    onSuccess: (res) => {
      setStatusMsg(res.message);
      const first = res.dialogues[0];
      if (first) navigate(`/chat/${first.id}`);
    },
    onError: (err) => {
      setStatusMsg(friendlyError(err, t.common.errorSoft));
    },
  });

  function rootId(): string {
    return (
      threadQuery.data?.items?.[0]?.id ??
      (query.data?.parent_id ? query.data.parent_id : query.data?.id) ??
      id ??
      ""
    );
  }

  async function refreshStoryQueries() {
    await queryClient.invalidateQueries({ queryKey: ["feed"] });
    await queryClient.invalidateQueries({ queryKey: ["story-thread"] });
    await queryClient.invalidateQueries({ queryKey: ["my-stories"] });
    await queryClient.invalidateQueries({ queryKey: ["story"] });
  }

  const addNext = useMutation({
    mutationFn: (body: string) => api.addComment(rootId(), body),
    onSuccess: async () => {
      setNextBody("");
      await refreshStoryQueries();
    },
    onError: (err) => {
      setStatusMsg(friendlyError(err, t.common.errorSoft));
    },
  });

  const addVoice = useMutation({
    mutationFn: ({ blob, durationMs }: { blob: Blob; durationMs: number }) =>
      api.commentStoryVoice(rootId(), blob, {
        body: nextBody.trim() || undefined,
        durationMs,
        filename: "note.webm",
      }),
    onSuccess: async () => {
      setNextBody("");
      await refreshStoryQueries();
    },
    onError: (err) => {
      setStatusMsg(friendlyError(err, t.common.errorSoft));
    },
  });

  const rec = useVoiceRecorder((blob, durationMs) => {
    addVoice.mutate({ blob, durationMs });
  }, t.chat.unsupported);

  const saveStory = useMutation({
    mutationFn: ({ storyId, body }: { storyId: string; body: string }) =>
      api.editStory(storyId, body),
    onSuccess: async (story) => {
      queryClient.setQueryData(["story", story.id], story);
      if (id) {
        queryClient.setQueryData<Story>(["story", id], (prev) =>
          prev && prev.id === story.id ? story : prev,
        );
      }
      setEditing(null);
      setNextBody("");
      await refreshStoryQueries();
    },
    onError: (err) => {
      setStatusMsg(friendlyError(err, t.common.errorSoft));
    },
  });

  const report = useMutation({
    mutationFn: () => api.reportStory(id ?? "", reportReason, reportDetails.trim()),
    onSuccess: (res) => {
      setStatusMsg(res.message);
      setMenuOpen(false);
      setReportOpen(false);
      setReportReason("");
      setReportDetails("");
    },
    onError: (err) => {
      setStatusMsg(friendlyError(err, t.common.errorSoft));
    },
  });

  const activeId = id ?? "";
  const rawThread = threadQuery.data?.items ?? [];
  const story =
    rawThread.find((s) => s.id === activeId) ??
    (query.data?.id === activeId ? query.data : undefined);
  const thread = rawThread.length > 0 ? rawThread : story ? [story] : [];
  const canSend = nextBody.trim().length > 0;
  const busy =
    addNext.isPending || addVoice.isPending || saveStory.isPending;

  const canWrite = (hearersQuery.data ?? []).filter(
    (h) => h.outreach_opt_in && !h.has_open_dialogue,
  );

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.length, rec.recording]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [nextBody]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (ctxMenu) return;
      setEditing(null);
      setNextBody("");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, ctxMenu]);

  function clearBubbleHold() {
    if (bubbleHold.current) {
      window.clearTimeout(bubbleHold.current.timer);
      bubbleHold.current = null;
    }
  }

  function openCtx(ev: ReactMouseEvent, entry: Story) {
    ev.preventDefault();
    const hasText = entryHasCopyableText(entry);
    if (!hasText && !entry.is_mine) return;
    setCtxMenu({ story: entry, x: ev.clientX, y: ev.clientY });
  }

  function onBubblePointerDown(ev: ReactPointerEvent, entry: Story) {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const hasText = entryHasCopyableText(entry);
    if (!hasText && !entry.is_mine) return;
    const { clientX, clientY } = ev;
    const timer = window.setTimeout(() => {
      bubbleHold.current = null;
      setCtxMenu({ story: entry, x: clientX, y: clientY });
    }, 500);
    bubbleHold.current = { id: entry.id, x: clientX, y: clientY, timer };
  }

  function onBubblePointerMove(ev: ReactPointerEvent) {
    const hold = bubbleHold.current;
    if (!hold) return;
    if (Math.hypot(ev.clientX - hold.x, ev.clientY - hold.y) > 10) {
      clearBubbleHold();
    }
  }

  function copyEntry(s: Story) {
    const text = (s.body || "").trim();
    if (!text || isOfflineTranscript(text)) {
      setCtxMenu(null);
      return;
    }
    void navigator.clipboard?.writeText(text);
    toast.show(t.chat.copied);
    setCtxMenu(null);
  }

  function startEdit(s: Story) {
    setCtxMenu(null);
    setEditing(s);
    setNextBody(s.body || "");
    window.setTimeout(() => taRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditing(null);
    setNextBody("");
  }

  async function deleteEntry(s: Story) {
    setCtxMenu(null);
    const ok = await toast.confirm({
      message: t.feed.deleteConfirm,
      confirmLabel: t.common.confirmDelete,
      cancelLabel: t.common.cancel,
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteStory(s.id);
      if (editing?.id === s.id) cancelEdit();
      queryClient.setQueryData<StoryThread>(["story-thread", id], (prev) => {
        if (!prev) return prev;
        return { ...prev, items: prev.items.filter((x) => x.id !== s.id) };
      });
      await refreshStoryQueries();
      if (!s.parent_id) navigate("/feed", { replace: true });
    } catch (err) {
      setStatusMsg(friendlyError(err, t.common.errorSoft));
    }
  }

  function submitComposer() {
    const text = nextBody.trim();
    if (!text || busy || rec.recording) return;
    if (editing) {
      saveStory.mutate({ storyId: editing.id, body: text });
      return;
    }
    addNext.mutate(text);
  }

  function onComposerKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitComposer();
    }
  }

  return (
    <div className={styles.page}>
      {!story && (query.isLoading || threadQuery.isLoading) ? (
        <p className={styles.empty}>{t.story.loading}</p>
      ) : query.isError || threadQuery.isError ? (
        <p className={styles.empty}>{t.story.offline}</p>
      ) : !story ? (
        <p className={styles.empty}>{t.story.notFound}</p>
      ) : (
        <>
          <header className={chat.chatHeader}>
            <Link to="/feed" className={chat.backLink} aria-label={t.nav.feed}>
              ←
            </Link>
            <span className={chat.headerAvatar} aria-hidden>
              {story.pseudonym.slice(0, 1).toUpperCase()}
            </span>
            <div className={chat.chatMeta}>
              <p className={chat.chatTitle}>{story.pseudonym}</p>
              <p className={chat.chatSub}>{story.topic}</p>
            </div>
          </header>

          <div className={chat.thread} ref={threadRef}>
            {thread.map((entry, i) => {
              const prev = thread[i - 1];
              const next = thread[i + 1];
              const showDay =
                !prev || dayKey(prev.published_at) !== dayKey(entry.published_at);
              const withPrev = sameDayCluster(entry, prev);
              const withNext = sameDayCluster(entry, next);
              const groupClass =
                withPrev && withNext
                  ? chat.groupMid
                  : withPrev && !withNext
                    ? chat.groupLast
                    : !withPrev && withNext
                      ? chat.groupFirst
                      : chat.groupSolo;
              const fromMe = Boolean(isAuthor);
              const time = formatTime(entry.published_at, locale);
              const showMeta = !withNext;
              const visibleBody =
                entry.body && !isOfflineTranscript(entry.body) ? entry.body : null;
              return (
                <div
                  key={entry.id}
                  id={`story-${entry.id}`}
                  className={`${chat.msgBlock} ${withPrev ? chat.msgTight : chat.msgLoose}`}
                  onContextMenu={(e) => openCtx(e, entry)}
                  onPointerDown={(e) => onBubblePointerDown(e, entry)}
                  onPointerMove={onBubblePointerMove}
                  onPointerUp={clearBubbleHold}
                  onPointerLeave={clearBubbleHold}
                  onPointerCancel={clearBubbleHold}
                >
                  {showDay ? (
                    <div className={chat.dateChip}>
                      {formatDayLabel(entry.published_at, locale, {
                        today: t.chat.dayToday,
                        yesterday: t.chat.dayYesterday,
                      })}
                    </div>
                  ) : null}
                  <div
                    className={`${chat.msg} ${fromMe ? chat.me : chat.them} ${groupClass}`}
                  >
                    {entry.audio_url ? (
                      <VoiceBubble
                        src={mediaUrl(entry.audio_url) ?? ""}
                        durationMs={entry.duration_ms}
                        fromMe={fromMe}
                      />
                    ) : null}
                    {visibleBody ? (
                      <div className={chat.msgBody}>{visibleBody}</div>
                    ) : null}
                    {showMeta ? (
                      <div className={chat.msgMeta}>
                        {time ? (
                          <span className={chat.msgTime}>{time}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {isAuthor ? null : (
              <QuietPhrases
                storyId={rootId()}
                sentKey={
                  thread.find((s) => s.my_phrase_key)?.my_phrase_key || ""
                }
                onSent={(key) => {
                  const rid = rootId();
                  queryClient.setQueryData<StoryThread>(
                    ["story-thread", id],
                    (prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        items: prev.items.map((s) =>
                          s.id === rid ? { ...s, my_phrase_key: key } : s,
                        ),
                      };
                    },
                  );
                }}
              />
            )}

            {isAuthor && canWrite.length > 0 ? (
              <section className={styles.requestBox} aria-label={t.hearers.show}>
                <ul className={styles.hearerList}>
                  {canWrite.map((h) => (
                    <li key={h.hearer_ref} className={styles.hearerRow}>
                      <span>{h.pseudonym}</span>
                      <button
                        type="button"
                        className={styles.action}
                        disabled={outreach.isPending}
                        onClick={() =>
                          outreach.mutate({
                            mode: "one",
                            hearer_refs: [h.hearer_ref],
                          })
                        }
                      >
                        {t.hearers.write}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={styles.action}
                  disabled={outreach.isPending}
                  onClick={() => outreach.mutate({ mode: "random" })}
                >
                  {t.hearers.random}
                </button>
              </section>
            ) : null}

            {showRequest ? (
              <div className={styles.requestBox}>
                <p className={styles.requestLead}>{t.dialogue.similarHint}</p>
                <label className={styles.field}>
                  <span className={styles.label}>{t.dialogue.similar}</span>
                  <select
                    className={styles.select}
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                  >
                    {(intentsQuery.data ?? [{ value: "listen", label: "listen" }]).map(
                      (opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t.intents[opt.value] ?? opt.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>{t.dialogue.noteLabel}</span>
                  <textarea
                    className={styles.note}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t.dialogue.notePlaceholder}
                    rows={2}
                  />
                </label>
                <div className={styles.requestActions}>
                  <button
                    type="button"
                    className={`${styles.action} ${styles.actionPrimary}`}
                    disabled={requestDialogue.isPending}
                    onClick={() => requestDialogue.mutate()}
                  >
                    {t.dialogue.sendRequest}
                  </button>
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => setShowRequest(false)}
                  >
                    {t.dialogue.cancel}
                  </button>
                </div>
              </div>
            ) : null}

            {statusMsg || rec.error ? (
              <p className={styles.status} role="status" aria-live="polite">
                {statusMsg || rec.error}
              </p>
            ) : null}
          </div>

          {isAuthor && editing ? (
            <div className={chat.replyBar}>
              <span>{t.chat.menuEdit}</span>
              <button
                type="button"
                className={chat.replyX}
                onClick={cancelEdit}
                aria-label={t.auth.closeMenu}
              >
                ×
              </button>
            </div>
          ) : null}

          {isAuthor ? (
            <div className={chat.composer}>
              <div className={chat.composerInput}>
                <textarea
                  ref={taRef}
                  className={chat.composerTextarea}
                  value={nextBody}
                  onChange={(e) => setNextBody(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                  rows={1}
                  placeholder={t.chat.composerPlaceholder}
                  aria-label={t.chat.composerPlaceholder}
                />
                {!editing && !canSend ? (
                  <button
                    type="button"
                    className={chat.composerBtn}
                    aria-label={rec.recording ? t.chat.stop : t.chat.micAria}
                    disabled={busy}
                    onClick={() => void rec.toggle()}
                  >
                    <MicIcon />
                  </button>
                ) : null}
                {canSend ? (
                  <button
                    type="button"
                    className={`${chat.composerBtn} ${chat.sendBtn}`}
                    onClick={submitComposer}
                    disabled={busy || rec.recording}
                    aria-label={t.chat.sendAria}
                    title={t.chat.send}
                  >
                    <SendIcon />
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <footer className={styles.actions}>
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  setShowRequest((v) => !v);
                  setStatusMsg(null);
                }}
              >
                {t.feed.requestChat}
              </button>
              <div className={styles.menuWrap}>
                <button
                  type="button"
                  className={styles.action}
                  aria-label={t.chat.menuLabel}
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  ⋯
                </button>
                {menuOpen ? (
                  <div className={styles.menu}>
                    <button
                      type="button"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenuOpen(false);
                        setReportOpen(true);
                      }}
                    >
                      {t.report.report}
                    </button>
                  </div>
                ) : null}
              </div>
            </footer>
          )}

          {reportOpen ? (
            <div className={styles.reportPanel} role="group" aria-label={t.report.why}>
              <p className={styles.reportTitle}>{t.report.why}</p>
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
                    className={
                      reportReason === key ? styles.reasonOn : styles.reason
                    }
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
                  className={styles.action}
                  disabled={!reportReason || report.isPending}
                  onClick={() => report.mutate()}
                >
                  {t.report.send}
                </button>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    setReportOpen(false);
                    setReportReason("");
                    setReportDetails("");
                  }}
                >
                  {t.report.cancel}
                </button>
              </div>
            </div>
          ) : null}

          {ctxMenu ? (
            <StoryEntryMenu
              state={ctxMenu}
              onClose={() => setCtxMenu(null)}
              onCopy={copyEntry}
              onEdit={startEdit}
              onDelete={(s) => void deleteEntry(s)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
