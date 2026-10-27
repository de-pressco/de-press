# Frontend rework plan — de-press.co

The goal: make the interface **utterly clear and warm, like Telegram / WhatsApp**, but in de-press's own palette (a dark "quiet harbor" with the mint accent `hope`). Full convenience, perfect button placement like in Telegram, good both on desktop and (structurally) on mobile — **another coder does the mobile polish**, but we lay down the right adaptive structure.

> **Platforms:** one UI Core; the hosts — browser · Telegram Mini App · own desktop · own mobile. The Mini App is a stage, not the only mobile. See [`PLATFORMS.md`](./PLATFORMS.md).

The plan follows the rules of the six domain skills (`better-interface`, `better-accessibility`, `better-layout`, `better-writing`, `better-typography`, `better-colors`, `better-ui`) and is based on an audit of the current code.

---

## 1. Scope and the current state (recon)

| Area | Current | The problem for the "Telegram style" |
|---|---|---|
| The `globals.css` tokens | the dark theme, `--accent-hope` (mint), `--accent-panic`, system-ui, a focus ring + reduced-motion already exist | Too few tokens for "messages", "sidebar", "tab bar", "avatars" |
| The `Header.tsx` header | a sticky header with 8 links in a row + bell + locale + panic | Overloaded; on mobile — a horizontal scroll of "just links" |
| The chat `DialogueClient.tsx` | the bubbles exist (`.me/.them/.system`), the composer in the flow | The composer is not pinned to the bottom, the buttons under the textarea, no "chat header", no message time |
| The feed `FeedClient.tsx` | a publish form on top + the feed | Fits the "Telegram-like" well: the form can become a modal/a compact composer |
| `/me` | the sections: notify, inbox, dialogues, stories + clouds/hearers | Fits "dialogues/sections"; needs card-rows like in TG |
| Anti-panic | BreathingCanvas | Already minimal — keep as is (a special mode) |
| The buttons `Button.tsx` | primary/secondary/ghost/danger | Add `active: scale(0.96)` + a `transition` on separate properties |
| i18n | the ru/en core | All new UI strings — straight into `types.ts`/`ru`/`en` |

---

## 2. Design tokens (foundation)

### 2.1 New tokens in `globals.css`
```css
:root {
  /* Surfaces */
  --bg-chat: #0b0d11;          /* the chat background, a bit darker than main */
  --bg-bubble-me: #1e5346;     /* my bubble — a dark mint background */
  --bg-bubble-them: #1e232c;   /* their bubble — neutral */
  --bg-sidebar: #12151b;       /* the sidebar/navigation */
  --bg-input: #1a1f27;         /* the message input field */
  --bg-hover: rgba(255,255,255,0.05);
  --bg-active: rgba(126,184,162,0.18);

  /* Text on bubbles */
  --text-bubble: #eef2f6;
  --text-bubble-muted: rgba(238,242,246,0.62);

  /* Radius — concentric */
  --radius-bubble-me: 1.15rem 1.15rem 0.4rem 1.15rem;   /* the tail on the right */
  --radius-bubble-them: 1.15rem 1.15rem 1.15rem 0.4rem; /* the tail on the left */

  /* Layout */
  --sidebar-width-desktop: 15rem;
  --composer-height: 3.75rem;
  --max-width-chat: 46rem;

  /* Shadows (elevation, not borders) */
  --shadow-elev-1: 0 1px 2px rgba(0,0,0,.24);
  --shadow-elev-2: 0 8px 24px rgba(0,0,0,.30);
}
```

### 2.2 Contrast and color
- Check the pairs `--text-bubble` on `--bg-bubble-me/them` and `--text-muted` on surface via APCA (`|Lc| >= 60` for non-body). Mint on dark is contrasty, but verify by computation.
- **One color — one meaning**: `accent-hope` = action/activity highlight, `accent-panic` = crisis/destructive. Never paint decoratively.
- The palette: keep HEX (the project format), do not convert to oklch without migrating everything.

---
### 2.3 Font
- Keep `system-ui` (already good), add `font-variant-numeric: tabular-nums` for the counters (the unread badge, the pulse).
- `text-wrap: balance` on the section headings, `pretty` on the descriptions.
- Continue `-webkit-font-smoothing: antialiased` (already there).

---

## 3. The skeleton and navigation (Telegram-like)

