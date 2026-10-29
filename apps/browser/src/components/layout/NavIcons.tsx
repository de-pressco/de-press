/** App icon set: sidebar rail, panic mark, More-row avatars. Outline default, currentColor, stroke 1.5 (regular text). */
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
  // Газета: рамка + строки поста. Активное состояние — заливка с вырезанными
  // строками через SVG-маску (как в IconHelp): вырез показывает реальный фон,
  // а не закрашивается токеном (ломалось бы на --bg-active и любых темах).
  const maskId = `dp-feed-cut-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
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
              d="M8 9h8M8 12.75h8M8 16.5h4.5"
              fill="none"
              stroke="#000"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
        </defs>
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="2.5"
          fill="currentColor"
          stroke="none"
          mask={`url(#${maskId})`}
        />
      </>
    ) : (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
        <path d="M8 9h8M8 12.75h8M8 16.5h4.5" />
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
  // График с точками: «мои замеры и их динамика». Активное состояние —
  // толще линия + крупнее точки (line-art не заливается).
  const w = props.active ? 2.2 : 1.5;
  return base(
    <>
      <path d="M4.5 17.5 9.5 11.5 13.5 14.5 19.5 6.5" fill="none" strokeWidth={w} />
      <circle cx="9.5" cy="11.5" r={props.active ? 1.6 : 1.3} fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="14.5" r={props.active ? 1.6 : 1.3} fill="currentColor" stroke="none" />
      <circle cx="19.5" cy="6.5" r={props.active ? 1.6 : 1.3} fill="currentColor" stroke="none" />
    </>,
    props,
  );
}

export function IconShield(props: IconProps) {
  // Щит с галочкой: «дежурство принято / проверенные люди». Вырез галочки —
  // через SVG-маску (как в IconHelp), чтобы работало на любом фоне.
  const maskId = `dp-shield-cut-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
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
              d="M9.1 11.9l2 2 3.8-4.1"
              fill="none"
              stroke="#000"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
        </defs>
        <path
          d="M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3z"
          fill="currentColor"
          stroke="none"
          mask={`url(#${maskId})`}
        />
      </>
    ) : (
      <>
        <path d="M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3z" />
        <path d="M9.1 11.9l2 2 3.8-4.1" />
      </>
    ),
    props,
  );
}

export function IconEdit(props: IconProps) {
  return base(
    props.active ? (
      <path d="M4 20h4l10.5-10.5-4-4L4 16v4zm12.8-12.8 1.7-1.7a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.7 1.7 3 3z" />
    ) : (
      <>
        <path d="M4 20h4l10-10-4-4L4 16v4z" />
        <path d="m14.5 6.5 3 3" />
      </>
    ),
    props,
  );
}

export function IconTherapy(props: IconProps) {
  // Росток: рост и восстановление, принципиально не «медицина».
  // Активное состояние — залитые листья, стебель остаётся линией.
  return base(
    <>
      <path d="M12 20.5v-6.9" fill="none" strokeWidth={1.5} />
      <path
        d="M12 13.6C8.9 13.6 6.7 11.7 6.1 8.2c3.7.4 5.8 2.3 5.9 5.4z"
        fill={props.active ? "currentColor" : "none"}
      />
      <path
        d="M12 13.6c.2-3.4 2.4-5.4 6-5.7-.2 3.5-2.5 5.5-6 5.7z"
        fill={props.active ? "currentColor" : "none"}
      />
    </>,
    props,
  );
}

export function IconMore(props: IconProps) {
  return base(
    props.active ? (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.2" />
        <rect x="13" y="4" width="7" height="7" rx="1.2" />
        <rect x="4" y="13" width="7" height="7" rx="1.2" />
        <rect x="13" y="13" width="7" height="7" rx="1.2" />
      </>
    ) : (
      <>
        <rect x="4.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="4.5" y="13.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="13.5" width="6" height="6" rx="1" />
      </>
    ),
    props,
  );
}

