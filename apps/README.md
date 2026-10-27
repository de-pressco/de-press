# Client applications (`apps/`)

> Not to be confused with `backend/apps/` (Django apps).

## The main rule

**Browser, Mini App and the staff console are three separate applications.**  
UI changes in one do **not** automatically reach the other.

| App | Path | Port (dev) | Purpose |
|-----|------|------------|------------|
| **Browser** | [`browser/`](./browser/) | **5174** | The standalone web client of de-press (a PWA) |
| **Mini App** | [`mini-app/`](./mini-app/) | **5175** | The Telegram Mini App host (mobile-first), built with a `/tg/` base |
| **Admin console** | [`admin/`](./admin/) | **5176** | The staff-only moderation console, built with a `/console/` base (not an App Host) |

```
apps/
  browser/                 # the independent browser app
  mini-app/                # the independent Mini App
    vendor/telegram-tt/    # Telegram Web A (GPLv3) — see NOTICE.GPL.md
    src/                   # the de-press integration
```

## Native feel without native forks

The hosts doctrine is "four hosts" (ADR 0013, [PLATFORMS.md](../de-press-docs/app/PLATFORMS.md)),
but the product shell is reached **without maintaining native forks**:

- **Desktop:** a **tdesktop** fork (ADR 0015) — archived under `_archive/native/desktop/` (kept on the dev disk only, gitignored); own desktop is deferred to a Tauri shell
- **Mobile:** a Telegram Android fork (ADR 0016) — archived under `_archive/native/android/` (kept on the dev disk only, gitignored); `native/ios` — later; own mobile is PWA-first (ADR 0019)
- **Mini App** — a full host inside Telegram, at v1 parity: feed, help, helper ops, fund, calls, therapy

The Browser stays a separate web app with no tdesktop code.

## Backend

Shared: `backend/` (Django). Dialogues/stories always live on the de-press API, not MTProto.

## Dev

```bash
# Browser only
cd apps/browser && npm run dev    # :5174

# Mini App only
cd apps/mini-app && npm run dev   # :5175

# Fetch the Telegram Web A sources (large, GPLv3) — from the repository root
./scripts/fetch_telegram_tt.sh
```