### 3.1 Desktop: a sidebar on the left (a Telegram Web analog)
- A new `Sidebar` component (instead of the overloaded header):
  - Top: the brand `de-press` + `NotificationBell`.
  - The items (an icon + a label): **Feed** `/feed`, **Chats** `/me` (the dialogues — with an unread badge), **Helper** `/helper` (Helpers only), **Patterns** `/patterns`, **Help** `/help`, **Guides** `/guides`, **Safety** `/safety`, **About** `/about`.
  - Bottom: sign-in/account + the language switcher + **Anti-Panic** (a separate red button).
  - The active page: `aria-current="page"` + a `--bg-active` highlight + a left indicator bar.
- `Header` shrinks to: (hidden on mobile) brand + bell + panic; all the navigation moves into the sidebar.
- **Adaptivity**: below 1100px the rail turns into a **bottom tab bar**: **Feed · Chats · More** + Anti-Panic as the last slot (canonical — [`MOBILE_PWA.md`](./MOBILE_PWA.md)). There is no Notifications tab: a bell counter is an engagement metric the product refuses.

### 3.2 Shell
- `Shell.tsx`: `Sidebar` on the left, the content on the right; the content — a `max-width` per section.
- The "list" sections like in TG: a group with space, no line separators (remove `border-bottom` wherever possible, replace with `gap`).

### 3.3 The skip link and landmarks
- Add "Jump to content" as the first focusable element; `<main id="main">` already exists.

---

## 4. The chat — the heart, as in WhatsApp/Telegram

### 4.1 The composer pinned to the bottom
`DialogueClient` → the layout:
```
[ the chat header: ← back | intent · status | ⋯ (hide/report) ]
[               the thread (scrollable)                    ]
[                    the composer (sticky bottom)           ]
```
- `.thread` gets its `min-height` via `height: calc(100dvh - header - composer)` and `overflow-y: auto`; the composer — `position: sticky; bottom: 0` inside a full-height flex column that grows (like the TG web).
- **The input at the bottom**: a `<textarea>` (1 line, auto-grow to 5) + a **microphone button** on the left of the field + a **send button** on the right (appears with non-empty text) — the WhatsApp pattern.
- While recording: the stop/cancel button — in the composer row (replacing the general button row).
- "Close the dialogue" and "Hide the peer" — into the header (the `⋯` menu), not into the composer.

### 4.2 The bubbles (more "messenger-like")
- `.me` — on the right, the `--bg-bubble-me` background, the radius with the tail on the right (`--radius-bubble-me`); the time + (optional) a "checkmark" — a small line under the text.
- `.them` — on the left, `--bg-bubble-them`, the tail on the left.
- `.system` — centered, delicate, no background.
- The message time — `HH:MM`, `tabular-nums`.
- Voice: a more compact player (like a TG recording), a time progress.

### 4.3 The circles (video circles) — the UI skeleton
- Add a "circle" (video) button to the composer. While the backend is not ready — the button is hidden/disabled with a "coming soon" tooltip. The UI pattern: recording in a circle, like TG (hold or tap-to-record in the future).
- The voice notes with a delete option — a switch in the settings (see the ROADMAP priorities), the composer uses `VoiceRecorder` with options.

---
## 5. The section screens (lists like in Telegram)

### 5.1 The feed `/feed`
- The "Write quietly" composer — **collapsible** (a "Write" button like in the TG composer) or a compact line at the top of the list; publishing is the same form, but it does not bloat the feed.
- `StoryCard` — a card-row: the topic (a badge), the monologue preview (max 3 lines, `line-clamp`), the pseudonym/time; a click → the detail.
- The topic filter — a compact `<select>` or chips — chips are clearer and prettier, like the filters in TG.

### 5.2 `/me` (Chats/Mine)
- Split into **tabs** or groupings: "Dialogues", "Requests", "My stories" — like telegram lists with right chevrons.
- A dialogue row: the status (live/closed), the intent, an unread badge — a row with a placeholder avatar (an initial).
- NotifySettings, clouds, hearers — stay author sections, but in a unified card style.

### 5.3 `/helper`
- The cloud queue — list rows with Approve/Reject buttons (confirming the action: `verb-first` labels from i18n).

### 5.4 Anti-panic
- Keep the minimalism. Do not change the behavior. Only check the focus and the large hit areas.

