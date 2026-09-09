/** Sidebar icons: outline default, currentColor, stroke 1.5 (regular text). */
import { useId } from "react";

import styles from "./NavIcons.module.css";

interface IconProps {
  className?: string;
  active?: boolean;
}

function base(
  children: React.ReactNode,
  { className, active }: IconProps,
) {
  return (
    <svg
      className={className}
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconFeed(props: IconProps) {
  return base(
    props.active ? (
      <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z" />
    ) : (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
      </>
    ),
    props,
  );
}

export function IconChat(props: IconProps) {
  return base(
    props.active ? (
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    ) : (
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    ),
    props,
  );
}

export function IconHelp(props: IconProps) {
  // Настоящий вырез через SVG-маску: знак показывает реальный фон под иконкой,
  // а не закрашивается токеном фона (ломалось бы на --bg-active и любых темах).
  const maskId = `dp-help-cut-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return base(
    props.active ? (
      <>
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="24"
            height="24"
          >
            <rect width="24" height="24" fill="#fff" />
            <path
              d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8"
              fill="none"
              stroke="#000"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="17" r="0.9" fill="#000" />
          </mask>
        </defs>
        <circle cx="12" cy="12" r="9" mask={`url(#${maskId})`} />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8" />
        <path d="M12 17h.01" />
      </>
    ),
    props,
  );
}

export function IconPatterns(props: IconProps) {
  return base(
    props.active ? (
      <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" stroke="none" />
    ) : (
      <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />
    ),
    props,
  );
}

export function IconTherapy(props: IconProps) {
  return base(
    props.active ? (
      <path d="M3 12h4l2-5 4 10 2-5h6" stroke="none" />
    ) : (
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    ),
    props,
  );
}

export function IconShield(props: IconProps) {
  return base(
    props.active ? (
      <path d="M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3z" />
    ) : (
      <path d="M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3z" />
    ),
    props,
  );
}

export type NavIconName =
  | "feed"
  | "chat"
  | "help"
  | "patterns"
  | "therapy"
  | "shield";

function renderIcon(name: NavIconName, active: boolean) {
  const props = { active };
  switch (name) {
    case "feed":
      return <IconFeed {...props} />;
    case "chat":
      return <IconChat {...props} />;
    case "help":
      return <IconHelp {...props} />;
    case "patterns":
      return <IconPatterns {...props} />;
    case "therapy":
      return <IconTherapy {...props} />;
    case "shield":
      return <IconShield {...props} />;
  }
}

/** Оба варианта иконки друг над другом: CSS cross-fade при смене таба. */
export function NavIcon({
  name,
  active,
  className,
}: {
  name: NavIconName;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.wrap} ${className}` : styles.wrap}
      data-active={active || undefined}
      aria-hidden
    >
      <span className={styles.variant} data-variant="off">
        {renderIcon(name, false)}
      </span>
      <span className={styles.variant} data-variant="on">
        {renderIcon(name, true)}
      </span>
    </span>
  );
}
