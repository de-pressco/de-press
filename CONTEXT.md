# de-press.co

Empathetic, non-commercial mental health safe haven: quiet monologues, silent empathy, optional identity, and client-only personal memory.

## Language

**Visitor**:
A person on the site without a linked Account. May read Stories, offer Silent Empathy, and enter Anti-Panic Protocol.
_Avoid_: guest, anonymous user (as a catch-all for every unauthenticated state)

**Account**:
Optional registration (email + password). Grants stable ownership of Stories and the right to start Initiated Dialogue.
_Avoid_: User (overloaded with Django's `User`), profile-as-identity

**Pseudonym**:
Public display name shown on Stories and dialogues. Not a unique login identifier.
_Avoid_: username, nickname (when meaning login credentials)

**Actor**:
The resolved subject of an action: either an Account or an AnonymousSession. Services accept Actor, not raw request objects.
_Avoid_: current user, requester (vague)

**AnonymousSession**:
Server-side identity for a Visitor who has interacted (cookie-bound UUID). Used to own Stories and de-duplicate Silent Empathy without an Account.
_Avoid_: anonymous user, guest session (ambiguous with HTTP session alone)

**Story** (Safe Monologue):
A text monologue published without public comments. Authored by an Account or an AnonymousSession.
_Avoid_: post, tweet, entry, article

> Naming note: API routes under `/stories/{id}/comments…` and the `post_id`
> key implement the author-only continuation of a Story (support replies /
> initiated dialogue), not a public comment feed. The `comments`/`post_id`
> names are kept for API stability; renaming is a breaking API change
> (deferred). Never use *post* in UI copy.

**Feed**:
The public, time-ordered list of published Stories (Safe Monologues) a Visitor sees on `/feed`, filterable by Story Topic. A monologue-only surface: no comments, likes, or engagement counters. Distinct from the private Inbox and from any author-private aggregate.
_Avoid_: timeline (as a social-media feed with engagement), newsfeed

**Silent Empathy**:
The signal "I hear you" from a Hearer to a Story. No likes, no public counters, no public who-lists.
_Avoid_: like, reaction, upvote, kudos

**Hearer**:
An Actor who offered Silent Empathy on a Story.
_Avoid_: liker, follower, fan

**Hearer List**:
Author-only list of Hearers for a Story (opaque ids + display pseudonym). Never shown publicly.
_Avoid_: public engagers list, social proof bar

**Empathy Pulse**:
Author-private aggregate: how many people sat with the Story silently. Never a public counter.
_Avoid_: view count, engagement metric, popularity score

**Quiet Phrase**:
A curated safe template sentence a Hearer can send as a private Support Cloud in one click, without moderation.
_Avoid_: reaction emoji, sticker like, canned comment (public)

**Support Cloud**:
A private support note attached to a Story. Never public. The author does not see a list or count of clouds; the only signal is a quiet gesture on their own Feed row (latest unread Quiet Phrase). Opening the Story marks it read. The story page stays a monologue.
_Avoid_: comment, reply, public thread, reaction showcase, author cloud inbox

**Moderated Cloud**:
A Support Cloud with free-form text that stays pending until a Helper approves it.
_Avoid_: public comment awaiting review

**Helper**:
A verified volunteer or partner-org listener with elevated trust (queue moderation, optional badge to the author only). Besides cloud moderation, a Helper may accept Help Requests from `/chat` (grey rows). Still not a clinician.
_Avoid_: therapist (medical claim), admin (ops role only)

**Help Request**:
A Visitor or Account asking from `/help` to talk with a Helper. Not tied to a Story. Lives in a shared pending pool until a Helper accepts (opens Initiated Dialogue with source `help`) or the requester cancels. Helpers may skip a request for themselves without rejecting it for others.
_Avoid_: ticket, crisis hotline inside the app, open matching

**Author Outreach**:
The Story author starting Initiated Dialogue toward a Hearer (chosen or random), without the Hearer having sent a DialogueRequest first.
_Avoid_: cold DM to strangers, open inbox

**Anti-Panic Protocol**:
Global high-priority emergency UI mode that severs realtime connections, hides feeds/analytics, and shows a minimal grounding canvas (e.g. 4-7-8 breathing).
_Avoid_: panic button, emergency mode (marketing labels)

**Initiated Dialogue**:
Anonymous 1-on-1 chat that can be started only by the Story author (after DialogueRequest accept or Author Outreach). Realtime via WebSocket when available.
_Avoid_: comment thread, open DM, public reply

**Zero-Knowledge Memory**:
Personal mood patterns and emotional maps that live only in the user's device storage (IndexedDB). The server never receives raw thoughts or emotional maps.
_Avoid_: user analytics profile, server-side mood history

**Report**:
A safety flag raised by an Actor about a Story (later: dialogue messages) for human moderation. Not a public downvote.
_Avoid_: dislike, downvote, flag as engagement

**Block**:
An Actor's choice to hide another Actor's Stories and refuse Dialogue with them.
_Avoid_: ban (moderation action), mute (temporary UI only)

**Story Topic**:
A fixed theme label on a Story for gentle Feed filtering (not free-form tags).
_Avoid_: hashtag, category free-text

**Dialogue Request**:
A reader's ask to connect over a Story. Only the Story author may accept and open Dialogue.
_Avoid_: comment, unsolicited DM

**Dialogue Intent**:
Why a dialogue is requested: listen, share experience, advice ok, or mutual stories.
_Avoid_: chat purpose (vague)

**Quiet Companion**:
Optional labeled AI support chat proxied by the server. Validates feelings; does not diagnose or perform toxic positivity.
_Avoid_: chatbot therapist, virtual friend (implies human)

**Local Pattern Log**:
On-device mood notes used only for the person's self-awareness; never uploaded as an emotional map.
_Avoid_: clinical journal, server profile

**Notification**:
A private nudge to an Actor about a relevant event. The in-app inbox shows DialogueRequest, dialogue opened/deleted, outreach — not new chat messages and not Support Clouds (those live as unread on the chat list or as a feed-row gesture). A Notification row may still exist for live/digest plumbing; it is never displayed publicly. The bell pane is back (owner decision 2026-10-29): browser ships the tab, mini-app ships live toasts. Per-kind opt-out lives in `notify_kinds` on the identity (missing kind = enabled; the gate sits inside `notify()`, so it cuts WS, Telegram and email alike). Helper-only kinds: `help_requested`, `report_new` (duty-gated like help) and `dialogue_request_review`.
_Avoid_: bell counter as engagement metric, public notification feed, feed unread as vanity

**Inbox**:
A private web inbox reachable by a magic token from a soft-notify email, letting the recipient see their unread Notifications and open the relevant dialogue or `/me` without a password.
_Avoid_: public feed, email-as-password (it is a magic link)

**Soft-notify**:
An email/web digest nudge to the recipient (Account or AnonymousSession) about unread private events, gated by opt-in and digest frequency. Uses a magic token; never public.
_Avoid_: spam newsletter, public notification feed

**Circle** (video circle):
A short video message inside an initiated Dialogue, recorded in the browser. Circles are ephemeral by design: they are deleted when the dialogue is closed.
_Avoid_: public video post, permanent gallery

**Ephemeral Voice Note**:
A voice note whose lifetime is a user setting — either deleted when the dialogue closes or kept (configurable per user). Companion concept to Circles.
_Avoid_: permanent recording by default without consent, public voice post

**Native Dynamic Multilingual**:
The product translates everything a user sees into their native language — text messages and voice notes alike — via STT → translate → TTS. Not a UI dictionary; a real dynamic content translation so a depressed Japanese person can talk to a Kyrgyz one, the Kyrgyz to a French one, the French to a Chinese one, and the Chinese to a Brazilian.
_Avoid_: hardcoded UI dictionaries as "multilingual", server-side trauma maps

**App Host**:
A runtime surface that runs the same de-press **UI Core** and talks to the same backend. There are exactly four: **Browser**, **Telegram Mini App**, **Own Desktop**, and **Own Mobile**. Hosts differ in packaging, auth entry, and OS chrome — not in domain rules.
_Avoid_: separate product per platform, "mobile = only Mini App"

**UI Core**:
The shared SPA kernel (`apps/web/`: React features, design tokens, API/WS clients, i18n) reused by every App Host. Browser is the first host; Mini App, own desktop, and own mobile wrap or embed the same core.
_Avoid_: forking four unrelated frontends, copying GPL Telegram client code into the core

**Telegram Mini App Host**:
de-press running inside Telegram’s WebView (Bot + Mini App): seamless `initData` auth, theme/chrome integration, optional bot soft-notify. A full App Host and an important stage — **not** a replacement for Own Mobile or Own Desktop, and **not** the transport for Initiated Dialogue or Safe Monologues (those stay on the de-press backend).
_Avoid_: "Telegram is our only app", using Bot/MTProto chats as the primary dialogue store