### 5.5 Literacy (`/guides`, `/help`, `/safety`, `/about`, `/patterns`, `/companion`, `/helper`, `/inbox`)
- A unified "screen-page" template: a heading, an intro, the content; wide fields, a measure of ~65ch.

---

## 6. Components (better-ui)

### 6.1 Button
- `active: scale(0.96)`; `transition-property: transform, background-color, box-shadow` (never `transition: all`).
- Shadow elevation instead of a border-for-depth; a border — only structure/state.
- A minimum hit area of 40×40 (desktop), 44×44 (touch) — extend via `::after` where it is visually smaller.

### 6.2 Icons
- **A unified iconography**: one set, `stroke=1.5–2px` per the text, `currentColor`; fill — the active state only.
- The icons: the feed, chats, helper, patterns, help, safety, guides, about, settings, the microphone, the camera (a circle), a checkmark, ⋯, the panic exit.

### 6.3 Animations
- The enter/exit of tabs/modals: `opacity + translateY(4px)` over 150–200ms, `ease-out`; a stagger of sections ~100ms only for rare entrances.
- The "typing…" dots already exist — keep.
- `prefers-reduced-motion` is already global — keep.

### 6.4 Radii
- Concentric: a bubble inside a chat → nested elements; the sidebar active item (radius-lg) with an inner indicator (radius-sm). Obey `outer = inner + padding`.

---

## 7. Accessibility (better-accessibility)

- **Focus**: `:focus-visible` + `--focus-ring` already exist; check on all the new sidebar links and the action bubbles (translate/report — the buttons will get a visible ring).
- **Hit areas**: a minimum of 40×40; make the sidebar links full width and 44px high.
- **Aria**:
  - The action icons: `aria-label` (translate, report, microphone, close the menu).
  - The `translate/report` bubble buttons — real `<button>`s (already), but add `aria-label`.
  - The unread counter — do not spam `aria-live="polite"`; a stable `role="status"`.
  - The chat header menu (`⋯`) — Escape closes it, roving tabindex is not needed (a simple menu).
- **Zoom 200% / 320px**: check with a list; text containers use `min-height` instead of fixed heights, `rem` in the tokens.
- **The skip link** — the first focusable element.

---

## 8. The texts (better-writing)

- All the buttons — verb-first: "Write", "Send the request", "Approve", "Reject", "Close the dialogue", "Hide the peer".
- The empty states — with orientation and an action (already in the feed/chats; push to a unified style).
- One case: sentence case for buttons and headings.
- Notifications/the digest — "you", not "the user".
- All the new strings — into `types.ts` + `ru/en`.

---

## 9. The implementation order (stages)

### Stage A — Foundation (tokens + skeleton)
1. Extend `globals.css` with the tokens (2.1), check the pair contrasts.
2. `Sidebar` + `Shell` + simplify `Header`; the skip link; the active state (`aria-current`).
3. `Button` polish (scale, transitions, hit areas).
4. The i18n keys for the new navigation labels.

### Stage B — The chat messenger (the heart)
1. Relayout `DialogueClient`: a chat header + a full-height thread + a sticky composer.
2. A WhatsApp-style composer: a 1-line textarea + a microphone + a send button.
3. The bubbles: the time, the tails, the me/them backgrounds, a compact voice player.
4. The `⋯` menu in the header (close/hide).

### Stage C — The section screens
1. The feed: a compact composer + topic chips + StoryCard rows.
2. `/me`: tabs/groupings + dialogue rows.
3. `/helper`, the literacy pages — a unified template.
4. The mobile structure: the `BottomNav` skeleton (the styles — for the other coder).

### Stage D — UI polish and animations
1. The enter/exit animations of sections/modals.
2. The icons as one set + a stroke match.
3. The hovers/active by the `--bg-hover/--bg-active` tokens.
4. A final `better-interface` pass over all the screens (full) + tsc + pytest.

---

## 10. The rework principles (do not break)

1. **NO Tailwind** — CSS Modules + tokens (a project rule).
2. Keep the meanings: the feed stays "monologues-clouds", the chat — "sitting nearby", no gamification and no public counters.
3. Anti-Panic — an unchanging minimalism, more important than the feed.
4. The mobile polish is done by another coder — we provide the structure (`Sidebar` → `BottomNav`), but the mobile visuals are their zone.
5. Everything new — into i18n ru/en immediately.
6. `prefers-reduced-motion` and focus rings — mandatory.
