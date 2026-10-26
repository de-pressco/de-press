"""Deep support module: Quiet Phrases, Moderated Clouds, Helper queue."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.common.rate_limit import RateLimitExceeded, assert_under_limit
from apps.identity.services import Actor
from apps.moderation.blocks import is_blocked_between
from apps.moderation.models import ModerationAction, ModerationActionKind
from apps.notifications.models import Notification, NotificationKind
from apps.notifications.services import notify
from apps.stories.models import Story
from apps.stories.services import StoryNotFound, get_story, is_author
from apps.support.models import (
    QuietPhrase,
    SupportCloud,
    SupportCloudKind,
    SupportCloudStatus,
)

CLOUD_LIMIT = 30
CLOUD_WINDOW_SECONDS = 3600
FREE_TEXT_MAX = 280
FREE_TEXT_LIMIT = 5  # free-text submissions per hour (stricter)
FREE_TEXT_WINDOW_SECONDS = 3600


class SupportError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class QuietPhraseView:
    key: str
    text: str
    image_url: str | None = None


@dataclass(frozen=True, slots=True)
class SendCloudResult:
    cloud: SupportCloud
    created: bool


@dataclass(frozen=True, slots=True)
class SupportCloudView:
    id: UUID
    body: str
    kind: str
    status: str
    pseudonym: str
    sender_ref: str
    helper_badge: str
    is_priority: bool
    created_at: str
    image_url: str | None
    phrase_key: str


@dataclass(frozen=True, slots=True)
class QueueCloudView(SupportCloudView):
    story_id: UUID
    story_preview: str


@dataclass(frozen=True, slots=True)
class ReceivedCloudView:
    id: str
    phrase_key: str
    body: str


def _root_id(story: Story) -> UUID:
    return story.parent_id or story.id


def _thread_story_ids(root: Story) -> list[UUID]:
    child_ids = list(
        Story.objects.filter(parent_id=root.id).values_list("id", flat=True)
    )
    return [root.id, *child_ids]


def _cloud_payload(story: Story, cloud: SupportCloud) -> dict:
    return {
        "story_id": str(story.id),
        "post_id": str(_root_id(story)),
        "cloud_id": str(cloud.id),
    }


def list_quiet_phrases(*, lang: str = "ru") -> list[QuietPhraseView]:
    """Return active Quiet Phrases in the requested UI language (ru|en)."""
    code = (lang or "ru").lower().strip()
    if code not in ("ru", "en"):
        code = "ru"
    rows = QuietPhrase.objects.filter(is_active=True).order_by("sort_order", "key")
    out: list[QuietPhraseView] = []
    for p in rows:
        if code == "en" and (p.text_en or "").strip():
            text = p.text_en.strip()
        else:
            text = p.text_ru
        out.append(
            QuietPhraseView(key=p.key, text=text, image_url=_file_url(p.image))
        )
    return out


def _file_url(field) -> str | None:
    if not field:
        return None
    try:
        return field.url
    except ValueError:
        return None


def _thread_root(story: Story) -> Story:
    if story.parent_id:
        return story.parent
    return story


def _thread_ids_for(story: Story) -> list[UUID]:
    root_id = _root_id(story)
    child_ids = list(
        Story.objects.filter(parent_id=root_id).values_list("id", flat=True)
    )
    return [root_id, *child_ids]


def _existing_cloud(actor: Actor, story: Story) -> SupportCloud | None:
    """Any non-rejected cloud from this actor on the author's monologue."""
    qs = SupportCloud.objects.filter(story_id__in=_thread_ids_for(story)).exclude(
        status=SupportCloudStatus.REJECTED
    )
    if actor.account is not None:
        return qs.filter(from_account=actor.account).first()
    if actor.session is not None:
        return qs.filter(from_session=actor.session).first()
    return None


def _sender_ref(cloud: SupportCloud) -> str:
    if cloud.from_account_id:
        return f"account:{cloud.from_account_id}"
    return f"session:{cloud.from_session_id}"


def _author_actor(story: Story) -> Actor:
    if story.author_account_id:
        return Actor(kind="account", account=story.author_account)
    return Actor(kind="anonymous", session=story.author_session)


def _helper_badge_for_actor(actor: Actor) -> str:
    if actor.account is not None and actor.account.is_helper:
        return actor.account.helper_badge_label
    return ""


