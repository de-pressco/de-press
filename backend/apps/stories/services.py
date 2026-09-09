"""Deep stories module: publish, feed, get, moderate."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.common.rate_limit import RateLimitExceeded, assert_under_limit
from apps.identity.services import Actor
from apps.stories.models import Story, StoryStatus, StoryTopic
from apps.stories.realtime import author_key_for, broadcast_story_event


class StoryError(Exception):
    """Base story error."""


class StoryNotFound(StoryError):
    pass


class StoryPermissionError(StoryError):
    pass


# Voice limits
VOICE_MAX_BYTES = 5 * 1024 * 1024
VOICE_MAX_DURATION_MS = 120_000
VOICE_LIMIT = 20
VOICE_WINDOW_SECONDS = 3600


def _emit_story(event_type: str, story: Story) -> None:
    story_id = story.id
    key = author_key_for(story)

    def _send() -> None:
        if event_type == "story.deleted":
            broadcast_story_event(
                "story.deleted",
                story_id=story_id,
                author_key=key,
            )
            return
        fresh = Story.objects.get(pk=story_id)
        broadcast_story_event(event_type, story=fresh)

    transaction.on_commit(_send)


@dataclass(frozen=True, slots=True)
class FeedPage:
    items: list[Story]
    next_cursor: str | None


def _public_qs(*, topic: str | None = None) -> QuerySet[Story]:
    qs = Story.objects.filter(status=StoryStatus.PUBLISHED)
    if topic and topic in StoryTopic.values:
        qs = qs.filter(topic=topic)
    return qs


@transaction.atomic
def publish_story(
    actor: Actor,
    body: str,
    *,
    pseudonym: str | None = None,
    topic: str | None = None,
) -> Story:
    text = body.strip()
    if not text:
        raise StoryError("Story body cannot be empty")
    if len(text) > 20_000:
        raise StoryError("Story body is too long")

    topic_val = topic or StoryTopic.OTHER
    if topic_val not in StoryTopic.values:
        raise StoryError("Invalid topic")

    name = (pseudonym or actor.display_pseudonym).strip()[:64] or "anonymous"
    now = timezone.now()

    if actor.account is not None:
        story = Story(
            body=text,
            topic=topic_val,
            status=StoryStatus.PUBLISHED,
            author_account=actor.account,
            author_session=None,
            pseudonym_snapshot=name,
            published_at=now,
            last_activity_at=now,
        )
    elif actor.session is not None:
        story = Story(
            body=text,
            topic=topic_val,
            status=StoryStatus.PUBLISHED,
            author_account=None,
            author_session=actor.session,
            pseudonym_snapshot=name,
            published_at=now,
            last_activity_at=now,
        )
    else:
        raise StoryError("Actor has no identity")

    story.full_clean()
    story.save()

    from apps.empathy.services import ensure_pulse

    ensure_pulse(story)
    _emit_story("story.published", story)
    return story


def _assert_voice_file(uploaded_file, duration_ms: int | None) -> None:
    size = getattr(uploaded_file, "size", 0) or 0
    if size <= 0:
        raise StoryError("Empty audio file")
    if size > VOICE_MAX_BYTES:
        raise StoryError("Voice note is too large (max 5 MB)")
    if duration_ms is not None and duration_ms > VOICE_MAX_DURATION_MS:
        raise StoryError("Voice note is too long (max 2 min)")


def _voice_rate_limit(actor: Actor) -> None:
    try:
        assert_under_limit(
            actor=actor,
            queryset=Story.objects.exclude(audio=""),
            account_field="author_account",
            session_field="author_session",
            limit=VOICE_LIMIT,
            window_seconds=VOICE_WINDOW_SECONDS,
            time_field="created_at",
        )
    except RateLimitExceeded as exc:
        raise StoryError(str(exc)) from exc


@transaction.atomic
def publish_story_voice(
    actor: Actor,
    body: str,
    *,
    uploaded_file,
    duration_ms: int | None = None,
    pseudonym: str | None = None,
    topic: str | None = None,
    source_lang: str = "ru",
) -> Story:
    text = (body or "").strip()
    _assert_voice_file(uploaded_file, duration_ms)
    if len(text) > 20_000:
        raise StoryError("Story body is too long")

    topic_val = topic or StoryTopic.OTHER
    if topic_val not in StoryTopic.values:
        raise StoryError("Invalid topic")

    _voice_rate_limit(actor)

    name = (pseudonym or actor.display_pseudonym).strip()[:64] or "anonymous"
    now = timezone.now()
    if actor.account is not None:
        story = Story(
            body=text,
            topic=topic_val,
            status=StoryStatus.PUBLISHED,
            author_account=actor.account,
            author_session=None,
            pseudonym_snapshot=name,
            published_at=now,
            last_activity_at=now,
        )
    elif actor.session is not None:
        story = Story(
            body=text,
            topic=topic_val,
            status=StoryStatus.PUBLISHED,
            author_account=None,
            author_session=actor.session,
            pseudonym_snapshot=name,
            published_at=now,
            last_activity_at=now,
        )
    else:
        raise StoryError("Actor has no identity")

    story.full_clean()
    story.save()
    story.audio = uploaded_file
    story.duration_ms = duration_ms
    story.save(update_fields=["audio", "duration_ms"])

    from apps.empathy.services import ensure_pulse

    ensure_pulse(story)
    _emit_story("story.published", story)
    return story


def _public_posts(topic: str | None = None) -> QuerySet[Story]:
    qs = Story.objects.filter(status=StoryStatus.PUBLISHED, parent__isnull=True)
    if topic and topic in StoryTopic.values:
        qs = qs.filter(topic=topic)
    return qs


def list_feed(
    *,
    cursor: str | None = None,
    limit: int = 20,
    topic: str | None = None,
    viewer: Actor | None = None,
) -> FeedPage:
    limit = max(1, min(limit, 50))
    qs = _public_posts(topic=topic)

    if viewer is not None and (viewer.account or viewer.session):
        from apps.moderation.blocks import blocked_author_q_for_viewer

        hide_q = blocked_author_q_for_viewer(viewer)
        if hide_q:
            qs = qs.exclude(hide_q)

    qs = qs.order_by("-last_activity_at", "-id")

    if cursor:
        try:
            ts_raw, id_raw = cursor.split("|", 1)
            ts = datetime.fromisoformat(ts_raw)
            cursor_id = UUID(id_raw)
            qs = qs.filter(models_q_activity_before(ts, cursor_id))
        except (ValueError, TypeError):
            pass

    rows = list(qs[: limit + 1])
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = None
    if has_more and items:
        last = items[-1]
        stamp = last.last_activity_at or last.published_at
        assert stamp is not None
        next_cursor = f"{stamp.isoformat()}|{last.id}"
    return FeedPage(items=items, next_cursor=next_cursor)


def _root_story(story: Story) -> Story:
    return story.parent if story.parent_id else story


def list_story_thread(story_id: UUID, *, viewer: Actor | None = None) -> list[Story]:
    """Post plus its author comments, oldest first."""
    story = get_story(story_id, for_public=False)
    if story.status == StoryStatus.REMOVED:
        raise StoryNotFound("Story not found")
    mine = viewer is not None and is_author(story, viewer)
    if story.status != StoryStatus.PUBLISHED and not mine:
        raise StoryNotFound("Story not found")

    root = _root_story(story)
    if root.status == StoryStatus.REMOVED and not mine:
        raise StoryNotFound("Story not found")

    children = Story.objects.filter(parent=root)
    if mine:
        children = children.exclude(status=StoryStatus.REMOVED)
    else:
        children = children.filter(status=StoryStatus.PUBLISHED)
    return [root, *list(children.order_by("published_at", "id"))]


@transaction.atomic
def add_comment(actor: Actor, post_id: UUID, body: str) -> Story:
    post = get_story(post_id, for_public=False)
    if post.parent_id:
        raise StoryError("Replies to replies are not allowed")
    if not is_author(post, actor):
        raise StoryPermissionError("Author only")
    if post.status == StoryStatus.REMOVED:
        raise StoryNotFound("Story not found")

    text = body.strip()
    if not text:
        raise StoryError("Story body cannot be empty")
    if len(text) > 20_000:
        raise StoryError("Story body is too long")

    now = timezone.now()
    comment = Story(
        body=text,
        topic=post.topic,
        status=StoryStatus.PUBLISHED,
        author_account=post.author_account,
        author_session=post.author_session if post.author_account_id is None else None,
        parent=post,
        pseudonym_snapshot=post.pseudonym_snapshot,
        published_at=now,
        last_activity_at=now,
    )
    comment.full_clean()
    comment.save()
    post.last_activity_at = now
    post.save(update_fields=["last_activity_at", "updated_at"])
    _emit_comment(comment)
    return comment


@transaction.atomic
def add_comment_voice(
    actor: Actor,
    post_id: UUID,
    body: str,
    *,
    uploaded_file,
    duration_ms: int | None = None,
    source_lang: str = "ru",
) -> Story:
    post = get_story(post_id, for_public=False)
    if post.parent_id:
        raise StoryError("Replies to replies are not allowed")
    if not is_author(post, actor):
        raise StoryPermissionError("Author only")
    if post.status == StoryStatus.REMOVED:
        raise StoryNotFound("Story not found")

    text = (body or "").strip()
    _assert_voice_file(uploaded_file, duration_ms)
    if len(text) > 20_000:
        raise StoryError("Story body is too long")

    _voice_rate_limit(actor)

    now = timezone.now()
    comment = Story(
        body=text,
        topic=post.topic,
        status=StoryStatus.PUBLISHED,
        author_account=post.author_account,
        author_session=post.author_session if post.author_account_id is None else None,
        parent=post,
        pseudonym_snapshot=post.pseudonym_snapshot,
        published_at=now,
        last_activity_at=now,
    )
    comment.full_clean()
    comment.save()
    comment.audio = uploaded_file
    comment.duration_ms = duration_ms
    comment.save(update_fields=["audio", "duration_ms"])
    post.last_activity_at = now
    post.save(update_fields=["last_activity_at", "updated_at"])
    _emit_comment(comment)
    return comment


def _emit_comment(comment: Story) -> None:
    comment_id = comment.id
    post_id = comment.parent_id

    def _send() -> None:
        fresh = Story.objects.get(pk=comment_id)
        broadcast_story_event(
            "story.commented",
            story=fresh,
            post_id=str(post_id) if post_id else None,
        )

    transaction.on_commit(_send)


def models_q_published_before(ts: datetime, cursor_id: UUID):
    from django.db.models import Q

    return Q(published_at__lt=ts) | (Q(published_at=ts) & Q(id__lt=cursor_id))


def models_q_activity_before(ts: datetime, cursor_id: UUID):
    from django.db.models import Q

    return Q(last_activity_at__lt=ts) | (
        Q(last_activity_at=ts) & Q(id__lt=cursor_id)
    )


def get_story(story_id: UUID, *, for_public: bool = True) -> Story:
    try:
        story = Story.objects.get(pk=story_id)
    except Story.DoesNotExist as exc:
        raise StoryNotFound("Story not found") from exc
    if for_public and story.status != StoryStatus.PUBLISHED:
        raise StoryNotFound("Story not found")
    return story


def is_author(story: Story, actor: Actor) -> bool:
    if actor.account is not None and story.author_account_id == actor.account.id:
        return True
    if actor.session is not None and story.author_session_id == actor.session.id:
        return True
    return False


def list_author_stories(actor: Actor) -> list[Story]:
    qs = Story.objects.exclude(status=StoryStatus.REMOVED).filter(parent__isnull=True)
    if actor.account is not None:
        return list(
            qs.filter(author_account=actor.account).order_by(
                "-published_at",
                "-created_at",
            )
        )
    if actor.session is not None:
        return list(
            qs.filter(author_session=actor.session).order_by(
                "-published_at",
                "-created_at",
            )
        )
    return []


def _owned_story(actor: Actor, story_id: UUID) -> Story:
    try:
        story = Story.objects.get(pk=story_id)
    except Story.DoesNotExist as exc:
        raise StoryNotFound("Story not found") from exc
    if not is_author(story, actor):
        raise StoryPermissionError("Author only")
    if story.status == StoryStatus.REMOVED:
        raise StoryNotFound("Story not found")
    return story


def edit_story(actor: Actor, story_id: UUID, body: str) -> Story:
    story = _owned_story(actor, story_id)
    text = body.strip()
    if not text and not story.audio:
        raise StoryError("Story body cannot be empty")
    if len(text) > 20_000:
        raise StoryError("Story body is too long")
    story.body = text
    story.save(update_fields=["body", "updated_at"])
    _emit_story("story.updated", story)
    return story


def hide_story(actor: Actor, story_id: UUID) -> Story:
    story = _owned_story(actor, story_id)
    story.status = StoryStatus.HIDDEN
    story.save(update_fields=["status", "updated_at"])
    _emit_story("story.hidden", story)
    return story


def unhide_story(actor: Actor, story_id: UUID) -> Story:
    story = _owned_story(actor, story_id)
    story.status = StoryStatus.PUBLISHED
    if story.published_at is None:
        story.published_at = timezone.now()
        story.save(update_fields=["status", "published_at", "updated_at"])
    else:
        story.save(update_fields=["status", "updated_at"])
    _emit_story("story.unhidden", story)
    return story


def delete_story(actor: Actor, story_id: UUID) -> Story:
    story = _owned_story(actor, story_id)
    if story.audio:
        story.audio.delete(save=False)
        story.audio = None
        story.duration_ms = None
    story.status = StoryStatus.REMOVED
    story.save(update_fields=["status", "audio", "duration_ms", "updated_at"])
    _emit_story("story.deleted", story)
    return story


def moderate_story(story_id: UUID, status: str) -> Story:
    if status not in StoryStatus.values:
        raise StoryError(f"Invalid status: {status}")
    try:
        story = Story.objects.get(pk=story_id)
    except Story.DoesNotExist as exc:
        raise StoryNotFound("Story not found") from exc
    story.status = status
    story.save(update_fields=["status", "updated_at"])
    if status == StoryStatus.REMOVED:
        _emit_story("story.deleted", story)
    elif status == StoryStatus.HIDDEN:
        _emit_story("story.hidden", story)
    elif status == StoryStatus.PUBLISHED:
        _emit_story("story.unhidden", story)
    return story


def topic_choices() -> list[dict[str, str]]:
    return [{"value": v, "label": str(label)} for v, label in StoryTopic.choices]
