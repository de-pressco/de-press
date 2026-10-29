import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useLongPress } from "@/core/hooks/useLongPress";
import { IconPin } from "@/components/layout/NavIcons";
import styles from "./ListRow.module.css";

export interface ListRowProps {
  to?: string;
  title: string;
  subtitle?: string;
  time?: string;
  /** Overlay just before the timestamp; must not change row flow. */
  timeLeading?: ReactNode;
  avatarText: string;
  active?: boolean;
  muted?: boolean;
  softCount?: number;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  style?: CSSProperties;
  /** Extra block under subtitle (e.g. safety banner) */
  extra?: ReactNode;
  className?: string;
  onClick?: () => void;
  asButton?: boolean;
  onContextMenu?: (ev: MouseEvent) => void;
  onLongPress?: (pos: { clientX: number; clientY: number }) => void;
  trailing?: ReactNode;
  onMore?: (ev: MouseEvent) => void;
  moreLabel?: string;
  pinned?: boolean;
  dataStoryId?: string;
  dataRowStart?: number;
}

/**
 * Telegram Desktop chat-list row: 72px, avatar 54, title/time, 2-line preview.
 */
export function ListRow({
  to,
  title,
  subtitle,
  time,
  timeLeading,
  avatarText,
  active,
  muted,
  softCount,
  onMouseEnter,
  onFocus,
  style,
  extra,
  className,
  onClick,
  asButton,
  onContextMenu,
  onLongPress,
  trailing,
  onMore,
  moreLabel,
  pinned,
  dataStoryId,
  dataRowStart,
}: ListRowProps) {
  const longPress = useLongPress(onLongPress);

  const cls = [
    styles.row,
    active ? styles.rowActive : "",
    muted ? styles.rowMuted : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  function onRowClick(ev: MouseEvent) {
    if (longPress.suppressClick.current) {
      ev.preventDefault();
      ev.stopPropagation();
      longPress.suppressClick.current = false;
      return;
    }
    onClick?.();
  }

  function onRowContext(ev: MouseEvent) {
    if (!onContextMenu) return;
    ev.preventDefault();
    onContextMenu(ev);
  }

  const body = (
    <>
      <span className={styles.avatar} aria-hidden>
        {avatarText.slice(0, 1).toUpperCase()}
      </span>
      <span className={styles.main}>
        <span className={styles.top}>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.meta}>
            {timeLeading}
            {time ? <time className={styles.time}>{time}</time> : null}
          </span>
        </span>
        {subtitle ? <span className={styles.preview}>{subtitle}</span> : null}
        {extra}
      </span>
      {softCount != null && softCount > 0 ? (
        <span className={styles.badge} aria-hidden>
          {softCount > 9 ? "9+" : softCount}
        </span>
      ) : null}
      {pinned ? (
        <span className={styles.pinMark} aria-hidden>
          <IconPin />
        </span>
      ) : null}
      {onMore ? (
        <button
          type="button"
          className={styles.more}
          aria-label={moreLabel}
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onMore(ev);
          }}
        >
          ⋯
        </button>
      ) : null}
      {trailing}
    </>
  );

  const shared = {
    className: cls,
    style,
    onMouseEnter,
    onFocus,
    onPointerDown: longPress.onPointerDown,
    onPointerMove: longPress.onPointerMove,
    onPointerUp: longPress.onPointerUp,
    onPointerLeave: longPress.onPointerLeave,
    onPointerCancel: longPress.onPointerCancel,
    onContextMenu: onRowContext,
    ...(dataStoryId ? { "data-story-id": dataStoryId } : {}),
    ...(dataRowStart != null ? { "data-row-start": String(dataRowStart) } : {}),
  };

  if (asButton || !to) {
    return (
      <button type="button" {...shared} onClick={onRowClick}>
        {body}
      </button>
    );
  }

  return (
    <Link
      to={to}
      {...shared}
      aria-current={active ? "page" : undefined}
      onClick={onRowClick}
    >
      {body}
    </Link>
  );
}
