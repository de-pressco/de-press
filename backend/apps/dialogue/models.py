"""Initiated Dialogue: request → author opens → messages (HTTP MVP)."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class DialogueIntent(models.TextChoices):
    LISTEN = "listen", "Vent / be heard"
    SHARE = "share", "Share a similar experience"
    ADVICE_OK = "advice_ok", "Advice is welcome"
    MUTUAL = "mutual", "Exchange stories"


class DialogueRequestStatus(models.TextChoices):
    AWAITING_HELPER = "awaiting_helper", "Awaiting helper review"
    PENDING = "pending", "Pending"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"
    EXPIRED = "expired", "Expired"


class DialogueStatus(models.TextChoices):
    OPEN = "open", "Open"
    CLOSED = "closed", "Closed"


class DialogueSource(models.TextChoices):
    REQUEST = "request", "Dialogue request accepted"
    AUTHOR_OUTREACH = "author_outreach", "Author outreach to Hearer"
    HELP = "help", "Help request accepted"
    THERAPY = "therapy", "Therapy session (ADR 0022)"


class DialogueRequest(models.Model):
    """Reader asks; only Story author may accept and open Dialogue."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    story = models.ForeignKey(
        "stories.Story",
        on_delete=models.CASCADE,
        related_name="dialogue_requests",
    )
    from_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="dialogue_requests_sent",
    )
    from_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="dialogue_requests_sent",
    )
    intent = models.CharField(max_length=32, choices=DialogueIntent.choices)
    note = models.CharField(max_length=280, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=DialogueRequestStatus.choices,
        default=DialogueRequestStatus.PENDING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Dialogue request"
        verbose_name_plural = "Dialogue requests"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["story", "from_account"],
                condition=models.Q(from_account__isnull=False),
                name="unique_request_per_story_account",
            ),
            models.UniqueConstraint(
                fields=["story", "from_session"],
                condition=models.Q(from_session__isnull=False),
                name="unique_request_per_story_session",
            ),
        ]

    def __str__(self) -> str:
        return f"dreq:{self.id}:{self.status}"


class HelpRequestStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    ACCEPTED = "accepted", "Accepted"
    CANCELLED = "cancelled", "Cancelled"


class HelpRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="help_requests_sent",
    )
    from_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="help_requests_sent",
    )
    note = models.CharField(max_length=280, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=HelpRequestStatus.choices,
        default=HelpRequestStatus.PENDING,
        db_index=True,
    )
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="help_requests_accepted",
    )
    dialogue = models.OneToOneField(
        "dialogue.Dialogue",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="help_request",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    (Q(from_account__isnull=False) & Q(from_session__isnull=True))
                    | (Q(from_account__isnull=True) & Q(from_session__isnull=False))
                ),
                name="help_request_exactly_one_actor",
            ),
            models.UniqueConstraint(
                fields=["from_account"],
                condition=Q(from_account__isnull=False, status="pending"),
                name="unique_pending_help_account",
            ),
            models.UniqueConstraint(
                fields=["from_session"],
                condition=Q(from_session__isnull=False, status="pending"),
                name="unique_pending_help_session",
            ),
        ]


class HelpRequestSkip(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(
        HelpRequest,
        on_delete=models.CASCADE,
        related_name="skips",
    )
    helper = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="help_request_skips",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["request", "helper"],
                name="unique_help_skip_helper",
            ),
        ]


