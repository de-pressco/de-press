import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { friendlyError } from "@/core/api/errorCopy";
import type { Dialogue } from "@/core/api/types";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useI18n } from "@/core/i18n/context";
import { ListRow } from "@/components/tg/ListRow";
import { BlockedUsersModal } from "./BlockedUsersModal";
import styles from "./ChatList.module.css";
import { useHelperHeartbeat } from "@/features/helper/useHelperHeartbeat";

const ROW_ESTIMATE = 72;
const VIRTUAL_THRESHOLD = 24;

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ChatList() {
  const { id: activeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const intentLabel = (v: string | null | undefined): string =>
    v ? (t.intents[v] ?? v) : "";
  const { active: panic } = useAntiPanic();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
  });

  const dialoguesQuery = useQuery({
    queryKey: ["dialogues"],
    queryFn: () => api.myDialogues(),
  });

  const requestsQuery = useQuery({
    queryKey: ["dialogue-requests"],
    queryFn: () => api.dialogueInbox(),
  });

  const isHelper = Boolean(meQuery.data?.is_helper);

  const helpQuery = useQuery({
    queryKey: ["help-requests"],
    queryFn: () => api.helpInbox(),
    // D2 (2026-10-27): visible off duty as well.
    enabled: isHelper && !panic,
    refetchInterval: panic ? false : 20_000,
  });

  useHelperHeartbeat(isHelper);

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

  const dialogues = dialoguesQuery.data ?? [];
  const requests = useMemo(
    () =>
      (requestsQuery.data ?? []).filter(
        (r) => r.status === "pending" || r.status === "approved" || !r.status,
      ),
    [requestsQuery.data],
  );
  const helpRequests = useMemo(
    () => (helpQuery.data ?? []).filter((r) => !r.status || r.status === "pending"),
    [helpQuery.data],
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
    (isHelper && helpQuery.isLoading);
  const firstError =
    dialoguesQuery.error ?? requestsQuery.error ?? helpQuery.error;
  const error =
    dialoguesQuery.isError ||
    requestsQuery.isError ||
    (isHelper && helpQuery.isError)
      ? friendlyError(firstError, t.common.errorSoft)
      : null;

  function renderDialogue(
    d: Dialogue,
    style?: React.CSSProperties,
  ) {
    return (
      <ListRow
        key={d.id}
        to={`/chat/${d.id}`}
        title={intentLabel(d.intent)}
        subtitle={
          d.status === "closed" ? t.chat.dialogueClosed : d.source || "…"
        }
        time={timeAgo(d.updated_at)}
        avatarText={intentLabel(d.intent)}
        active={activeId === d.id}
        style={style}
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
              time={timeAgo(r.created_at)}
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
              time={timeAgo(r.created_at)}
              avatarText="?"
            />
            <p className={styles.safety}>{t.shell.safetyBanner}</p>
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
      {blockedOpen ? (
        <BlockedUsersModal onClose={() => setBlockedOpen(false)} />
      ) : null}
    </div>
  );
}
