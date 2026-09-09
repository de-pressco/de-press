"""Deep dialogue module: request → accept → messages; Author Outreach."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.common.rate_limit import RateLimitExceeded, assert_under_limit
from apps.empathy.services import (
    EmpathyError,
    actor_from_hearer_ref,
    eligible_hearers_for_outreach,
    get_empathy_for_hearer,
    hearer_ref_for_empathy,
)
from apps.identity.models import Account, VoiceRetention
from apps.identity.services import Actor
from apps.moderation.blocks import is_blocked_between
from apps.notifications.models import NotificationKind
from apps.notifications.services import notify
from apps.dialogue.models import (
    Dialogue,
    DialogueIntent,
    DialogueRequest,
    DialogueRequestStatus,
    DialogueSource,
    DialogueStatus,
    Message,
    MessageHide,
    MessageKind,
)
from apps.stories.models import Story
from apps.stories.services import StoryNotFound, get_story, is_author

OUTREACH_LIMIT = 20
OUTREACH_WINDOW_SECONDS = 3600
VOICE_MAX_BYTES = 5 * 1024 * 1024  # 5 MiB
VOICE_MAX_DURATION_MS = 120_000  # 2 minutes
VOICE_LIMIT = 20
VOICE_WINDOW_SECONDS = 3600
CIRCLE_MAX_BYTES = 20 * 1024 * 1024  # 20 MiB
CIRCLE_MAX_DURATION_MS = 60_000  # 60 s
CIRCLE_LIMIT = 20
CIRCLE_WINDOW_SECONDS = 3600


class DialogueError(Exception):
    pass


RULES_TEXT = (
    "Short rules: do not push advice unless asked; "
    "do not invalidate; do not dox; you may leave at any moment; "
    "this is not therapy and not emergency help."
)

OUTREACH_INTRO = (
    "[system] The story author wrote to you because you marked "
    '"I hear you". You can reply or leave — no obligations.'
)


@dataclass(frozen=True, slots=True)
class OutreachResult:
    dialogues: list[Dialogue]
    created_count: int
    reused_count: int


def _peer_actor_from_request(req: DialogueRequest) -> Actor:
    if req.from_account_id:
        return Actor(kind="account", account=req.from_account)
    return Actor(kind="anonymous", session=req.from_session)


def _other_participant_actor(d: Dialogue, actor: Actor) -> Actor | None:
    """Resolve the other participant of a dialogue as an Actor."""
    if actor.account is not None:
        if d.author_account_id == actor.account.id:
            if d.peer_account_id:
                return Actor(kind="account", account=d.peer_account)
            if d.peer_session_id:
                return Actor(kind="anonymous", session=d.peer_session)
            return None
        if d.peer_account_id == actor.account.id:
            if d.author_account_id:
                return Actor(kind="account", account=d.author_account)
            if d.author_session_id:
                return Actor(kind="anonymous", session=d.author_session)
            return None
    if actor.session is not None:
        if d.author_session_id == actor.session.id:
            if d.peer_account_id:
                return Actor(kind="account", account=d.peer_account)
            if d.peer_session_id:
                return Actor(kind="anonymous", session=d.peer_session)
            return None
        if d.peer_session_id == actor.session.id:
            if d.author_account_id:
                return Actor(kind="account", account=d.author_account)
            if d.author_session_id:
                return Actor(kind="anonymous", session=d.author_session)
            return None
    return None


def _is_dialogue_author(dialogue: Dialogue, actor: Actor) -> bool:
    if actor.account and dialogue.author_account_id == actor.account.id:
        return True
    if actor.session and dialogue.author_session_id == actor.session.id:
        return True
    return False


def _hidden_for(dialogue: Dialogue, actor: Actor) -> bool:
    if _is_dialogue_author(dialogue, actor):
        return bool(dialogue.hidden_for_author)
    if _is_participant(dialogue, actor):
        return bool(dialogue.hidden_for_peer)
    return False


def _side(dialogue: Dialogue, actor: Actor) -> Literal["author", "peer"]:
    if _is_dialogue_author(dialogue, actor):
        return "author"
    if not _is_participant(dialogue, actor):
        raise DialogueError("Not a participant")
    return "peer"


def _pinned_at(dialogue: Dialogue, actor: Actor):
    return (
        dialogue.pinned_at_author
        if _side(dialogue, actor) == "author"
        else dialogue.pinned_at_peer
    )


def _is_muted(dialogue: Dialogue, actor: Actor) -> bool:
    if _is_dialogue_author(dialogue, actor):
        return bool(dialogue.muted_author)
    if _is_participant(dialogue, actor):
        return bool(dialogue.muted_peer)
    return False


def unread_count_for(dialogue: Dialogue, actor: Actor) -> int:
    side = _side(dialogue, actor)
    forced = (
        dialogue.unread_forced_author
        if side == "author"
        else dialogue.unread_forced_peer
    )
    last = (
        dialogue.last_read_at_author
        if side == "author"
        else dialogue.last_read_at_peer
    )
    qs = dialogue.messages.filter(deleted_at__isnull=True).exclude(
        from_account__isnull=True, from_session__isnull=True
    )
    if actor.account:
        qs = qs.exclude(from_account=actor.account)
    elif actor.session:
        qs = qs.exclude(from_session=actor.session)
    if last is not None:
        qs = qs.filter(created_at__gt=last)
    n = qs.count()
    return max(n, 1) if forced else n


def _notify_peer_message(dialogue: Dialogue, other: Actor | None, msg: Message) -> None:
    """Chat unread lives on the thread list / chat rail, not the inbox."""
    return


def _abandoned(dialogue: Dialogue) -> bool:
    """Either side deleted this thread — it cannot be revived."""
    return bool(dialogue.hidden_for_author or dialogue.hidden_for_peer)


def _is_closer(dialogue: Dialogue, actor: Actor) -> bool:
    if dialogue.closed_by_account_id:
        return bool(actor.account and actor.account.id == dialogue.closed_by_account_id)
    if dialogue.closed_by_session_id:
        return bool(actor.session and actor.session.id == dialogue.closed_by_session_id)
    # Legacy rows without a recorded closer: either participant may reopen.
    return _is_participant(dialogue, actor)


def _is_participant(dialogue: Dialogue, actor: Actor) -> bool:
    if actor.account:
        if dialogue.author_account_id == actor.account.id:
            return True
        if dialogue.peer_account_id == actor.account.id:
            return True
    if actor.session:
        if dialogue.author_session_id == actor.session.id:
            return True
        if dialogue.peer_session_id == actor.session.id:
            return True
    return False


def _find_open_dialogue(story: Story, peer: Actor) -> Dialogue | None:
    q = Q(story=story, status=DialogueStatus.OPEN)
    if peer.account is not None:
        q &= Q(peer_account=peer.account)
    elif peer.session is not None:
        q &= Q(peer_session=peer.session)
    else:
        return None
    return (
        Dialogue.objects.filter(q, hidden_for_author=False, hidden_for_peer=False)
        .first()
    )


def _create_dialogue(
    *,
    story: Story,
    peer: Actor,
    intent: str,
    source: str,
    request: DialogueRequest | None = None,
    intro_body: str | None = None,
) -> Dialogue:
    dialogue = Dialogue.objects.create(
        story=story,
        request=request,
        source=source,
        author_account=story.author_account,
        author_session=story.author_session,
        peer_account=peer.account,
        peer_session=peer.session if peer.account is None else None,
        intent=intent,
        status=DialogueStatus.OPEN,
    )
    Message.objects.create(
        dialogue=dialogue,
        body=f"[rules] {RULES_TEXT}",
        from_account=None,
        from_session=None,
    )
    if intro_body:
        Message.objects.create(
            dialogue=dialogue,
            body=intro_body,
            from_account=None,
            from_session=None,
        )
    return dialogue


@transaction.atomic
def create_request(
    actor: Actor,
    story_id: UUID,
    *,
    intent: str,
    note: str = "",
) -> DialogueRequest:
    if intent not in DialogueIntent.values:
        raise DialogueError("Invalid intent")
    if actor.account is None and actor.session is None:
        raise DialogueError("No identity")

    story = get_story(story_id, for_public=True)
    if story.parent_id:
        raise DialogueError("Requests apply to stories only")
    if is_author(story, actor):
        raise DialogueError("You cannot request a dialogue on your own story")

    author = Actor(
        kind="account" if story.author_account_id else "anonymous",
        account=story.author_account,
        session=story.author_session,
    )
    if is_blocked_between(actor, author):
        raise DialogueError("Dialogue unavailable")

    note_s = (note or "").strip()[:280]
    # One request per sender per story — no matter its outcome (pending,
    # accepted, declined): a second request would only re-open the first one.
    sent_q = Q(story=story)
    if actor.account is not None:
        sent_q &= Q(from_account=actor.account)
    else:
        sent_q &= Q(from_session=actor.session)
    if DialogueRequest.objects.filter(sent_q).exists():
        raise DialogueError("Request already sent")

    try:
        req = DialogueRequest.objects.create(
            story=story,
            from_account=actor.account,
            from_session=None if actor.account is not None else actor.session,
            intent=intent,
            note=note_s,
            status=DialogueRequestStatus.PENDING,
        )
    except IntegrityError as exc:
        raise DialogueError("Request already sent") from exc

    _notify_author_dialogue_request(req)
    return req


def _is_helper(actor: Actor) -> bool:
    if actor.account is None:
        return False
    return bool(
        actor.account.is_helper
        or actor.account.is_staff
        or actor.account.is_superuser
    )


def list_review_inbox(actor: Actor) -> list[DialogueRequest]:
    """Legacy Helper review inbox. New requests skip this gate."""
    acc = actor.account
    if not (
        acc is not None and acc.is_helper and acc.is_on_duty and acc.is_active
    ):
        return []
    return list(
        DialogueRequest.objects.filter(status=DialogueRequestStatus.AWAITING_HELPER)
        .select_related("story", "from_account", "from_session")
        .order_by("-created_at")
    )


@transaction.atomic
def approve_dialogue_request(actor: Actor, request_id: UUID) -> DialogueRequest:
    if not _is_helper(actor):
        raise DialogueError("Only a Helper can review dialogue requests")
    try:
        req = (
            DialogueRequest.objects.select_for_update(of=("self",))
            .select_related("story", "from_account", "from_session")
            .get(pk=request_id)
        )
    except DialogueRequest.DoesNotExist as exc:
        raise DialogueError("Request not found") from exc
    if req.status != DialogueRequestStatus.AWAITING_HELPER:
        raise DialogueError("Request is not awaiting review")
    req.status = DialogueRequestStatus.PENDING
    req.save(update_fields=["status", "updated_at"])
    _notify_author_dialogue_request(req)
    return req


def _notify_author_dialogue_request(req: DialogueRequest) -> None:
    story = req.story
    author = Actor(
        kind="account" if story.author_account_id else "anonymous",
        account=story.author_account,
        session=story.author_session,
    )
    notify(
        author,
        NotificationKind.DIALOGUE_REQUEST,
        {
            "story_id": str(story.id),
            "request_id": str(req.id),
            "intent": req.intent,
        },
    )


@transaction.atomic
def reject_dialogue_request(actor: Actor, request_id: UUID) -> DialogueRequest:
    if not _is_helper(actor):
        raise DialogueError("Only a Helper can review dialogue requests")
    try:
        req = DialogueRequest.objects.select_for_update(of=("self",)).get(
            pk=request_id
        )
    except DialogueRequest.DoesNotExist as exc:
        raise DialogueError("Request not found") from exc
    if req.status != DialogueRequestStatus.AWAITING_HELPER:
        raise DialogueError("Request is not awaiting review")
    req.status = DialogueRequestStatus.DECLINED
    req.save(update_fields=["status", "updated_at"])
    return req


def list_inbox(actor: Actor) -> list[DialogueRequest]:
    """Pending requests on stories authored by actor."""
    q = Q(status=DialogueRequestStatus.PENDING)
    if actor.account:
        q &= Q(story__author_account=actor.account)
    elif actor.session:
        q &= Q(story__author_session=actor.session)
    else:
        return []
    return list(
        DialogueRequest.objects.filter(q)
        .select_related("story", "from_account", "from_session")
        .order_by("-created_at")
    )


@transaction.atomic
def accept_request(actor: Actor, request_id: UUID) -> Dialogue:
    try:
        req = (
            DialogueRequest.objects.select_for_update(of=("self",))
            .select_related("story", "from_account", "from_session")
            .get(pk=request_id)
        )
    except DialogueRequest.DoesNotExist as exc:
        raise DialogueError("Request not found") from exc

    if req.status != DialogueRequestStatus.PENDING:
        raise DialogueError("Request is not pending")

    story = req.story
    if not is_author(story, actor):
        raise DialogueError("Only the author can open dialogue")

    peer = _peer_actor_from_request(req)
    if is_blocked_between(actor, peer):
        raise DialogueError("Dialogue unavailable")

    req.status = DialogueRequestStatus.ACCEPTED
    req.save(update_fields=["status", "updated_at"])

    existing = _find_open_dialogue(story, peer)
    if existing is not None:
        return existing

    dialogue = _create_dialogue(
        story=story,
        peer=peer,
        intent=req.intent,
        source=DialogueSource.REQUEST,
        request=req,
    )
    notify(
        peer,
        NotificationKind.DIALOGUE_OPENED,
        {"dialogue_id": str(dialogue.id), "story_id": str(story.id)},
    )
    return dialogue


@transaction.atomic
def decline_request(actor: Actor, request_id: UUID) -> DialogueRequest:
    try:
        req = DialogueRequest.objects.select_for_update().select_related("story").get(
            pk=request_id
        )
    except DialogueRequest.DoesNotExist as exc:
        raise DialogueError("Request not found") from exc
    if not is_author(req.story, actor):
        raise DialogueError("Only the author can decline")
    if req.status != DialogueRequestStatus.PENDING:
        raise DialogueError("Request is not pending")
    req.status = DialogueRequestStatus.DECLINED
    req.save(update_fields=["status", "updated_at"])
    return req


def list_my_dialogues(actor: Actor) -> list[Dialogue]:
    q = Q()
    if actor.account:
        q |= Q(author_account=actor.account) | Q(peer_account=actor.account)
    if actor.session:
        q |= Q(author_session=actor.session) | Q(peer_session=actor.session)
    if not q:
        return []
    hide = Q()
    if actor.account:
        hide |= Q(author_account=actor.account, hidden_for_author=True)
        hide |= Q(peer_account=actor.account, hidden_for_peer=True)
    if actor.session:
        hide |= Q(author_session=actor.session, hidden_for_author=True)
        hide |= Q(peer_session=actor.session, hidden_for_peer=True)
    qs = Dialogue.objects.filter(q)
    if hide:
        qs = qs.exclude(hide)
    rows = list(
        qs.select_related(
            "story",
            "author_account",
            "author_session",
            "peer_account",
            "peer_session",
            "closed_by_account",
            "closed_by_session",
        )
        .prefetch_related("messages")
        .order_by("-updated_at")
    )

    def _sort_key(d: Dialogue) -> tuple[int, float]:
        pin = _pinned_at(d, actor)
        if pin is not None:
            return (0, -pin.timestamp())
        return (1, -d.updated_at.timestamp())

    rows.sort(key=_sort_key)
    return rows


def dialogue_peer_label(d: Dialogue, actor: Actor) -> str:
    other = _other_participant_actor(d, actor)
    if other is not None:
        return other.display_pseudonym
    return d.intent


def dialogue_last_preview(d: Dialogue) -> str:
    last = None
    if hasattr(d, "_prefetched_objects_cache") and "messages" in d._prefetched_objects_cache:
        msgs = d.messages.all()
        last = max(msgs, key=lambda m: m.created_at, default=None) if msgs else None
    else:
        last = d.messages.order_by("-created_at").first()
    if last is None:
        return ""
    return (last.display_text or "")[:80]


def get_dialogue_for_participant(actor: Actor, dialogue_id: UUID) -> Dialogue:
    try:
        d = Dialogue.objects.select_related("story").get(pk=dialogue_id)
    except Dialogue.DoesNotExist as exc:
        raise DialogueError("Dialogue not found") from exc
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    if _hidden_for(d, actor):
        raise DialogueError("Dialogue not found")
    return d


def list_messages(actor: Actor, dialogue_id: UUID) -> list[Message]:
    d = get_dialogue_for_participant(actor, dialogue_id)
    hide_q = Q()
    if actor.account:
        hide_q |= Q(account=actor.account)
    if actor.session:
        hide_q |= Q(session=actor.session)
    hidden_ids = (
        MessageHide.objects.filter(hide_q, message__dialogue=d).values_list(
            "message_id", flat=True
        )
        if hide_q
        else []
    )
    return list(
        d.messages.exclude(id__in=hidden_ids).select_related("reply_to")
    )


@transaction.atomic
def send_message(
    actor: Actor,
    dialogue_id: UUID,
    body: str,
    *,
    source_lang: str = "ru",
    reply_to_id: UUID | None = None,
) -> Message:
    text = body.strip()
    if not text:
        raise DialogueError("Empty message")
    if len(text) > 4000:
        raise DialogueError("Message too long")

    # of=("self",): story is nullable (Help); Postgres forbids FOR UPDATE on outer join NULL side
    d = Dialogue.objects.select_for_update(of=("self",)).get(pk=dialogue_id)
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    if _hidden_for(d, actor) or _abandoned(d):
        raise DialogueError("Dialogue is closed")
    if d.status != DialogueStatus.OPEN:
        raise DialogueError("Dialogue is closed")

    lang = (source_lang or "ru")[:8].lower() or "ru"
    reply = _resolve_reply(d, actor, reply_to_id)
    msg = Message.objects.create(
        dialogue=d,
        kind=MessageKind.TEXT,
        body=text,
        source_lang=lang,
        reply_to=reply,
        from_account=actor.account,
        from_session=actor.session if actor.account is None else None,
    )
    d.updated_at = timezone.now()
    d.save(update_fields=["updated_at"])
    from apps.dialogue.realtime import broadcast_chat_message

    transaction.on_commit(lambda: broadcast_chat_message(dialogue_id, msg))
    _notify_peer_message(d, _other_participant_actor(d, actor), msg)
    return msg


def _is_msg_author(msg: Message, actor: Actor) -> bool:
    if actor.account and msg.from_account_id == actor.account.id:
        return True
    if actor.session and msg.from_session_id == actor.session.id:
        return True
    return False


def _resolve_reply(
    dialogue: Dialogue, actor: Actor, reply_to_id: UUID | None
) -> Message | None:
    if reply_to_id is None:
        return None
    try:
        reply = Message.objects.get(pk=reply_to_id, dialogue=dialogue)
    except Message.DoesNotExist as exc:
        raise DialogueError("Message to reply to not found") from exc
    if reply.deleted_at:
        raise DialogueError("Cannot reply to a deleted message")
    if actor.account:
        hidden = MessageHide.objects.filter(
            message=reply, account=actor.account
        ).exists()
    elif actor.session:
        hidden = MessageHide.objects.filter(
            message=reply, session=actor.session
        ).exists()
    else:
        hidden = False
    if hidden:
        raise DialogueError("Message to reply to not found")
    return reply


def _get_live_message(actor: Actor, message_id: UUID) -> tuple[Message, Dialogue]:
    try:
        msg = Message.objects.select_related("dialogue", "reply_to").get(pk=message_id)
    except Message.DoesNotExist as exc:
        raise DialogueError("Message not found") from exc
    d = get_dialogue_for_participant(actor, msg.dialogue_id)
    return msg, d


@transaction.atomic
def edit_message(actor: Actor, message_id: UUID, body: str) -> Message:
    text = body.strip()
    if not text:
        raise DialogueError("Empty message")
    if len(text) > 4000:
        raise DialogueError("Message too long")
    msg, d = _get_live_message(actor, message_id)
    if _abandoned(d) or d.status != DialogueStatus.OPEN:
        raise DialogueError("Dialogue is closed")
    if not _is_msg_author(msg, actor):
        raise DialogueError("You can edit only your own messages")
    if msg.kind != MessageKind.TEXT or msg.deleted_at:
        raise DialogueError("This cannot be edited")
    msg.body = text
    msg.edited_at = timezone.now()
    msg.save(update_fields=["body", "edited_at"])
    from apps.dialogue.realtime import broadcast_message_edited

    transaction.on_commit(lambda: broadcast_message_edited(d.id, msg))
    return msg


def _scrub_message(msg: Message, *, when=None) -> None:
    if msg.audio:
        msg.audio.delete(save=False)
        msg.audio = None
    if msg.video:
        msg.video.delete(save=False)
        msg.video = None
    msg.body = ""
    msg.transcript = ""
    msg.deleted_at = when or timezone.now()
    msg.save(update_fields=["body", "transcript", "audio", "video", "deleted_at"])


@transaction.atomic
def delete_message_for_everyone(actor: Actor, message_id: UUID) -> Message:
    msg, d = _get_live_message(actor, message_id)
    if msg.deleted_at:
        return msg
    _scrub_message(msg)
    if d.pinned_message_id == msg.id:
        d.pinned_message = None
        d.save(update_fields=["pinned_message"])
    from apps.dialogue.realtime import broadcast_message_deleted

    transaction.on_commit(lambda: broadcast_message_deleted(d.id, msg))
    return msg


@transaction.atomic
def moderator_scrub_message(message_id: UUID) -> Message | None:
    """Moderator (staff) removes a reported message for everyone (Q12).

    Same scrub path as `delete_message_for_everyone`, but without the
    participant check — staff report moderation only.
    """
    try:
        msg = Message.objects.select_related("dialogue").get(pk=message_id)
    except Message.DoesNotExist:
        return None
    if msg.deleted_at:
        return msg
    _scrub_message(msg)
    d = msg.dialogue
    if d.pinned_message_id == msg.id:
        d.pinned_message = None
        d.save(update_fields=["pinned_message"])
    from apps.dialogue.realtime import broadcast_message_deleted

    transaction.on_commit(lambda: broadcast_message_deleted(d.id, msg))
    return msg


@transaction.atomic
def hide_message_for_me(actor: Actor, message_id: UUID) -> None:
    msg, _d = _get_live_message(actor, message_id)
    defaults = {
        "account": actor.account,
        "session": actor.session if actor.account is None else None,
    }
    MessageHide.objects.get_or_create(
        message=msg,
        account=actor.account if actor.account else None,
        session=actor.session if actor.account is None else None,
        defaults=defaults,
    )


@transaction.atomic
def forward_message(
    actor: Actor, message_id: UUID, target_dialogue_id: UUID
) -> Message:
    src, src_d = _get_live_message(actor, message_id)
    if src.deleted_at:
        raise DialogueError("Cannot forward a deleted message")
    if target_dialogue_id == src_d.id:
        raise DialogueError("Cannot forward into the same chat")
    dest = get_dialogue_for_participant(actor, target_dialogue_id)
    if dest.status != DialogueStatus.OPEN or _abandoned(dest):
        raise DialogueError("Dialogue is closed")
    preview = (src.display_text or "")[:280]
    dest_msg = Message(
        dialogue=dest,
        kind=src.kind,
        body=src.body if src.kind == MessageKind.TEXT else src.body,
        transcript=src.transcript,
        duration_ms=src.duration_ms,
        source_lang=src.source_lang,
        ephemeral=src.ephemeral,
        forwarded=True,
        forwarded_preview=preview,
        from_account=actor.account,
        from_session=actor.session if actor.account is None else None,
    )
    dest_msg.save()
    if src.audio:
        dest_msg.audio = src.audio
        dest_msg.save(update_fields=["audio"])
    if src.video:
        dest_msg.video = src.video
        dest_msg.save(update_fields=["video"])
    dest.updated_at = timezone.now()
    dest.save(update_fields=["updated_at"])
    from apps.dialogue.realtime import broadcast_chat_message

    transaction.on_commit(lambda: broadcast_chat_message(dest.id, dest_msg))
    _notify_peer_message(dest, _other_participant_actor(dest, actor), dest_msg)
    return dest_msg


@transaction.atomic
def pin_message(actor: Actor, message_id: UUID) -> Dialogue:
    msg, d = _get_live_message(actor, message_id)
    if d.status != DialogueStatus.OPEN or _abandoned(d):
        raise DialogueError("Dialogue is closed")
    if msg.deleted_at:
        raise DialogueError("Cannot pin a deleted message")
    d.pinned_message = msg
    d.save(update_fields=["pinned_message", "updated_at"])
    from apps.dialogue.realtime import broadcast_dialogue_pinned

    transaction.on_commit(lambda: broadcast_dialogue_pinned(d))
    return d


@transaction.atomic
def unpin_message(actor: Actor, dialogue_id: UUID) -> Dialogue:
    d = get_dialogue_for_participant(actor, dialogue_id)
    if d.status != DialogueStatus.OPEN or _abandoned(d):
        raise DialogueError("Dialogue is closed")
    d.pinned_message = None
    d.save(update_fields=["pinned_message", "updated_at"])
    from apps.dialogue.realtime import broadcast_dialogue_pinned

    transaction.on_commit(lambda: broadcast_dialogue_pinned(d))
    return d


@transaction.atomic
def send_voice_message(
    actor: Actor,
    dialogue_id: UUID,
    *,
    uploaded_file,
    duration_ms: int | None = None,
    source_lang: str = "ru",
) -> Message:
    """Store a voice note, run STT, broadcast."""
    if actor.account is None and actor.session is None:
        raise DialogueError("No identity")

    # of=("self",): story is nullable (Help); Postgres forbids FOR UPDATE on outer join NULL side
    d = Dialogue.objects.select_for_update(of=("self",)).get(pk=dialogue_id)
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    if _hidden_for(d, actor) or _abandoned(d):
        raise DialogueError("Dialogue is closed")
    if d.status != DialogueStatus.OPEN:
        raise DialogueError("Dialogue is closed")

    size = getattr(uploaded_file, "size", 0) or 0
    if size <= 0:
        raise DialogueError("Empty audio file")
    if size > VOICE_MAX_BYTES:
        raise DialogueError("Voice note is too large (max 5 MB)")

    if duration_ms is not None and duration_ms > VOICE_MAX_DURATION_MS:
        raise DialogueError("Voice note is too long (max 2 min)")

    try:
        assert_under_limit(
            actor=actor,
            queryset=Message.objects.filter(kind=MessageKind.VOICE),
            account_field="from_account",
            session_field="from_session",
            limit=VOICE_LIMIT,
            window_seconds=VOICE_WINDOW_SECONDS,
        )
    except RateLimitExceeded as exc:
        raise DialogueError(str(exc)) from exc

    lang = (source_lang or "ru")[:8].lower() or "ru"
    # Pre-create with UUID so upload_to path is stable.
    msg = Message(
        dialogue=d,
        kind=MessageKind.VOICE,
        body="[voice note]",
        duration_ms=duration_ms,
        source_lang=lang,
        from_account=actor.account,
        from_session=actor.session if actor.account is None else None,
    )
    msg.save()  # assigns pk for upload path
    msg.audio = uploaded_file
    msg.save(update_fields=["audio"])

    d.updated_at = timezone.now()
    d.save(update_fields=["updated_at"])

    from apps.dialogue.realtime import broadcast_chat_message

    msg_id = msg.pk

    def _broadcast() -> None:
        try:
            fresh = Message.objects.get(pk=msg_id)
        except Message.DoesNotExist:
            return
        broadcast_chat_message(dialogue_id, fresh)

    transaction.on_commit(_broadcast)
    _notify_peer_message(d, _other_participant_actor(d, actor), msg)
    return msg


@transaction.atomic
def send_circle_message(
    actor: Actor,
    dialogue_id: UUID,
    *,
    uploaded_file,
    duration_ms: int | None = None,
    source_lang: str = "ru",
) -> Message:
    """Store an ephemeral circle video note and broadcast. No STT."""
    if actor.account is None and actor.session is None:
        raise DialogueError("No identity")

    # of=("self",): story is nullable (Help); Postgres forbids FOR UPDATE on outer join NULL side
    d = Dialogue.objects.select_for_update(of=("self",)).get(pk=dialogue_id)
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    if _hidden_for(d, actor) or _abandoned(d):
        raise DialogueError("Dialogue is closed")
    if d.status != DialogueStatus.OPEN:
        raise DialogueError("Dialogue is closed")

    size = getattr(uploaded_file, "size", 0) or 0
    if size <= 0:
        raise DialogueError("Empty video file")
    if size > CIRCLE_MAX_BYTES:
        raise DialogueError("Video circle is too large (max 20 MB)")

    if duration_ms is not None and duration_ms > CIRCLE_MAX_DURATION_MS:
        raise DialogueError("Video circle is too long (max 60 s)")

    try:
        assert_under_limit(
            actor=actor,
            queryset=Message.objects.filter(kind=MessageKind.CIRCLE),
            account_field="from_account",
            session_field="from_session",
            limit=CIRCLE_LIMIT,
            window_seconds=CIRCLE_WINDOW_SECONDS,
        )
    except RateLimitExceeded as exc:
        raise DialogueError(str(exc)) from exc

    lang = (source_lang or "ru")[:8].lower() or "ru"
    msg = Message(
        dialogue=d,
        kind=MessageKind.CIRCLE,
        body="[video circle]",
        duration_ms=duration_ms,
        source_lang=lang,
        ephemeral=True,
        from_account=actor.account,
        from_session=actor.session if actor.account is None else None,
    )
    msg.save()
    msg.video = uploaded_file
    msg.save(update_fields=["video"])

    d.updated_at = timezone.now()
    d.save(update_fields=["updated_at"])

    from apps.dialogue.realtime import broadcast_chat_message

    msg_id = msg.pk

    def _broadcast() -> None:
        try:
            fresh = Message.objects.get(pk=msg_id)
        except Message.DoesNotExist:
            return
        broadcast_chat_message(dialogue_id, fresh)

    transaction.on_commit(_broadcast)
    _notify_peer_message(d, _other_participant_actor(d, actor), msg)
    return msg


def translate_message(
    actor: Actor,
    message_id: UUID,
    *,
    target_lang: str,
) -> Message:
    """Translate message display text; cache on Message.translations."""
    try:
        msg = Message.objects.select_related("dialogue").get(pk=message_id)
    except Message.DoesNotExist as exc:
        raise DialogueError("Message not found") from exc
    get_dialogue_for_participant(actor, msg.dialogue_id)

    code = (target_lang or "en")[:8].lower()
    if not code:
        raise DialogueError("target_lang is required")
    if msg.kind == MessageKind.VOICE and not msg.transcript.strip():
        # Voice transcription is removed — there is no text to translate.
        raise DialogueError("Nothing to translate")

    source_text = msg.display_text
    if not source_text or source_text.startswith("["):
        # Still allow translating offline markers / body
        source_text = msg.body or msg.transcript or source_text
    if not source_text.strip():
        raise DialogueError("Nothing to translate")

    from apps.dialogue.speech import get_translator, is_stub_translation

    cached = dict(msg.translations or {})
    existing = (cached.get(code) or "").strip()
    if existing and not is_stub_translation(existing):
        return msg

    translator = get_translator()
    translated = translator.translate(
        source_text,
        target_lang=code,
        source_lang=msg.source_lang or "",
    )
    if not (translated or "").strip() or is_stub_translation(translated):
        if code in cached:
            cached.pop(code, None)
            msg.translations = cached
            msg.save(update_fields=["translations"])
        raise DialogueError("Translation is unavailable right now")

    cached[code] = translated
    msg.translations = cached
    msg.save(update_fields=["translations"])
    return msg


def _sender_voice_retention(msg: Message) -> str:
    if msg.from_account_id and msg.from_account is not None:
        return msg.from_account.voice_retention or VoiceRetention.DELETE_ON_CLOSE
    if msg.from_session_id and msg.from_session is not None:
        return msg.from_session.voice_retention or VoiceRetention.DELETE_ON_CLOSE
    return VoiceRetention.DELETE_ON_CLOSE


def purge_voice_on_close(dialogue: Dialogue) -> int:
    removed = 0
    qs = dialogue.messages.filter(kind=MessageKind.VOICE).select_related(
        "from_account", "from_session"
    )
    for msg in qs:
        if not msg.audio:
            continue
        if _sender_voice_retention(msg) != VoiceRetention.DELETE_ON_CLOSE:
            continue
        msg.audio.delete(save=False)
        msg.audio = None
        msg.save(update_fields=["audio"])
        removed += 1
    return removed


def purge_circle_videos(dialogue: Dialogue) -> int:
    """Delete circle video files. Returns number of files removed."""
    removed = 0
    qs = dialogue.messages.filter(kind=MessageKind.CIRCLE)
    for msg in qs:
        if not msg.video:
            continue
        msg.video.delete(save=False)
        msg.video = None
        msg.save(update_fields=["video"])
        removed += 1
    return removed


@transaction.atomic
def close_dialogue(actor: Actor, dialogue_id: UUID) -> Dialogue:
    d = Dialogue.objects.select_for_update().get(pk=dialogue_id)
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    if _hidden_for(d, actor):
        raise DialogueError("Dialogue not found")
    if d.status == DialogueStatus.CLOSED:
        return d
    d.status = DialogueStatus.CLOSED
    d.closed_at = timezone.now()
    d.closed_by_account = actor.account
    d.closed_by_session = actor.session if actor.account is None else None
    d.save(
        update_fields=[
            "status",
            "closed_at",
            "closed_by_account",
            "closed_by_session",
            "updated_at",
        ]
    )
    purge_circle_videos(d)
    purge_voice_on_close(d)
    from apps.dialogue.realtime import broadcast_dialogue_closed

    # capture pk for on_commit (object may be stale across threads)
    closed_pk = d.pk

    def _broadcast_closed() -> None:
        try:
            closed = Dialogue.objects.get(pk=closed_pk)
        except Dialogue.DoesNotExist:
            return
        broadcast_dialogue_closed(closed)

    transaction.on_commit(_broadcast_closed)
    return d


@transaction.atomic
def reopen_dialogue(actor: Actor, dialogue_id: UUID) -> Dialogue:
    from apps.moderation.blocks import is_blocked_between

    d = Dialogue.objects.select_for_update().get(pk=dialogue_id)
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    if _hidden_for(d, actor):
        raise DialogueError("Dialogue not found")
    if d.status != DialogueStatus.CLOSED:
        raise DialogueError("Dialogue is already open")
    if _abandoned(d):
        raise DialogueError("Dialogue deleted")
    if not _is_closer(d, actor):
        raise DialogueError("Only the one who closed it can reopen it")
    other = _other_participant_actor(d, actor)
    if other is not None and is_blocked_between(actor, other):
        raise DialogueError("Dialogue unavailable")
    d.status = DialogueStatus.OPEN
    d.closed_at = None
    d.closed_by_account = None
    d.closed_by_session = None
    d.save(
        update_fields=[
            "status",
            "closed_at",
            "closed_by_account",
            "closed_by_session",
            "updated_at",
        ]
    )
    from apps.dialogue.realtime import broadcast_dialogue_reopened

    opened_pk = d.pk

    def _broadcast_opened() -> None:
        try:
            opened = Dialogue.objects.get(pk=opened_pk)
        except Dialogue.DoesNotExist:
            return
        broadcast_dialogue_reopened(opened)

    transaction.on_commit(_broadcast_opened)
    return d


@transaction.atomic
def delete_dialogue_for_me(actor: Actor, dialogue_id: UUID) -> Dialogue:
    d = Dialogue.objects.select_for_update().get(pk=dialogue_id)
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    fields = ["updated_at"]
    if _is_dialogue_author(d, actor):
        d.hidden_for_author = True
        fields.append("hidden_for_author")
    else:
        d.hidden_for_peer = True
        fields.append("hidden_for_peer")
    if d.status != DialogueStatus.CLOSED:
        d.status = DialogueStatus.CLOSED
        d.closed_at = timezone.now()
        d.closed_by_account = actor.account
        d.closed_by_session = actor.session if actor.account is None else None
        fields.extend(
            ["status", "closed_at", "closed_by_account", "closed_by_session"]
        )
        purge_circle_videos(d)
        purge_voice_on_close(d)
    d.save(update_fields=fields)
    from apps.dialogue.realtime import broadcast_dialogue_closed

    closed_pk = d.pk

    def _broadcast_closed() -> None:
        try:
            closed = Dialogue.objects.get(pk=closed_pk)
        except Dialogue.DoesNotExist:
            return
        broadcast_dialogue_closed(closed)

    transaction.on_commit(_broadcast_closed)
    return d


def _close_and_purge(d: Dialogue, actor: Actor, fields: list[str]) -> list[str]:
    if d.status == DialogueStatus.CLOSED:
        return fields
    d.status = DialogueStatus.CLOSED
    d.closed_at = timezone.now()
    d.closed_by_account = actor.account
    d.closed_by_session = actor.session if actor.account is None else None
    fields.extend(
        ["status", "closed_at", "closed_by_account", "closed_by_session"]
    )
    purge_circle_videos(d)
    purge_voice_on_close(d)
    return fields


@transaction.atomic
def delete_dialogue_for_everyone(actor: Actor, dialogue_id: UUID) -> Dialogue:
    d = Dialogue.objects.select_for_update().get(pk=dialogue_id)
    if not _is_participant(d, actor):
        raise DialogueError("Not a participant")
    if _hidden_for(d, actor):
        raise DialogueError("Dialogue not found")
    d.hidden_for_author = True
    d.hidden_for_peer = True
    fields = ["updated_at", "hidden_for_author", "hidden_for_peer"]
    fields = _close_and_purge(d, actor, fields)
    now = timezone.now()
    for msg in d.messages.filter(deleted_at__isnull=True).iterator():
        _scrub_message(msg, when=now)
    if d.pinned_message_id:
        d.pinned_message = None
        fields.append("pinned_message")
    d.save(update_fields=fields)
    other = _other_participant_actor(d, actor)
    if other is not None:
        notify(
            other,
            NotificationKind.DIALOGUE_DELETED,
            {"dialogue_id": str(d.id)},
        )
    from apps.dialogue.realtime import broadcast_dialogue_closed

    closed_pk = d.pk

    def _broadcast_closed() -> None:
        try:
            closed = Dialogue.objects.get(pk=closed_pk)
        except Dialogue.DoesNotExist:
            return
        broadcast_dialogue_closed(closed)

    transaction.on_commit(_broadcast_closed)
    return d


def _set_side_field(
    actor: Actor,
    dialogue_id: UUID,
    *,
    author_field: str,
    peer_field: str,
    value,
) -> Dialogue:
    d = get_dialogue_for_participant(actor, dialogue_id)
    field = author_field if _side(d, actor) == "author" else peer_field
    setattr(d, field, value)
    d.save(update_fields=[field])
    return d


def pin_chat(actor: Actor, dialogue_id: UUID) -> Dialogue:
    return _set_side_field(
        actor,
        dialogue_id,
        author_field="pinned_at_author",
        peer_field="pinned_at_peer",
        value=timezone.now(),
    )


def unpin_chat(actor: Actor, dialogue_id: UUID) -> Dialogue:
    return _set_side_field(
        actor,
        dialogue_id,
        author_field="pinned_at_author",
        peer_field="pinned_at_peer",
        value=None,
    )


def mute_dialogue(actor: Actor, dialogue_id: UUID) -> Dialogue:
    return _set_side_field(
        actor,
        dialogue_id,
        author_field="muted_author",
        peer_field="muted_peer",
        value=True,
    )


def unmute_dialogue(actor: Actor, dialogue_id: UUID) -> Dialogue:
    return _set_side_field(
        actor,
        dialogue_id,
        author_field="muted_author",
        peer_field="muted_peer",
        value=False,
    )


def mark_dialogue_read(actor: Actor, dialogue_id: UUID) -> Dialogue:
    d = get_dialogue_for_participant(actor, dialogue_id)
    if _side(d, actor) == "author":
        d.last_read_at_author = timezone.now()
        d.unread_forced_author = False
        d.save(update_fields=["last_read_at_author", "unread_forced_author"])
    else:
        d.last_read_at_peer = timezone.now()
        d.unread_forced_peer = False
        d.save(update_fields=["last_read_at_peer", "unread_forced_peer"])
    return d


def mark_dialogue_unread(actor: Actor, dialogue_id: UUID) -> Dialogue:
    return _set_side_field(
        actor,
        dialogue_id,
        author_field="unread_forced_author",
        peer_field="unread_forced_peer",
        value=True,
    )


def _hide_all_for(d: Dialogue, actor: Actor) -> None:
    account = actor.account
    session = actor.session if actor.account is None else None
    for msg in d.messages.all():
        MessageHide.objects.get_or_create(
            message=msg,
            account=account,
            session=session,
            defaults={"account": account, "session": session},
        )


def _participant_actors(d: Dialogue) -> list[Actor]:
    out: list[Actor] = []
    if d.author_account_id:
        out.append(Actor(kind="account", account=d.author_account))
    elif d.author_session_id:
        out.append(Actor(kind="anonymous", session=d.author_session))
    if d.peer_account_id:
        out.append(Actor(kind="account", account=d.peer_account))
    elif d.peer_session_id:
        out.append(Actor(kind="anonymous", session=d.peer_session))
    return out


@transaction.atomic
def clear_history(
    actor: Actor, dialogue_id: UUID, scope: str = "me"
) -> Dialogue:
    d = get_dialogue_for_participant(actor, dialogue_id)
    if scope == "everyone":
        when = timezone.now()
        for msg in list(d.messages.all()):
            if not msg.deleted_at:
                _scrub_message(msg, when=when)
        d = Dialogue.objects.select_related(
            "author_account",
            "author_session",
            "peer_account",
            "peer_session",
        ).get(pk=d.id)
        if d.pinned_message_id:
            d.pinned_message = None
            d.save(update_fields=["pinned_message"])
        for who in _participant_actors(d):
            _hide_all_for(d, who)
    elif scope == "me":
        _hide_all_for(d, actor)
    else:
        raise DialogueError("Unknown clear scope")
    return d


def dialogue_flags(d: Dialogue, actor: Actor) -> dict[str, bool]:
    from apps.moderation.blocks import has_blocked

    other = _other_participant_actor(d, actor)
    peer_hidden = bool(other and has_blocked(actor, other))
    closed = d.status == DialogueStatus.CLOSED
    return {
        "closed_by_me": closed and _is_closer(d, actor) and bool(
            d.closed_by_account_id or d.closed_by_session_id
        ),
        "can_reopen": closed and _is_closer(d, actor) and not _abandoned(d),
        "peer_hidden": peer_hidden,
        "hidden_for_me": _hidden_for(d, actor),
    }


def _outreach_one(
    author: Actor,
    story: Story,
    peer: Actor,
    *,
    intent: str,
) -> tuple[Dialogue, bool]:
    """Return (dialogue, created)."""
    if is_author(story, peer):
        raise DialogueError("You cannot open a dialogue with yourself")
    if is_blocked_between(author, peer):
        raise DialogueError("Dialogue unavailable")

    empathy = get_empathy_for_hearer(story, peer)
    if empathy is None:
        raise DialogueError('This person did not mark "I hear you"')
    if not empathy.outreach_opt_in:
        raise DialogueError("Hearer disabled outreach")

    existing = _find_open_dialogue(story, peer)
    if existing is not None:
        return existing, False

    dialogue = _create_dialogue(
        story=story,
        peer=peer,
        intent=intent,
        source=DialogueSource.AUTHOR_OUTREACH,
        intro_body=OUTREACH_INTRO,
    )
    return dialogue, True


@transaction.atomic
def start_author_outreach(
    actor: Actor,
    story_id: UUID,
    *,
    mode: Literal["one", "many", "random"],
    hearer_refs: list[str] | None = None,
    intent: str = DialogueIntent.LISTEN,
) -> OutreachResult:
    """
    Author Outreach: Story author starts Initiated Dialogue with Hearer(s).
    Modes: one (single ref), many (list of refs), random (one opt-in Hearer).
    """
    if mode not in ("one", "many", "random"):
        raise DialogueError("Invalid mode")
    if intent not in DialogueIntent.values:
        raise DialogueError("Invalid intent")
    if actor.account is None and actor.session is None:
        raise DialogueError("No identity")

    try:
        story = Story.objects.select_related("author_account", "author_session").get(
            pk=story_id
        )
    except Story.DoesNotExist as exc:
        raise StoryNotFound("Story not found") from exc

    if not is_author(story, actor):
        raise DialogueError("Only the author can write to hearers")

    try:
        assert_under_limit(
            actor=actor,
            queryset=Dialogue.objects.filter(source=DialogueSource.AUTHOR_OUTREACH),
            account_field="author_account",
            session_field="author_session",
            limit=OUTREACH_LIMIT,
            window_seconds=OUTREACH_WINDOW_SECONDS,
            time_field="created_at",
        )
    except RateLimitExceeded as exc:
        raise DialogueError(str(exc)) from exc

    refs: list[str] = []
    if mode == "random":
        candidates = eligible_hearers_for_outreach(story)
        open_peers = set()
        for d in Dialogue.objects.filter(
            story=story, status=DialogueStatus.OPEN
        ).only("peer_account_id", "peer_session_id"):
            if d.peer_account_id:
                open_peers.add(f"account:{d.peer_account_id}")
            elif d.peer_session_id:
                open_peers.add(f"session:{d.peer_session_id}")
        pool = [
            h
            for h in candidates
            if hearer_ref_for_empathy(h) not in open_peers
            and not is_blocked_between(
                actor,
                Actor(
                    kind="account" if h.from_account_id else "anonymous",
                    account=h.from_account,
                    session=h.from_session,
                ),
            )
        ]
        if not pool:
            # Fall back to any opt-in (may reuse open dialogue)
            pool = candidates
        if not pool:
            raise DialogueError("No hearers opted in to outreach")
        chosen = random.choice(pool)
        refs = [hearer_ref_for_empathy(chosen)]
    else:
        refs = list(hearer_refs or [])
        if mode == "one":
            if len(refs) != 1:
                raise DialogueError("mode=one requires exactly one hearer_ref")
        elif mode == "many":
            if not refs:
                raise DialogueError("hearer_refs is required")
            if len(refs) > 10:
                raise DialogueError("Too many recipients (max 10)")

    dialogues: list[Dialogue] = []
    created_n = 0
    reused_n = 0
    seen: set[str] = set()
    for ref in refs:
        if ref in seen:
            continue
        seen.add(ref)
        try:
            peer = actor_from_hearer_ref(ref)
        except EmpathyError as exc:
            raise DialogueError(str(exc)) from exc
        dialogue, created = _outreach_one(actor, story, peer, intent=intent)
        dialogues.append(dialogue)
        if created:
            created_n += 1
            notify(
                peer,
                NotificationKind.OUTREACH_INTRO,
                {"dialogue_id": str(dialogue.id), "story_id": str(story.id)},
            )
        else:
            reused_n += 1

    return OutreachResult(
        dialogues=dialogues,
        created_count=created_n,
        reused_count=reused_n,
    )
