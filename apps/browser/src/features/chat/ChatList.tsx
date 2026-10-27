import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { friendlyError } from "@/core/api/errorCopy";
import type { Dialogue } from "@/core/api/types";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useI18n } from "@/core/i18n/context";
import { useHelperHeartbeat } from "@/features/helper/useHelperHeartbeat";
import { ListRow } from "@/components/tg/ListRow";
import { BlockedUsersModal } from "./BlockedUsersModal";
import { ChatMenu, type ChatMenuState } from "./ChatMenu";
import { useDialogueActions } from "./useDialogueActions";
import styles from "./ChatList.module.css";

const ROW_ESTIMATE = 72;
const VIRTUAL_THRESHOLD = 24;

function listTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThen = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (startThen === startToday) {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function ChatList() {
  const { id: activeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const { active: panic } = useAntiPanic();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<ChatMenuState | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const actions = useDialogueActions();

  const intentLabel = (v: string | null | undefined): string =>
    v ? (t.intents[v] ?? v) : "";

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
  });

  useHelperHeartbeat(Boolean(meQuery.data?.is_helper));

  const dialoguesQuery = useQuery({
    queryKey: ["dialogues"],
    queryFn: () => api.myDialogues(),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: panic ? false : 20_000,
  });

  const requestsQuery = useQuery({
    queryKey: ["dialogue-requests"],
    queryFn: () => api.dialogueInbox(),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: panic ? false : 20_000,
  });

  const helpQuery = useQuery({
    queryKey: ["help-requests"],
    queryFn: () => api.helpInbox(),
    // D2 (2026-10-27): the shared pool is visible off duty too; duty only
    // gates notifications and instant match.
    enabled: Boolean(meQuery.data?.is_helper) && !panic,
    refetchInterval: panic ? false : 20_000,
  });

  const accept = useMutation({
    mutationFn: (requestId: string) => api.acceptDialogueRequest(requestId),
    onSuccess: async (dialogue) => {
      await queryClient.invalidateQueries({ queryKey: ["dialogues"] });
      await queryClient.invalidateQueries({ queryKey: ["dialogue-requests"] });
      navigate(`/chat/${dialogue.id}`);
    },
  });

  const decline = useMutation({
    mutationFn: (requestId: string) => api.declineDialogueRequest(requestId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dialogue-requests"] });
    },
  });

  const acceptHelp = useMutation({
    mutationFn: (requestId: string) => api.acceptHelpRequest(requestId),
    onSuccess: async (dialogue) => {
      await queryClient.invalidateQueries({ queryKey: ["dialogues"] });
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
      navigate(`/chat/${dialogue.id}`);
    },
  });

  const skipHelp = useMutation({
    mutationFn: (requestId: string) => api.skipHelpRequest(requestId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
    },
  });

  const needle = q.trim().toLowerCase();
  const dialogues = useMemo(() => {
    const all = dialoguesQuery.data ?? [];
    if (!needle) return all;
    return all.filter((d) => {
      const hay = [
        d.peer_label,
        intentLabel(d.intent),
        d.last_preview,
        d.source,
        d.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [dialoguesQuery.data, needle]);
  const requests = useMemo(
    () =>
      (requestsQuery.data ?? []).filter((r) => {
        if (!(r.status === "pending" || r.status === "approved" || !r.status)) {
          return false;
        }
        if (!needle) return true;
        const hay = [intentLabel(r.intent), r.note, r.status].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(needle);
      }),
    [requestsQuery.data, needle],
  );
  const helpRequests = useMemo(
    () =>
      (helpQuery.data ?? []).filter((r) => {
        if (r.status && r.status !== "pending") return false;
        if (!needle) return true;
        return (r.note ?? "").toLowerCase().includes(needle);
      }),
    [helpQuery.data, needle],
  );
  const useVirtual = dialogues.length >= VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: useVirtual ? dialogues.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  const loading =
    dialoguesQuery.isLoading ||
    requestsQuery.isLoading ||
    (Boolean(meQuery.data?.is_helper) && helpQuery.isLoading);
  const firstError =
    dialoguesQuery.error ?? requestsQuery.error ?? helpQuery.error;
  const error =
    dialoguesQuery.isError ||
    requestsQuery.isError ||
    (Boolean(meQuery.data?.is_helper) && helpQuery.isError)
      ? friendlyError(firstError, t.common.errorSoft)
      : null;

  function prefetchDialogue(id: string) {
    void queryClient.prefetchQuery({
      queryKey: ["dialogue-messages", id],
      queryFn: () => api.dialogueMessages(id),
      staleTime: 15_000,
    });
  }

  function openMenu(d: Dialogue, x: number, y: number) {
    setMenu({ dialogue: d, x, y });
  }

  function renderDialogue(
    d: Dialogue,
    style?: React.CSSProperties,
  ) {
    return (
      <ListRow
        key={d.id}
        to={`/chat/${d.id}`}
        title={d.peer_label || intentLabel(d.intent)}
        subtitle={
          d.status === "closed"
            ? t.chat.dialogueClosed
            : d.last_preview || d.source || "…"
        }
        time={listTime(d.updated_at, locale)}
        avatarText={d.peer_label || intentLabel(d.intent)}
        active={activeId === d.id}
        muted={Boolean(d.muted)}
        pinned={Boolean(d.pinned)}
        softCount={d.unread_count}
        style={style}
        moreLabel={t.chat.menuLabel}
        onMouseEnter={() => prefetchDialogue(d.id)}
        onFocus={() => prefetchDialogue(d.id)}
        onMore={(ev) => openMenu(d, ev.clientX, ev.clientY)}
        onContextMenu={(ev) => openMenu(d, ev.clientX, ev.clientY)}
        onLongPress={(pos) => openMenu(d, pos.clientX, pos.clientY)}
      />
    );
  }

  return (
    <div className={styles.list}>
      <div className={styles.searchWrap}>
        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            placeholder={t.shell.searchChat}
            aria-label={t.shell.searchChat}
            className={styles.searchInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={styles.blockedBtn}
          aria-label={t.chat.blockedTitle}
          title={t.chat.blockedTitle}
          onClick={() => setBlockedOpen(true)}
        >
          ⊘
        </button>
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        {loading ? <p className={styles.empty}>{t.me.loading}</p> : null}
        {error ? <p className={styles.empty}>{error}</p> : null}

        {!loading &&
        requests.length === 0 &&
        helpRequests.length === 0 &&
        dialogues.length === 0 ? (
          <p className={styles.empty}>{t.me.dialoguesEmpty}</p>
        ) : null}

        {helpRequests.map((r) => (
          <div key={`help-${r.id}`} className={styles.requestBlock}>
            <ListRow
              asButton
              muted
              title={t.help.requestTitle}
              subtitle={r.note?.trim() ? r.note : "—"}
              time={listTime(r.created_at, locale)}
              avatarText="?"
            />
            <p className={styles.safety}>{t.help.requestPlaque}</p>
            {acceptHelp.isError ? (
              <p className={styles.empty}>
                {friendlyError(acceptHelp.error, t.common.errorSoft)}
              </p>
            ) : null}
            <div className={styles.requestActions}>
              <button
                type="button"
                className={styles.accept}
                disabled={acceptHelp.isPending || skipHelp.isPending}
                onClick={() => acceptHelp.mutate(r.id)}
              >
                {t.help.requestAccept}
              </button>
              <button
                type="button"
                className={styles.skip}
                disabled={acceptHelp.isPending || skipHelp.isPending}
                onClick={() => skipHelp.mutate(r.id)}
              >
                {t.help.requestSkip}
              </button>
            </div>
          </div>
        ))}

        {requests.map((r) => (
          <div key={r.id} className={styles.requestBlock}>
            <ListRow
              asButton
              muted
              title={t.me.inboxTitle}
              subtitle={`${intentLabel(r.intent)}${r.note ? ` · ${r.note}` : ""}`}
              time={listTime(r.created_at, locale)}
              avatarText="?"
            />
            <p className={styles.safety}>{t.shell.safetyBanner}</p>
            {accept.isError ? (
              <p className={styles.empty}>
                {friendlyError(accept.error, t.common.errorSoft)}
              </p>
            ) : null}
            <div className={styles.requestActions}>
              <button
                type="button"
                className={styles.accept}
                disabled={accept.isPending}
                onClick={() => accept.mutate(r.id)}
              >
                {t.me.openDialogue}
              </button>
              <button
                type="button"
                className={styles.decline}
                disabled={decline.isPending}
                onClick={() => decline.mutate(r.id)}
              >
                {t.me.decline}
              </button>
            </div>
          </div>
        ))}

        {useVirtual ? (
          <div
            className={styles.virtualInner}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const d = dialogues[vItem.index]!;
              return renderDialogue(d, {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: vItem.size,
                transform: `translateY(${vItem.start}px)`,
              });
            })}
          </div>
        ) : (
          dialogues.map((d) => renderDialogue(d))
        )}
      </div>
      {menu ? (
        <ChatMenu
          state={menu}
          actions={actions}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {blockedOpen ? (
        <BlockedUsersModal onClose={() => setBlockedOpen(false)} />
      ) : null}
    </div>
  );
}
