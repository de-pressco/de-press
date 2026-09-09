import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useMatch, useParams } from "react-router-dom";
import { api } from "@/core/api/client";
import type { Story } from "@/core/api/types";
import { useAntiPanic } from "@/core/hooks/useAntiPanic";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";
import { ListRow } from "@/components/tg/ListRow";
import { flattenFeed, type FeedInfinite } from "./applyFeedEvent";
import { isGestureKey } from "./EmotionSticker";
import { FeedCloudPresence } from "./FeedCloudPresence";
import { useFeedLive } from "./feedLiveContext";
import { FeedMenu, type FeedMenuState } from "./FeedMenu";
import { feedVoiceSubtitle } from "./voicePreview";
import styles from "./FeedList.module.css";

const ROW_ESTIMATE = 72;
const VIRTUAL_THRESHOLD = 24;

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function FeedList() {
  const { id: activeId } = useParams<{ id?: string }>();
  const { t } = useI18n();
  const { active: panic } = useAntiPanic();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<FeedMenuState | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();
  const presenceStarted = useRef(new Map<string, number>());
  const presenceGone = useRef(new Set<string>());
  const mine = Boolean(useMatch("/feed/mine"));
  const live = useFeedLive();

  const query = useInfiniteQuery({
    queryKey: ["feed"],
    queryFn: ({ pageParam }) => api.feed(pageParam ?? null, null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: panic || live.status === "open" ? false : 20_000,
  });

  const mineQuery = useQuery({
    queryKey: ["my-stories"],
    queryFn: () => api.myStories(),
    enabled: mine,
  });

  const stories = useMemo(() => {
    const all: Story[] = mine
      ? (mineQuery.data ?? []).map((s) => ({ ...s, is_mine: true }))
      : flattenFeed(query.data as FeedInfinite | undefined);
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (s) =>
        s.body.toLowerCase().includes(needle) ||
        s.pseudonym.toLowerCase().includes(needle) ||
        s.topic.toLowerCase().includes(needle),
    );
  }, [query.data, mineQuery.data, mine, q]);

  const anchorRef = useRef<{ id: string; offset: number; nearTop: boolean } | null>(
    null,
  );

  function captureAnchor() {
    const root = scrollRef.current;
    if (!root) return;
    const nearTop = root.scrollTop < 48;
    const rows = root.querySelectorAll<HTMLElement>("[data-story-id]");
    let id = "";
    let offset = 0;
    for (const el of rows) {
      const start = el.dataset.rowStart
        ? Number(el.dataset.rowStart)
        : el.offsetTop;
      if (start + el.offsetHeight > root.scrollTop) {
        id = el.dataset.storyId || "";
        offset = start - root.scrollTop;
        break;
      }
    }
    anchorRef.current = { id, offset, nearTop };
  }

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const a = anchorRef.current;
    if (!root || !a) {
      captureAnchor();
      return;
    }
    if (a.nearTop) {
      root.scrollTop = 0;
      captureAnchor();
      return;
    }
    if (!a.id) {
      captureAnchor();
      return;
    }
    const el = root.querySelector<HTMLElement>(
      `[data-story-id="${CSS.escape(a.id)}"]`,
    );
    if (el) {
      const start = el.dataset.rowStart
        ? Number(el.dataset.rowStart)
        : el.offsetTop;
      root.scrollTop = start - a.offset;
    }
    captureAnchor();
  }, [stories]);

  const useVirtual = stories.length >= VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: useVirtual ? stories.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { root, rootMargin: "120px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage, stories.length]);

  function prefetchStory(id: string) {
    void queryClient.prefetchQuery({
      queryKey: ["story", id],
      queryFn: () => api.getStory(id),
      staleTime: 30_000,
    });
  }

  function openMenu(story: Story, x: number, y: number) {
    setMenu({ story, x, y });
  }

  async function onHide(s: Story) {
    await api.hideStory(s.id);
    await queryClient.invalidateQueries({ queryKey: ["feed"] });
    await queryClient.invalidateQueries({ queryKey: ["my-stories"] });
  }

  async function onUnhide(s: Story) {
    await api.unhideStory(s.id);
    await queryClient.invalidateQueries({ queryKey: ["feed"] });
    await queryClient.invalidateQueries({ queryKey: ["my-stories"] });
  }

  async function onDelete(s: Story) {
    const ok = await toast.confirm({
      message: t.feed.deleteConfirm,
      confirmLabel: t.common.confirmDelete,
      cancelLabel: t.common.cancel,
      danger: true,
    });
    if (!ok) return;
    await api.deleteStory(s.id);
    await queryClient.invalidateQueries({ queryKey: ["feed"] });
    await queryClient.invalidateQueries({ queryKey: ["my-stories"] });
  }

  function dismissPresence(storyId: string, gesture: string) {
    presenceGone.current.add(`${storyId}:${gesture}`);
    queryClient.setQueryData<FeedInfinite>(["feed"], (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: prev.pages.map((page) => ({
          ...page,
          items: page.items.map((s) =>
            s.id === storyId ? { ...s, cloud_unread: 0, cloud_gesture: "" } : s,
          ),
        })),
      };
    });
    queryClient.setQueryData<Story[]>(["my-stories"], (prev) =>
      prev?.map((s) =>
        s.id === storyId ? { ...s, cloud_unread: 0, cloud_gesture: "" } : s,
      ),
    );
    void api.markCloudsRead(storyId).catch(() => {
      /* next fetch restores if still unread */
    });
  }

  function timeLeading(story: Story) {
    const key = story.is_mine ? story.cloud_gesture : undefined;
    if (!key || !isGestureKey(key)) return undefined;
    const token = `${story.id}:${key}`;
    if (presenceGone.current.has(token)) return undefined;
    if (!presenceStarted.current.has(token)) {
      presenceStarted.current.set(token, Date.now());
    }
    return (
      <FeedCloudPresence
        gesture={key}
        label={key}
        startedAt={presenceStarted.current.get(token)!}
        onGone={() => dismissPresence(story.id, key)}
      />
    );
  }

  function rowProps(story: Story) {
    return {
      to: `/feed/${story.id}`,
      title: story.pseudonym,
      subtitle: feedVoiceSubtitle(story, t.feed.voice),
      time: timeAgo(story.published_at),
      timeLeading: timeLeading(story),
      avatarText: story.pseudonym,
      active: activeId === story.id,
      muted: story.status === "hidden",
      onMouseEnter: () => prefetchStory(story.id),
      onFocus: () => prefetchStory(story.id),
      moreLabel: t.chat.menuLabel,
      onMore: (ev: MouseEvent) => openMenu(story, ev.clientX, ev.clientY),
      onContextMenu: (ev: MouseEvent) => openMenu(story, ev.clientX, ev.clientY),
      onLongPress: (pos: { clientX: number; clientY: number }) =>
        openMenu(story, pos.clientX, pos.clientY),
      dataStoryId: story.id,
    };
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
            placeholder={t.shell.searchFeed}
            aria-label={t.shell.searchFeed}
            className={styles.searchInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <Link to={mine ? "/feed" : "/feed/mine"} className={styles.addRow}>
        <span className={styles.addAvatar} aria-hidden>
          ·
        </span>
        <span className={styles.addText}>
          <strong>{mine ? t.feed.title : t.feed.mine}</strong>
        </span>
      </Link>
      <Link to="/feed/new" className={styles.addRow}>
        <span className={styles.addAvatar} aria-hidden>
          +
        </span>
        <span className={styles.addText}>
          <strong>{t.shell.addEntry}</strong>
          <small>{t.shell.addEntryHint}</small>
        </span>
      </Link>

      <div className={styles.scroll} ref={scrollRef} onScroll={captureAnchor}>
        {(mine ? mineQuery.isLoading : query.isLoading) ? (
          <p className={styles.empty}>{t.feed.loading}</p>
        ) : (!mine && query.isError) || (mine && mineQuery.isError) ? (
          <p className={styles.empty}>{t.feed.offline}</p>
        ) : stories.length === 0 ? (
          <p className={styles.empty}>
            {q.trim() ? t.feed.noResults : t.feed.empty}
          </p>
        ) : useVirtual ? (
          <div
            className={styles.virtualInner}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const story = stories[vItem.index]!;
              return (
                <ListRow
                  key={story.id}
                  {...rowProps(story)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: vItem.size,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                  dataRowStart={vItem.start}
                />
              );
            })}
          </div>
        ) : (
          stories.map((story) => (
            <ListRow key={story.id} {...rowProps(story)} />
          ))
        )}

        <div ref={sentinelRef} aria-hidden />
        {query.hasNextPage ? (
          <button
            type="button"
            className={styles.loadMore}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage
              ? t.feed.loadMoreLoading
              : t.feed.loadMore}
          </button>
        ) : null}
      </div>
      {menu ? (
        <FeedMenu
          state={menu}
          onClose={() => setMenu(null)}
          onHide={(s) => void onHide(s)}
          onUnhide={(s) => void onUnhide(s)}
          onDelete={(s) => void onDelete(s)}
        />
      ) : null}
    </div>
  );
}