def _is_moderator(actor: Actor) -> bool:
    """Helpers and staff can moderate the free-text queue."""
    if actor.account is None:
        return False
    return bool(actor.account.is_helper or actor.account.is_staff or actor.account.is_superuser)


def _to_view(cloud: SupportCloud) -> SupportCloudView:
    return SupportCloudView(
        id=cloud.id,
        body=cloud.body_snapshot,
        kind=cloud.kind,
        status=cloud.status,
        pseudonym=cloud.pseudonym_snapshot or "someone",
        sender_ref=_sender_ref(cloud),
        helper_badge=cloud.helper_badge or "",
        is_priority=bool(cloud.is_priority),
        created_at=cloud.created_at.isoformat(),
        image_url=_file_url(getattr(cloud.phrase, "image", None) if cloud.phrase_id else None),
        phrase_key=(cloud.phrase.key if cloud.phrase_id and cloud.phrase else "") or "",
    )


def _assert_can_send_to_story(actor: Actor, story: Story) -> None:
    if actor.account is None and actor.session is None:
        raise SupportError("Actor has no identity")
    if is_author(story, actor):
        raise SupportError("You cannot send a cloud to your own story")
    author = _author_actor(story)
    if is_blocked_between(actor, author):
        raise SupportError("Sending is unavailable")


@transaction.atomic
def send_quiet_phrase(actor: Actor, story_id: UUID, phrase_key: str) -> SendCloudResult:
    """Send a curated Quiet Phrase as a private Support Cloud (author-only)."""
    key = (phrase_key or "").strip()
    if not key:
        raise SupportError("Choose a phrase")

    story = get_story(story_id, for_public=True)
    _assert_can_send_to_story(actor, story)
    existing = _existing_cloud(actor, story)
    if existing is not None:
        same_thought = (
            existing.story_id == story.id
            and existing.phrase_id
            and existing.phrase
            and existing.phrase.key == key
        )
        if same_thought:
            return SendCloudResult(cloud=existing, created=False)
        raise SupportError("Only one cloud per story")

    try:
        phrase = QuietPhrase.objects.get(key=key, is_active=True)
    except QuietPhrase.DoesNotExist as exc:
        raise SupportError("Phrase not found") from exc

    try:
        assert_under_limit(
            actor=actor,
            queryset=SupportCloud.objects.all(),
            account_field="from_account",
            session_field="from_session",
            limit=CLOUD_LIMIT,
            window_seconds=CLOUD_WINDOW_SECONDS,
        )
    except RateLimitExceeded as exc:
        raise SupportError(str(exc)) from exc

    body = phrase.text_ru
    pseudonym = actor.display_pseudonym
    badge = _helper_badge_for_actor(actor)
    priority = bool(badge)
    root = _thread_root(story)

    try:
        if actor.account is not None:
            cloud, created = SupportCloud.objects.get_or_create(
                story=story,
                from_account=actor.account,
                phrase=phrase,
                defaults={
                    "from_session": None,
                    "thread_root": root,
                    "kind": SupportCloudKind.QUIET_PHRASE,
                    "body_snapshot": body,
                    "pseudonym_snapshot": pseudonym,
                    "helper_badge": badge,
                    "is_priority": priority,
                    "status": SupportCloudStatus.DELIVERED,
                },
            )
        else:
            assert actor.session is not None
            cloud, created = SupportCloud.objects.get_or_create(
                story=story,
                from_session=actor.session,
                phrase=phrase,
                defaults={
                    "from_account": None,
                    "thread_root": root,
                    "kind": SupportCloudKind.QUIET_PHRASE,
                    "body_snapshot": body,
                    "pseudonym_snapshot": pseudonym,
                    "helper_badge": badge,
                    "is_priority": priority,
                    "status": SupportCloudStatus.DELIVERED,
                },
            )
    except IntegrityError:
        existing = _existing_cloud(actor, story)
        if existing is None:
            raise
        if (
            existing.story_id == story.id
            and existing.phrase_id
            and existing.phrase
            and existing.phrase.key == key
        ):
            return SendCloudResult(cloud=existing, created=False)
        raise SupportError("Only one cloud per story") from exc

    if created and cloud.status == SupportCloudStatus.DELIVERED:
        notify(
            _author_actor(story),
            NotificationKind.SUPPORT_CLOUD,
            _cloud_payload(story, cloud),
        )
    return SendCloudResult(cloud=cloud, created=created)