export function IconBell(props: IconProps) {
  return base(
    props.active ? (
      <>
        <path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
        <path d="M10 19a2 2 0 0 0 4 0" stroke="none" fill="currentColor" />
      </>
    ) : (
      <>
        <path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </>
    ),
    props,
  );
}

export function IconPanic(props: IconProps) {
  // Спасательный круг для кнопки «Мне хуево»: мгновенное «держись, тебя
  // вытащат». Тёплый образ помощи вместо «ошибки/запрета».
  const w = props.active ? 2.2 : 1.5;
  return base(
    <>
      <circle cx="12" cy="12" r="8.4" fill="none" strokeWidth={w} />
      <circle cx="12" cy="12" r="3.5" fill="none" strokeWidth={w} />
      <path
        d="M14.5 9.5 18 6M9.5 9.5 6 6M9.5 14.5 6 18M14.5 14.5 18 18"
        fill="none"
        strokeWidth={w}
      />
    </>,
    props,
  );
}

export function IconGear(props: IconProps) {
  // Классическая шестерёнка: зубчатый венец + круглая ступица. Прежний глиф
  // (кружок с лучами-спицами вокруг) читался как лампочка/солнце. Активное
  // состояние — заливка венца с вырезанной ступицей через SVG-маску (как в
  // IconHelp): вырез показывает реальный фон, не токен, — работает на любых
  // темах.
  const maskId = `dp-gear-cut-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const cog =
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z";
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
            <circle cx="12" cy="12" r="2.4" fill="#000" />
          </mask>
        </defs>
        <path d={cog} mask={`url(#${maskId})`} />
      </>
    ) : (
      <>
        <path d={cog} />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    props,
  );
}

export function IconTerminal(props: IconProps) {
  const w = props.active ? 2.2 : 1.5;
  return base(
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" strokeWidth={w} />
      <path d="M8 9.5l3 2.7-3 2.7" fill="none" strokeWidth={w} />
      <path d="M13.5 15.5h4" fill="none" strokeWidth={w} />
    </>,
    props,
  );
}

export function IconSmile(props: IconProps) {
  const w = props.active ? 2.2 : 1.5;
  return base(
    <>
      <circle cx="12" cy="12" r="8.4" fill="none" strokeWidth={w} />
      <path d="M9.2 9.8h.01M14.8 9.8h.01" fill="none" strokeWidth={w} />
      <path d="M8.6 13.7a4.6 4.6 0 0 0 6.8 0" fill="none" strokeWidth={w} />
    </>,
    props,
  );
}

export function IconBug(props: IconProps) {
  const w = props.active ? 2 : 1.5;
  return base(
    <>
      <path d="m8 2 1.88 1.88" fill="none" strokeWidth={w} />
      <path d="M14.12 3.88 16 2" fill="none" strokeWidth={w} />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" fill="none" strokeWidth={w} />
      <path
        d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"
        fill="none"
        strokeWidth={w}
      />
      <path d="M12 20v-9" fill="none" strokeWidth={w} />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" fill="none" strokeWidth={w} />
      <path d="M6 13H2" fill="none" strokeWidth={w} />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" fill="none" strokeWidth={w} />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" fill="none" strokeWidth={w} />
      <path d="M22 13h-4" fill="none" strokeWidth={w} />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" fill="none" strokeWidth={w} />
    </>,
    props,
  );
}

export type NavIconName =
  | "feed"
  | "chat"
  | "help"
  | "patterns"
  | "therapy"
  | "shield"
  | "edit"
  | "more"
  | "bell"
  | "panic"
  | "gear"
  | "terminal"
  | "smile"
  | "bug";

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
    case "edit":
      return <IconEdit {...props} />;
    case "more":
      return <IconMore {...props} />;
    case "bell":
      return <IconBell {...props} />;
    case "panic":
      return <IconPanic {...props} />;
    case "gear":
      return <IconGear {...props} />;
    case "terminal":
      return <IconTerminal {...props} />;
    case "smile":
      return <IconSmile {...props} />;
    case "bug":
      return <IconBug {...props} />;
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