class Dialogue(models.Model):
    """1-on-1 dialogue opened only by Story author (request accept or outreach)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    story = models.ForeignKey(
        "stories.Story",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="dialogues",
    )
    request = models.OneToOneField(
        DialogueRequest,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="dialogue",
    )
    source = models.CharField(
        max_length=32,
        choices=DialogueSource.choices,
        default=DialogueSource.REQUEST,
        db_index=True,
    )
    author_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dialogues_as_author",
        null=True,
        blank=True,
    )
    author_session = models.ForeignKey(
        "identity.AnonymousSession",
        on_delete=models.CASCADE,
        related_name="dialogues_as_author",
        null=True,
        blank=True,
    )
    peer_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dialogues_as_peer",
        null=True,
        blank=True,
    )
    peer_session = models.ForeignKey(
        "identity.AnonymousSession",
        on_delete=models.CASCADE,
        related_name="dialogues_as_peer",
        null=True,
        blank=True,
    )
    intent = models.CharField(
        max_length=32,
        choices=DialogueIntent.choices,
        default=DialogueIntent.LISTEN,
    )
    status = models.CharField(
        max_length=16,
        choices=DialogueStatus.choices,
        default=DialogueStatus.OPEN,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="dialogues_closed",
    )
    closed_by_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="dialogues_closed",
    )
    hidden_for_author = models.BooleanField(default=False)
    hidden_for_peer = models.BooleanField(default=False)
    pinned_at_author = models.DateTimeField(null=True, blank=True)
    pinned_at_peer = models.DateTimeField(null=True, blank=True)
    muted_author = models.BooleanField(default=False)
    muted_peer = models.BooleanField(default=False)
    last_read_at_author = models.DateTimeField(null=True, blank=True)
    last_read_at_peer = models.DateTimeField(null=True, blank=True)
    unread_forced_author = models.BooleanField(default=False)
    unread_forced_peer = models.BooleanField(default=False)
    pinned_message = models.ForeignKey(
        "Message",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        verbose_name = "Dialogue"
        verbose_name_plural = "Dialogues"
        ordering = ("-updated_at",)

    def __str__(self) -> str:
        return f"dialogue:{self.id} ({self.status})"


class MessageKind(models.TextChoices):
    TEXT = "text", "Text"
    VOICE = "voice", "Voice note"
    CIRCLE = "circle", "Circle video"


def voice_upload_to(instance: "Message", filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    if ext not in ("webm", "ogg", "mp3", "mp4", "m4a", "wav", "mpeg"):
        ext = "webm"
    return f"dialogue_voice/{instance.dialogue_id}/{instance.id}.{ext}"


def circle_upload_to(instance: "Message", filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    if ext not in ("webm", "mp4", "mov"):
        ext = "webm"
    return f"dialogue_circle/{instance.dialogue_id}/{instance.id}.{ext}"


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dialogue = models.ForeignKey(
        Dialogue,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    kind = models.CharField(
        max_length=16,
        choices=MessageKind.choices,
        default=MessageKind.TEXT,
        db_index=True,
    )
    body = models.TextField(blank=True, default="")
    audio = models.FileField(
        upload_to=voice_upload_to,
        null=True,
        blank=True,
        max_length=512,
    )
    video = models.FileField(
        upload_to=circle_upload_to,
        null=True,
        blank=True,
        max_length=512,
    )
    ephemeral = models.BooleanField(default=False)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    transcript = models.TextField(blank=True, default="")
    source_lang = models.CharField(max_length=8, blank=True, default="ru")
    # Cached translations of body/transcript: {"en": "...", "ru": "..."}
    translations = models.JSONField(default=dict, blank=True)
    from_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messages_sent",
    )
    from_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messages_sent",
    )
    reply_to = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="replies",
    )
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    forwarded = models.BooleanField(default=False)
    forwarded_preview = models.CharField(max_length=280, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Message"
        verbose_name_plural = "Messages"
        ordering = ("created_at",)

    def __str__(self) -> str:
        return f"msg:{self.id}:{self.kind}"

    @property
    def display_text(self) -> str:
        if self.deleted_at:
            return "message deleted"
        if self.kind == MessageKind.VOICE:
            if self.transcript.strip():
                return self.transcript.strip()
            if not self.audio:
                return "[voice note deleted]"
            return self.body or "[voice note]"
        if self.kind == MessageKind.CIRCLE:
            if not self.video:
                return "[video circle deleted]"
            return self.body or "[video circle]"
        return self.body


class MessageHide(models.Model):
    """Per-viewer hide ("delete for me")."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="hides",
    )
    account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="hidden_messages",
    )
    session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="hidden_messages",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Hidden message"
        constraints = [
            models.UniqueConstraint(
                fields=["message", "account"],
                condition=models.Q(account__isnull=False),
                name="unique_hide_message_account",
            ),
            models.UniqueConstraint(
                fields=["message", "session"],
                condition=models.Q(session__isnull=False),
                name="unique_hide_message_session",
            ),
        ]