@transaction.atomic
def submit_moderated_cloud(actor: Actor, story_id: UUID, body: str) -> SendCloudResult:
    """
    Free-text Support Cloud.
    - Visitors: status=pending until Helper/staff approve.
    - Helpers: delivered immediately with private badge (trusted).
    """
    text = (body or "").strip()
    if not text:
        raise SupportError("Write a short text")
    if len(text) > FREE_TEXT_MAX:
        raise SupportError(f"Too long (max {FREE_TEXT_MAX} characters)")

    story = get_story(story_id, for_public=True)
    _assert_can_send_to_story(actor, story)
    if _existing_cloud(actor, story) is not None:
        raise SupportError("Only one cloud per story")

    try:
        assert_under_limit(
            actor=actor,
            queryset=SupportCloud.objects.filter(kind=SupportCloudKind.FREE_TEXT),
            account_field="from_account",
            session_field="from_session",
            limit=FREE_TEXT_LIMIT,
            window_seconds=FREE_TEXT_WINDOW_SECONDS,
        )
    except RateLimitExceeded as exc:
        raise SupportError(str(exc)) from exc

    badge = _helper_badge_for_actor(actor)
    is_helper = bool(badge)
    status = (
        SupportCloudStatus.DELIVERED
        if is_helper
        else SupportCloudStatus.PENDING
    )

    cloud = SupportCloud.objects.create(
        story=story,
        thread_root=_thread_root(story),
        from_account=actor.account,
        from_session=actor.session if actor.account is None else None,
        kind=SupportCloudKind.FREE_TEXT,
        phrase=None,
        body_snapshot=text,
        pseudonym_snapshot=actor.display_pseudonym,
        helper_badge=badge,
        is_priority=is_helper,
        status=status,
        moderated_at=timezone.now() if is_helper else None,
        moderated_by=actor.account if is_helper else None,
    )
    if is_helper:
        notify(
            _author_actor(story),
            NotificationKind.SUPPORT_CLOUD,
            _cloud_payload(story, cloud),
        )
    return SendCloudResult(cloud=cloud, created=True)


def my_phrase_keys_for(actor: Actor | None, story_ids: list[UUID]) -> dict[UUID, str]:
    """Viewer's own delivered gesture key per story (private)."""
    if actor is None or not story_ids:
        return {}
    qs = SupportCloud.objects.filter(
        story_id__in=story_ids,
        status=SupportCloudStatus.DELIVERED,
    ).select_related("phrase")
    if actor.account is not None:
        qs = qs.filter(from_account=actor.account)
    elif actor.session is not None:
        qs = qs.filter(from_session=actor.session)
    else:
        return {}
    out: dict[UUID, str] = {}
    for cloud in qs:
        key = (cloud.phrase.key if cloud.phrase_id and cloud.phrase else "") or ""
        out[cloud.story_id] = key
    return out


def received_clouds_for_author(
    actor: Actor | None, story_ids: list[UUID]
) -> dict[UUID, list[ReceivedCloudView]]:
    """Author-only compact clouds grouped by story (thread cards)."""
    if actor is None or not story_ids:
        return {}
    qs = (
        SupportCloud.objects.filter(
            story_id__in=story_ids,
            status=SupportCloudStatus.DELIVERED,
            dismissed_by_author=False,
        )
        .select_related("phrase", "story")
        .order_by("-is_priority", "-created_at")
    )
    out: dict[UUID, list[ReceivedCloudView]] = {sid: [] for sid in story_ids}
    for cloud in qs:
        if cloud.story_id not in out:
            continue
        if not is_author(cloud.story, actor):
            continue
        out[cloud.story_id].append(
            ReceivedCloudView(
                id=str(cloud.id),
                phrase_key=(cloud.phrase.key if cloud.phrase_id and cloud.phrase else "")
                or "",
                body=cloud.body_snapshot,
            )
        )
    return out


