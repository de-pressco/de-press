# Telegram Mini App — dev runbook

> Host #2 of four — see [`PLATFORMS.md`](./PLATFORMS.md).  
> Code: `apps/web/src/core/host/*`, `POST /api/v1/auth/telegram`, `apps/identity/telegram.py`.

## What works in code now

1. **Bridge** — `telegram-web-app.js` in `app/index.html`; `bootstrapTelegramHost()` (ready, expand, theme).
2. **Auth** — `POST /api/v1/auth/telegram` with `{ "init_data": "<raw initData>" }`; HMAC validate → Account by `telegram_id` → Django session.
3. **HostProvider** — on app start, if inside TG with initData → seamless login; seeds React Query `["me"]`.
4. **Anti-Panic** — disables Mini App vertical swipe-to-close when active (if API exists).
5. **Deep-link `startapp=`** — maps to in-app routes once per session (`core/host/startParam.ts`).
6. **BackButton** — `TelegramBackButton` ↔ hierarchical React Router (`/feed/:id` → `/feed`, …).
7. **Bot soft-notify** — opt-in + `immediate` pings or **`daily` digests** (Celery beat / `send_telegram_digests`), plus a **neutral check-in nudge** (throttled, `send_checkin_nudges`).
8. **Browser host** — unchanged (no initData → no TG login); browser can still use `?startapp=` for local tests.
9. **Bot lobby (webhook)** — `apps/bot/`: `/start`, `/open`, `/help`, `/panic` + quiet fallback in private chats; outbound messages are HTML with inline buttons (ru/en).

## Deep links (`startapp`)

Telegram:

```
https://t.me/<bot>?startapp=<param>
https://t.me/<bot>/<short_name>?startapp=<param>
```

| `startapp` param | Route / effect |
|------------------|----------------|
| `feed` / `home` | `/feed` |
| `new` / `feed_new` / `write` | `/feed/new` |
| `story_<uuid>` / `s_<uuid>` | `/feed/<uuid>` |
| `chat` / `dialogues` | `/chat` |
| `chat_<uuid>` / `d_<uuid>` | `/chat/<uuid>` |
| `notifications` / `inbox` / `notify` | `/notifications` |
| `patterns` / `mood` | `/patterns` |
| `help` / `safety` / `crisis` | `/help` |
| `helper` | `/helper` |
| `panic` / `anti_panic` / `meh` | `/help` + Anti-Panic on |

Rules: `A–Z a–z 0–9 _ -`, max **64** chars (Telegram). Applied **once** per tab session (`sessionStorage`).  
Dev without TG: open `http://127.0.0.1:5174/?startapp=chat`.

## BotFather setup

1. Create bot via [@BotFather](https://t.me/BotFather) → copy token.
2. Set env:
   ```bash
   export TELEGRAM_BOT_TOKEN="123456:ABC..."
   export TELEGRAM_BOT_USERNAME="your_bot"   # without @, soft-notify deep links
   ```
3. Main Mini App URL must be **HTTPS** public URL of the Vite app (tunnel in dev).

```
/mybots → Bot → Bot Settings → Configure Mini App → Enable
URL: https://<your-tunnel>/ 
```

Or menu button: `/setmenubutton` → same HTTPS URL.

### Bot facade (description, commands, menu) — from code

`python manage.py setup_telegram_bot` registers everything through the Bot API
(idempotent): webhook, localized description/short description, private-chat
commands (`/start /open /help /panic`) and the WebApp menu button. Needs:

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC..."       # required
export TELEGRAM_BOT_USERNAME="your_bot"         # deep links
export TELEGRAM_BOT_WEBHOOK_SECRET="long-random" # webhook auth (secret_token)
# optional: TELEGRAM_BOT_WEBHOOK_URL, else PUBLIC_BASE_URL + /api/v1/bot/webhook
```

The webhook endpoint is `POST /api/v1/bot/webhook` and authenticates the
`X-Telegram-Bot-Api-Secret-Token` header (constant-time compare). With an empty
secret the endpoint returns 401. Dev one-shot without a secret:
`python manage.py setup_telegram_bot --allow-insecure`.

## Local dev with tunnel

```bash
# Terminal 1 — API
cd backend && source .venv/bin/activate
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_BOT_USERNAME=your_bot
daphne -b 127.0.0.1 -p 8005 config.asgi:application

# Terminal 2 — UI Core (proxies /api to :8005)
cd apps/web && npm run dev
# listens 0.0.0.0:5174

# Terminal 3 — public HTTPS (example)
cloudflared tunnel --url http://127.0.0.1:5174
# or: ngrok http 5174
```

Paste tunnel URL into BotFather Mini App settings. Open bot in Telegram → Launch.

## Identity notes

- TG-only accounts use synthetic email `tg{id}@users.de-press.local` (not a mailbox).
- Password unusable; login is Mini App / future link flows.
- Public pseudonym = first_name (or username / "guest"); **@username is not shown as feed identity by default**.
- Dialogues stay on de-press WS/API — not Bot chats.

## Tests

```bash
cd backend && source .venv/bin/activate
DEPRESS_USE_SQLITE=1 CHANNEL_LAYER=memory pytest \
  apps/identity/tests/test_telegram.py \
  apps/notifications/tests/test_telegram_notify.py \
  apps/bot/tests -q
```

## BackButton

On nested routes Telegram shows the native Back control:

| Path | Back → |
|------|--------|
| `/feed/:id`, `/feed/new` | `/feed` |
| `/chat/:id` | `/chat` |
| section roots (`/feed`, `/chat`, …) | hidden |

## Soft-notify (Bot)

1. Account must have `telegram_id` (Mini App login).
2. User enables **"Quiet Telegram reminders"** in UserMenu (`notify_telegram_opt_in`).
3. Frequency:
   - **`immediate`** — on each `notify()`, Bot message with an inline **Open** button
     (`startapp=chat_<uuid>|story_…|notifications`)
   - **`daily`** — batch job; one digest of unread **newer than** `telegram_digest_last_at`
     (`startapp=notifications`)

Message text is HTML and localized **ru/en** from `Account.telegram_language_code`
(recorded at Mini App login from the Telegram `user.language_code`); unknown → en.

### Living lobby (chat webhook)

The bot also answers `/start`, `/open`, `/help`, `/panic` (`/meh`) in private
chats — see `apps/bot/` — and replies to plain messages once per ~30 s with a
quiet pointer into the app (never chats back, never stores anything).
Buttons are `t.me/<bot>?startapp=…` deep links into the Mini App sections.

### Daily digest run

```bash
# One-shot (cron-friendly)
python manage.py send_telegram_digests

# Or Celery worker + beat (UTC hour from TELEGRAM_DIGEST_HOUR, default 10:00)
celery -A config worker -l info
celery -A config beat -l info
```

API test (logged-in TG account): `POST /api/v1/me/notify-settings/test-telegram`

### Check-in nudge (ADR-0025)

A separate periodic beat job (`send_checkin_nudges`, default 19:00 UTC) sends
one **neutral** localized message ("how are you today?" + Open button to
`startapp=mood` → /patterns) to opt-in Telegram accounts. It is **blind** to
local check-ins (the server never learns about them — ZK), so it cannot be
reactive: it is throttled to at most one per `TELEGRAM_NUDGE_INTERVAL_DAYS`
(default 3) per account and is skipped for the rest of the day if a digest
already went out. One-shot: `python manage.py send_checkin_nudges`.

## Not in this slice (next)

- Circles/mic WebView QA matrix  
