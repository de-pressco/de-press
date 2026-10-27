# MAINPLAN — two agents, two branches, one backend

After this document is approved, create at the repo root:

- `MAINPLAN.md` — this text (the work contract)
- `PROGRESS.md` — a living journal; both agents append to it **at the end of every task**

Do not start features until Gate 0 is closed.

---

## Who owns what

| | Agent A — **Grok** (this session) | Agent B — **the second agent** |
|---|---|---|
| Git branch | `feat/agent-a-helper-ops` | `feat/agent-b-companion-hosts` |
| Theme | The Helper role in browser + backend | AI companion, Mini App, multilingual, hosts |
| Base | `main` after Gate 0 | `main` after Gate 0 |

Grok just built the Help Request — the Helper context is hot, so Track A lives here. The second agent does not duplicate browser-Help and does not touch `dialogue.help`.

---

## Stack (do not deviate)

Shared backend: Django + Ninja + Channels, Postgres required (SQLite for pytest only), Redis for WS.

Browser and Mini App are **two apps**, ADR 0014. Never import `apps/mini-app/vendor` into browser. No Tailwind: CSS Modules + the `--bg-main`, `--bg-surface`, `--text-primary`, `--text-muted`, `--accent-hope` tokens.

AI: the existing OpenAI-compatible gateway (DeepSeek / offline stub). Do not swap the provider "while we are at it". Prompts: emotional validation, no diagnoses, no toxic positivity. AI is always labeled. Anti-Panic does **not** call the AI.

Domain: Helper ≠ therapist ≠ 112. Crisis → 112/103. No public likes/comments. Patterns and companion memory — device only (ZK).

---

## Gate 0 (Grok only, before parallelization)

The repo just got git. The HELP feature lives on `feat/help-human-ai` (14 commits after `99723a4`). No remote.

1. Walk `/help` manually at http://127.0.0.1:5174 (cards, wait, accept by the Helper, `/help/ai`, the phone viewport).
2. Merge `feat/help-human-ai` → `main` locally.
3. From `main`, create `feat/agent-a-helper-ops` and `feat/agent-b-companion-hosts`.
4. Put `MAINPLAN.md` and `PROGRESS.md` at the root, commit to `main`.
5. Write the Gate 0 = done line into `PROGRESS.md`.

Until Gate 0 is done, agent B does **not** start (otherwise the bases drift apart).

---

## Track A — Grok: Helper ops

The order inside the track is **strict**. Every item is a separate commit package, green tests, a `PROGRESS.md` entry.

### A1. Report in the help chat without a Story

Currently `Report.story` is required; `submit_message_report` breaks when `dialogue.story_id is None`.

- `Report.story` → `null=True`; XOR: either a story or a message (the help chat).
- Open-report uniqueness for help: by `(message, from_account|from_session)`, not by story.
- UI: the report in `DialoguePage` works at `source=help`.
- Files: `backend/apps/moderation/**`, `backend/api/v1/moderation.py`, `MessageMenu.tsx` if needed.

### A2. Dialogue Request review by the Helper

The "we checked — you are safe" banner is already in the UI and **lies**. The Helper must see the request before the author.

- Status: `awaiting_helper` → after the author's approve it shows as `pending` (accept/decline as now). A Helper's reject → `declined`, the author does not see the grey row.
- The author's inbox `GET /api/v1/me/dialogue-requests` — reviewed ones only.
- The Helper's inbox: `GET /api/v1/moderation/dialogue-requests` + approve/reject.
- The Helper's UI: grey rows in `/chat` **below** the Help Request, **above** the author's Dialogue Requests. Do not make `/helper` a second conversations inbox.
- Notify: Helpers get `dialogue_request_review`; the author keeps the existing `dialogue_request` only after approve.
- Files: `backend/apps/dialogue/models.py` (status), `services.py` (`create_request` / `list_inbox` / new approve), `api/v1/dialogue.py`

### A3. Helper onboarding

Currently only `is_helper` in the Django admin.

- Staff / an existing Helper creates a **one-time invite** (token, org, TTL).
- The candidate (an account) opens `/helper/join?token=` → a short pledge (not a doctor, not 112, free to leave) → `is_helper=True`, `helper_org` from the invite.
- No open self-signup "become a Helper".
- The invite list lives in the dashboard (A4), never public.
- Files: `backend/apps/identity/**` (the invite model), a new `api/v1/helper_invite.py`, `apps/browser/src/features/helper/HelperJoin.tsx`, a UserMenu item for staff only.

### A4. Moderation dashboard

The API `GET /api/v1/moderation/dashboard` is live, the UI is not.

- `/helper` becomes two tabs: **Clouds** (the current queue) + **Summary** (the dashboard numbers + the latest reports, no public suffering counters).
- The help-chat reports from A1 are visible in the summary.
- Do not drag Help Requests and Dialogue Requests here (they live in `/chat`).
- Files: `HelperQueue.tsx` + css; the client already has the dashboard.