def cloud_unread_for_roots(actor: Actor | None, roots: list[Story]) -> dict[UUID, int]:
    """Unread delivered clouds on each root thread. Author-only; others get {}."""
    if actor is None or not roots:
        return {}
    mine = [s for s in roots if not s.parent_id and is_author(s, actor)]
    if not mine:
        return {}
    root_ids = [s.id for s in mine]
    story_to_root: dict[UUID, UUID] = {s.id: s.id for s in mine}
    for child_id, parent_id in Story.objects.filter(parent_id__in=root_ids).values_list(
        "id", "parent_id"
    ):
        story_to_root[child_id] = parent_id
    last_read = {s.id: s.clouds_last_read_at for s in mine}
    counts = {s.id: 0 for s in mine}
    rows = SupportCloud.objects.filter(
        story_id__in=story_to_root.keys(),
        status=SupportCloudStatus.DELIVERED,
        dismissed_by_author=False,
    ).values_list("story_id", "created_at")
    for story_id, created_at in rows:
        root_id = story_to_root.get(story_id)
        if root_id is None:
            continue
        cutoff = last_read.get(root_id)
        if cutoff is None or created_at > cutoff:
            counts[root_id] += 1
    return counts


def cloud_gestures_for_roots(actor: Actor | None, roots: list[Story]) -> dict[UUID, str]:
    """Latest unread Quiet Phrase key per author root. Empty for everyone else."""
    if actor is None or not roots:
        return {}
    mine = [s for s in roots if not s.parent_id and is_author(s, actor)]
    if not mine:
        return {}
    root_ids = [s.id for s in mine]
    story_to_root: dict[UUID, UUID] = {s.id: s.id for s in mine}
    for child_id, parent_id in Story.objects.filter(parent_id__in=root_ids).values_list(
        "id", "parent_id"
    ):
        story_to_root[child_id] = parent_id
    last_read = {s.id: s.clouds_last_read_at for s in mine}
    gestures: dict[UUID, str] = {}
    rows = (
        SupportCloud.objects.filter(
            story_id__in=story_to_root.keys(),
            status=SupportCloudStatus.DELIVERED,
            dismissed_by_author=False,
        )
        .select_related("phrase")
        .order_by("-created_at")
    )
    for cloud in rows:
        root_id = story_to_root.get(cloud.story_id)
        if root_id is None or root_id in gestures:
            continue
        cutoff = last_read.get(root_id)
        if cutoff is not None and cloud.created_at <= cutoff:
            continue
        key = (cloud.phrase.key if cloud.phrase_id and cloud.phrase else "") or ""
        if key:
            gestures[root_id] = key
    return gestures


@transaction.atomic
def mark_clouds_read(actor: Actor, story_id: UUID) -> Story:
    """Author opened the thread — same as opening a chat."""
    story = get_story(story_id, for_public=False)
    root = story.parent if story.parent_id else story
    if not is_author(root, actor):
        raise SupportError("Author only")
    now = timezone.now()
    root.clouds_last_read_at = now
    root.save(update_fields=["clouds_last_read_at"])

    thread_ids = {str(sid) for sid in _thread_story_ids(root)}
    kinds = (NotificationKind.SUPPORT_CLOUD, NotificationKind.CLOUD_APPROVED)
    notif_q = Q(kind__in=kinds)
    if actor.account is not None:
        notif_q &= Q(recipient_account=actor.account)
    elif actor.session is not None:
        notif_q &= Q(recipient_session=actor.session)
    else:
        return root
    to_mark = Notification.objects.filter(notif_q, is_read=False)
    ids: list[UUID] = []
    for n in to_mark.only("id", "payload"):
        payload = n.payload or {}
        if str(payload.get("story_id") or "") in thread_ids or str(
            payload.get("post_id") or ""
        ) in thread_ids:
            ids.append(n.id)
    if ids:
        Notification.objects.filter(pk__in=ids).update(is_read=True)
    return root


def list_clouds_for_author(actor: Actor, story_id: UUID) -> list[SupportCloudView]:
    """Author-only list of delivered Support Clouds for a Story."""
    try:
        story = Story.objects.select_related("author_account", "author_session").get(
            pk=story_id
        )
    except Story.DoesNotExist as exc:
        raise StoryNotFound("Story not found") from exc

    if not is_author(story, actor):
        raise SupportError("Only the author can see clouds")

    qs = (
        SupportCloud.objects.filter(
            story=story,
            status=SupportCloudStatus.DELIVERED,
            dismissed_by_author=False,
        )
        .select_related("phrase", "from_account", "from_session")
        .order_by("-is_priority", "-created_at")
    )
    return [_to_view(c) for c in qs]


