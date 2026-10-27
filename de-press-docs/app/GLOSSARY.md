# Glossary — canonical EN terms

Fixed before the docs translation (OPEN_QUESTIONS Q6). EN is canonical; the
pre-translation RU versions live in `docs-ru-archive/` (gitignored).

| RU (archive) | EN (canonical) | Notes |
|---|---|---|
| хелпер | helper | Role helping people on duty; UI copy never says «волонтёр» (ADR-0010 keeps the descriptive EN "verified volunteer") |
| слушатель /heard | hearer | Account connected via `hearers` (outreach) |
| облако / support-облако | support cloud | Anonymous support entry (ADR-0008) |
| тихие фразы | quiet phrases | Anti-panic silent phrase triggers |
| «мне хуёво» | "I'm not ok" | The canonical quiet phrase, kept in quotes |
| кружочки | video circles / circles | Short ephemeral video messages (`kind: "circle"`) |
| казна | treasury | Public Squads multisig fund address (ADR-0020) |
| кошелёк чаевых | tip wallet | Helper's opt-in Solana address for thanks |
| дежурство / на дежурстве | duty / on duty | Helper availability toggle (`is_on_duty`, helper-duty) |
| фонд дежурных | duty fund (Fund) | DutySegment ledger + public report |
| запрос помощи | help request | `HelpRequest` in the human help queue |
| антипаника | Anti-Panic | Emergency kill-switch feature |
| сочувствие | empathy | Automated empathy replies (ADR-0004) |
| утешение/поддержка AI | AI support | LLM support dialogue (no lives at stake) |
| мысль | thought | Feed entry (anonymous or named) |
| выговориться / излить | venting | The feed's purpose; UI label context |
| исходящие / аутрич | outreach | Author → hearers initiations (ADR-0009) |
| диалог | dialogue | 1:1 ephemeral chat (`Dialogue`, WS) |
| инвайты | invites | Helper invite links (therapist invites live in ADR-0022) |
| терапевт | therapist | Paid sessions contour (ADR-0022) |
| сессия терапии | therapy session | `TherapySession` with manual payment confirm |
| Solana Pay QR | Solana Pay QR | Keep as is; direct client→therapist transfer |
| МиниАпп / мини-апп | Mini App | Telegram Mini App (`apps/mini-app`) |
| браузер-SPA | browser SPA | `apps/browser` PWA |
| оболочка / шелл | shell | TG-native UI shell (TG_SHELL_SPEC) |
| дежурный отчёт | duty report | `GET /v1/fund/report?period=YYYY-MM` |
| подписанты | signers | Squads multisig signers |
| я оплатил | "I paid" | Therapy `i-paid` action |
| живой звонок | live call | 1:1 WebRTC voice in dialogue (ADR-0021) |
| ретест | retest | Full manual checklist pass (P4/P6) |