### A5. Duty

- An `is_on_duty` field (or equivalent) on an Account-Helper. The toggle in the `/helper` summary and/or UserMenu.
- `POST /api/v1/me/helper-duty` `{on: bool}`.
- Notify and the inbox of Help Request / dialogue-review — **only** `is_helper && is_on_duty && is_active`. If nobody is on shift — wait as now + 112 + the AI link. Do not promise "an answer in 30 seconds".
- Files: the identity model, `dialogue/help.py` (`_notify_helpers`, `list_help_inbox`), ChatList is optional.

> **Superseded 2026-10-27 (owner decision).** The Help Request **inbox** is no longer limited to
> on-duty Helpers: the shared pending pool is visible to every Helper, and duty gates only
> notifications, instant match and presence. Also settled: **the moderator IS a Helper** — there is
> no separate moderator role (`is_staff ⇒ is_helper`), so `/console/` and `/helper` are two doors of
> the same role. Track A stays historical; the live state is
> [`HELPERS_MODERATION_ADMIN.md`](./de-press-docs/app/HELPERS_MODERATION_ADMIN.md).

### A6. Online + instant match

Only after A5.

- Heartbeat: a Helper with an open `/chat` or `/helper` pings (HTTP every 20s or a light WS). "Online" = a ping < 45s.
- If there is a Helper on duty **and** online — the Help Request is assigned to one of them (round-robin / least-recent), immediately `Dialogue source=help`, the wait instantly turns into "open the chat". The others do not see the row.
- If nobody — the A5 queue.
- Never expose names or "N helpers online". The maximum for the waiting person: "someone is on shift now" / "nobody at the screen right now".
- Files: `dialogue/help.py`, a thin `presence` (a new module, do not bloat `help.py` forever), `HelpWaitPane.tsx`.

---

## Track B — the second agent: companion and hosts

Do not wait for A2–A6, except for the contracts below. Start after Gate 0.

### B1. Streaming AI + IndexedDB memory

- A new endpoint **next to**, without breaking POST `/api/v1/ai/support`: for example `POST /api/v1/ai/support/stream` (SSE). The old POST stays for tests and the Mini App until the port.
- Gateway: `stream` on the OpenAI-compatible client. The offline stub — in one chunk (or sentence by sentence).
- The crisis short-circuit — without "pretty printing" 112 instructions.
- IndexedDB: a new store in `apps/browser/src/core/memory/` (DB version +1), **do not** put the replicas into `mood_entries`. The server still receives the last ≤12 replicas per turn.
- Wiping the memory — the same wipe as the patterns, with a separate confirmation "and the AI dialogues".
- UI: only `CompanionPane.tsx` (+ css). Not a row in `/chat`. Do not call Anti-Panic.
- Files: `backend/apps/ai/**`, `backend/api/v1/ai.py`, `CompanionPane.*`, `core/memory/db.ts`.

### B2. Mini App parity

`apps/mini-app` is a separate tree. Currently Help is static, there is no `/help/wait`, `/help/ai`, no grey Help Requests in the chats. Telegram auth already exists.

- Port (copy, not a shared package) the HELP cards, wait, companion, the help-inbox into ChatList, the Helper join if A3 is already in `main`.
- `startapp`: `help_wait`, `help_ai`, `helper_join`.
- Do not start the `vendor/telegram-tt` integration in this item.
- If the A5/A6 APIs are not there yet — duty/match are simply absent in the Mini App (the queue as now).
- Files: **only** `apps/mini-app/**`. Importing from `apps/browser` is forbidden.

### B3. Native dynamic multilingual

Content, not UI dictionaries. STT/translate stubs already exist in `backend/apps/dialogue/speech.py`.

- The chain STT → translate → TTS for voice notes in the Initiated Dialogue (including help chats).
- The target language — the actor's locale (the UI locale already exists). An offline marker when there is no key.
- Do not replace the UI i18n catalog with this pipeline.
- Files: `speech.py`, the transcribe/translate API (already partial), `VoiceBubble` / the composer in **mini-app** if B2; the **browser** VoiceBubble — only if Grok does not hold the file. Rule: browser `features/chat/VoiceBubble.tsx` and `DialoguePage.tsx` belong to **Grok** for the A track. B3 in the browser — a separate agreed slot in `PROGRESS.md` ("B3-browser-voice: waiting for A idle"), or B3 starts as API + Mini App only, the browser voice after A6.

### B4. Own mobile / own desktop (a horizon inside the track, not a store release)

Not "publish to the stores". The first concrete exit:

- Fix an ADR addendum: the Mini App ≠ own mobile.
- The browser PWA is already live — describe what is missing before own mobile (push, store chrome).
- Own desktop: choosing a shell (Tauri vs deferred) in one ADR, without big native code in this MAINPLAN.
- A `native/` folder, if it appears — agent B only.

---

## File ownership (a conflict = a plan violation)

### Agent A (Grok) only