@transaction.atomic
def dismiss_cloud(actor: Actor, story_id: UUID, cloud_id: UUID) -> SupportCloud:
    try:
        story = Story.objects.get(pk=story_id)
    except Story.DoesNotExist as exc:
        raise StoryNotFound("Story not found") from exc
    if not is_author(story, actor):
        raise SupportError("Only the author can close a cloud")
    try:
        cloud = SupportCloud.objects.select_for_update().get(
            pk=cloud_id, story=story
        )
    except SupportCloud.DoesNotExist as exc:
        raise SupportError("Cloud not found") from exc
    cloud.dismissed_by_author = True
    cloud.save(update_fields=["dismissed_by_author"])
    return cloud


def list_pending_queue(actor: Actor) -> list[QueueCloudView]:
    """Helper/staff moderation queue (pending free-text only)."""
    if not _is_moderator(actor):
        raise SupportError("Helper or staff role required")

    qs = (
        SupportCloud.objects.filter(
            status=SupportCloudStatus.PENDING,
            kind=SupportCloudKind.FREE_TEXT,
        )
        .select_related("story", "from_account", "from_session")
        .order_by("created_at")
    )
    out: list[QueueCloudView] = []
    for c in qs:
        preview = (c.story.body or "")[:120]
        base = _to_view(c)
        out.append(
            QueueCloudView(
                id=base.id,
                body=base.body,
                kind=base.kind,
                status=base.status,
                pseudonym=base.pseudonym,
                sender_ref=base.sender_ref,
                helper_badge=base.helper_badge,
                is_priority=base.is_priority,
                created_at=base.created_at,
                image_url=base.image_url,
                phrase_key=base.phrase_key,
                story_id=c.story_id,
                story_preview=preview,
            )
        )
    return out


def _record_cloud_action(
    *, actor: Actor, cloud: SupportCloud, action: str
) -> None:
    """Audit every cloud decision (Q12): who, what, on which cloud."""
    ModerationAction.objects.create(
        cloud=cloud,
        story=cloud.story,
        actor=actor.account,
        action=action,
        reason="",
        note="",
    )


@transaction.atomic
def approve_cloud(actor: Actor, cloud_id: UUID) -> SupportCloud:
    if not _is_moderator(actor):
        raise SupportError("Helper or staff role required")
    try:
        cloud = SupportCloud.objects.select_for_update().get(pk=cloud_id)
    except SupportCloud.DoesNotExist as exc:
        raise SupportError("Cloud not found") from exc
    if cloud.status != SupportCloudStatus.PENDING:
        raise SupportError("Cloud is not in the queue")
    cloud.status = SupportCloudStatus.DELIVERED
    cloud.moderated_at = timezone.now()
    cloud.moderated_by = actor.account
    cloud.save(
        update_fields=["status", "moderated_at", "moderated_by"]
    )
    _record_cloud_action(
        actor=actor, cloud=cloud, action=ModerationActionKind.CLOUD_APPROVED
    )
    notify(
        _author_actor(cloud.story),
        NotificationKind.CLOUD_APPROVED,
        _cloud_payload(cloud.story, cloud),
    )
    return cloud


@transaction.atomic
def reject_cloud(actor: Actor, cloud_id: UUID) -> SupportCloud:
    if not _is_moderator(actor):
        raise SupportError("Helper or staff role required")
    try:
        cloud = SupportCloud.objects.select_for_update().get(pk=cloud_id)
    except SupportCloud.DoesNotExist as exc:
        raise SupportError("Cloud not found") from exc
    if cloud.status != SupportCloudStatus.PENDING:
        raise SupportError("Cloud is not in the queue")
    cloud.status = SupportCloudStatus.REJECTED
    cloud.moderated_at = timezone.now()
    cloud.moderated_by = actor.account
    cloud.save(
        update_fields=["status", "moderated_at", "moderated_by"]
    )
    _record_cloud_action(
        actor=actor, cloud=cloud, action=ModerationActionKind.CLOUD_REJECTED
    )
    return cloud
