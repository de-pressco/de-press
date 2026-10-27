# Plan: parity, the helper dashboard, the translation, the retest (August 2026)

Related: [ROADMAP.md](./ROADMAP.md), [VOICE_THERAPY_PLAN.md](./VOICE_THERAPY_PLAN.md) (closed). The questions Q1–Q10 were resolved 2026-08-30 and recorded in the "Phase decisions" of ROADMAP.md — the OPEN_QUESTIONS.md file is retired.

Principles: minimal diffs; parity = porting the existing, not new features; every step ends with green checks and a commit. All questions are resolved 2026-08-30 — see the "Phase decisions" of [ROADMAP.md](./ROADMAP.md).

## P1. The browser ↔ Mini App parity tails

| Step | What | Status |
|------|------|--------|
| P1.1 | **Therapy in the Mini App**: TherapyPane + PayModal (a Solana Pay QR), the api methods and types (`TherapistProfileOut`/`TherapySession`/`Me.is_therapist`), i18n `therapy.*` (31 keys) + `nav.therapy`, an icon in the Sidebar rail, the `qrcode` dep | ✅ done |
| P1.2 | **The fund in the Mini App**: FundCard, TipBanner (DialoguePage), TipWalletForm (UserMenu), `wallet.ts` (the test stayed in the browser — the same logic, no vitest in the mini-app), the api `fundInfo`/`setTipWallet`, i18n `fund.*` (15 keys) | ✅ done |
| P1.3 | **Calls in the Mini App**: we port them (Q2) — callMachine/useCall/CallModal, the signaling over the dialogue WS (`CallSignalEvent`+`sendCall` in useChatSocket), the api `rtcConfig`, the button hidden without `navigator.mediaDevices`, i18n `calls.*` (17 keys) | ✅ done |

Acceptance: `npm run build` (tsc + vite) in the mini-app is green; i18n is in sync ru/en/types; the total catalog is ≤ 640 keys (the shared cap `i18n_ui.MAX_KEYS`).

## P2. Publishing the repository — at the very end of the project (Q5)

The Q5 decision: the GitHub publication is deferred until all the other project tasks are closed.
- At the moment of publication: the license (AGPL-3.0), CI (GitHub Actions: ruff + pytest in chunks, vitest, both vite builds), README (a quick start, the stack, the structure).
- Before publication: `git log --format=%ae | sort -u` (the emails in the history), `.env.example` checked against `settings/base.py`.

## P3. Translating the documentation into EN

- Inventory: 15 docs in `de-press-docs/app` + 22 ADR + 6 at the root = **43 files** (~2.6k lines).
- First the glossary (Q6), then in batches: the root (README, PRIVACY, CONTEXT, MAINPLAN, PROGRESS) → the app docs → the ADR.
- Format: EN replaces RU (resolved Q6-A); before the translation the RU versions are copied to `docs-ru-archive/` at the project root, the folder is in `.gitignore`.

## P4. The full retest

- **Backend** (in chunks, a ~30s runner timeout): therapy, fund, identity, common+notifications, dialogue, ai, empathy+moderation, support, stories.
- **Frontend:** browser vitest 64 + tsc + build; the mini-app build.
- **The smoke matrix** for the manual check (P6): anti-panic · feed+clouds · quiet phrases · dialogue+voice+circles · help human/AI · helper (the queue, duty, invites) · the ZK patterns · notifications+`/inbox` · the fund (the wallet/banner/report) · the admin (the auth 403s, the aggregates without the content, the report resolution + the mandatory reason, the moderation log) · therapy (invite → catalog → session → QR → "I paid" → confirmation → dialogue) · the i18n switch · all the same in the Mini App inside Telegram.

- ✅ The automated part is done (2026-08-30): backend 233/233 in chunks, browser vitest 64/64, both vite builds green. The smoke matrix below — P6 (manual, owner = human).

## P5. The helper dashboard — ✅ done (2026-08-30)

- A left tab (browser), visible to `is_helper` only (staff are Helpers: `is_staff ⇒ is_helper`); the existing `/helper` (HelperQueue) evolves into the dashboard.
- The v1 composition: a live request queue over a WS channel from the start (Q4; the notifications-WS pattern), "take" → opening the dialogue (the call button is already in the dialogue), the duty status (the existing toggle), the summary (the existing one), the metrics from Q8.
- A user starting a conversation with a helper already works via a help request; no direct calls (Q7).
- The design by the DESIGN_V2 tokens; backend tests for new endpoints, if any appear.

## P7. The admin dashboard + the moderation/reports workflow — new (2026-08-31)

- A separate Vite app `apps/admin` (staff-only; the owner's decision — Vite, Q11): the same backend session auth, 403 for everyone else, the admin code never ships to the regular users.
- The overview: **aggregates only** — new visitors per 24h/7d (the `identity.Visitor` count; no IPs, no fingerprints, no per-visitor lists), the public stories total + per 7d, the hear-gestures, the dialogues opened/closed (counts), the therapy sessions by status, the help queue (the Q8 metrics), the pending clouds, the reports by status/reason. No content, no identifiers.
- The reports workflow (the foundation exists: `Report` — story|message, the reasons abuse/spam/self_harm/other, the statuses, the submit endpoints): the staff queue `GET /admin/reports`, `POST /admin/reports/{id}/resolve` — the decision (hide | remove | dismiss) + the **mandatory reason** + a note; applies `Story.status` hidden/removed (the hide is the default and reversible) or hides the reported message; writes the `ModerationAction` audit log (who/what/why/when); notifies the reporter without the other party's data.
- The moderator sees **only the reported item** (the preview + the minimal context), never the arbitrary browsing of others' content; the reporter/target identities are not exposed (Q12).
- The helpers get the reports **visibility** in `/helper` (the recent reports from the existing `GET /moderation/dashboard`), view-only, no actions.
- Out of scope (moved after the launch): the pre-mod / AI-assist for the reports; Geo-help v2.

## P6. Manual QA

The readiness criteria: P1–P7 are closed, the P4 smoke matrix is done, the known limitations are recorded in PROGRESS. Next — the pilot (pilot ops in the ROADMAP).