```
backend/apps/dialogue/help.py
backend/apps/dialogue/models.py          # HelpRequest, DialogueRequest statuses, Dialogue.story
backend/apps/dialogue/services.py        # request/accept/outreach; not speech.py
backend/apps/identity/**
backend/apps/moderation/**
backend/api/v1/help.py
backend/api/v1/moderation.py
backend/api/v1/identity.py
apps/browser/src/features/help/HelpPane.*
apps/browser/src/features/help/HelpWaitPane.*
apps/browser/src/features/helper/**
apps/browser/src/features/chat/**         # ChatList, DialoguePage, menus, voice in the browser
apps/browser/src/components/layout/UserMenu.tsx
```

### Agent B only

```
backend/apps/ai/**
backend/api/v1/ai.py
backend/apps/dialogue/speech.py
apps/browser/src/features/help/CompanionPane.*
apps/browser/src/core/memory/**
apps/mini-app/**                          # the whole tree
```

### Shared files — protocol, not a free edit

| File | How to touch |
|------|--------------|
| `apps/browser/src/App.tsx` | Add **only your own** `<Route>`. Do not reorder others'. |
| `apps/browser/src/core/api/client.ts` + `types.ts` | Append methods/types at the end of your block. Do not reformat the file. |
| `apps/browser/src/core/i18n/messages/ru.ts` `en.ts` `types.ts` | A: `help.*` except companion, `helper.*`, `me.*`, `shell.safetyBanner`. B: `companion.*`. New keys are append-only. Do not rename others' keys. |
| `apps/browser/src/core/hooks/useNotifications.ts` | A adds the kinds review/duty. B adds no kinds without a line in PROGRESS. |
| `backend/api/main.py` | One `add_router` line at a time, alphabetically / at the end of the list. |
| `backend/apps/notifications/models.py` | New `NotificationKind` — first a PROGRESS line "claim: kind=…", then the commit. |
| `CAPABILITIES.md` `README.md` `CONTEXT.md` | Append the lines/paragraphs of your feature. Do not rewrite whole tables. |
| `MAINPLAN.md` | Change only with the agreement of both (or the human). |
| `PROGRESS.md` | Both write; never delete others' lines. |

If you need a file from someone else's zone — **stop**, a `blocked-on: A|B` line in PROGRESS, not "a tiny patch in someone else's file".

---

## API contracts (B may rely on them once A writes `contract:ready` into PROGRESS)

Already in `main` after Gate 0:

```
POST /api/v1/help/requests
GET  /api/v1/help/requests
GET  /api/v1/help/requests/mine
POST /api/v1/help/requests/{id}/accept|skip|cancel
POST /api/v1/ai/support
GET  /api/v1/moderation/dashboard
POST /api/v1/auth/telegram
```

A2 will add (the names are fixed in PROGRESS at commit time):

```
GET  /api/v1/moderation/dialogue-requests
POST /api/v1/moderation/dialogue-requests/{id}/approve
POST /api/v1/moderation/dialogue-requests/{id}/reject
```

A3:

```
POST /api/v1/helper-invites
POST /api/v1/helper-invites/{token}/accept
```

A5–A6:

```
GET  /api/v1/me
     + is_on_duty, maybe presence
POST /api/v1/me/helper-duty
GET  /api/v1/help/presence     # { someone_on_duty: bool, someone_online: bool } without human counters
```

B1:

```
POST /api/v1/ai/support/stream   # SSE; the old /support is not removed
```

---

## The PROGRESS.md journal (format)

Every entry is a block, not an essay:

```markdown
## YYYY-MM-DD HH:MM  agent=A|B  id=A2
status: started | blocked-on:A3 | contract:ready | done
branch: feat/agent-a-helper-ops
commit: abc1234
notes: one line
files: list of the paths touched
api: METHOD /path  (if a contract)
```

Rules:

- Before starting a task — `status: started`, so the other does not take the same one.
- After an API the other relies on — `contract:ready` + the exact path.
- `blocked-on` is mandatory when waiting for someone else's file/contract.
- Do not rebase someone else's branch. Push to `main` only after Gate 0 and explicit merges by the human.

---

## What we do not do in this MAINPLAN

- Toxic positivity, diagnoses, AI as a hidden peer in `/chat`.
- Public likes, comments, a showcase "N helpers online".
- Duty hours of a calendar (cron shifts) — only the "on shift" toggle.
- Publishing the Mini App on the Web A shell and the native stores.
- A shared npm package between browser and mini-app.

---

## The "track is closed" criterion

**A:** the help chat can be reported; the Dialogue Request goes to the Helper first; the invite onboarding; the dashboard on `/helper`; duty cuts the notifications; with an on-duty online Helper the Help Request opens the chat instantly.

**B:** `/help/ai` streams and remembers on the device; the Mini App handles the same HELP paths and telegram login; voice goes through the STT→translate→TTS pipeline at least in the Mini App + API; an ADR for own desktop/mobile is recorded, with no store code.

The human merges the branches into `main`. The agents never force-push.
