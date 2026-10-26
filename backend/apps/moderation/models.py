"""Safety reports for moderation queue."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class ReportReason(models.TextChoices):
    ABUSE = "abuse", "Abuse / harassment"
    SPAM = "spam", "Spam"
    SELF_HARM = "self_harm", "Self-harm concern"
    OTHER = "other", "Other"


class ReportStatus(models.TextChoices):
    OPEN = "open", "Open"
    REVIEWING = "reviewing", "Reviewing"
    RESOLVED_HIDDEN = "resolved_hidden", "Resolved (content hidden)"
    RESOLVED_DISMISSED = "resolved_dismissed", "Resolved (dismissed)"


class Report(models.Model):
    """User-submitted report about a Story or Dialogue message."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    story = models.ForeignKey(
        "stories.Story",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="reports",
    )
    message = models.ForeignKey(
        "dialogue.Message",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports",
        help_text="Story report may omit this; help-chat report has a message and no story.",
    )
    reason = models.CharField(max_length=32, choices=ReportReason.choices)
    details = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=32,
        choices=ReportStatus.choices,
        default=ReportStatus.OPEN,
        db_index=True,
    )
    from_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports_filed",
    )
    from_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports_filed",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_note = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Report"
        verbose_name_plural = "Reports"
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=models.Q(story__isnull=False) | models.Q(message__isnull=False),
                name="report_story_or_message",
            ),
            models.UniqueConstraint(
                fields=["story", "from_account"],
                condition=models.Q(
                    from_account__isnull=False,
                    status="open",
                    story__isnull=False,
                ),
                name="unique_open_report_per_account_story",
            ),
            models.UniqueConstraint(
                fields=["story", "from_session"],
                condition=models.Q(
                    from_session__isnull=False,
                    status="open",
                    story__isnull=False,
                ),
                name="unique_open_report_per_session_story",
            ),
            models.UniqueConstraint(
                fields=["message", "from_account"],
                condition=models.Q(
                    from_account__isnull=False,
                    status="open",
                    story__isnull=True,
                    message__isnull=False,
                ),
                name="unique_open_help_report_account_message",
            ),
            models.UniqueConstraint(
                fields=["message", "from_session"],
                condition=models.Q(
                    from_session__isnull=False,
                    status="open",
                    story__isnull=True,
                    message__isnull=False,
                ),
                name="unique_open_help_report_session_message",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"report:{self.story_id}:{self.reason}:{self.status}"


class Block(models.Model):
    """One Actor blocks another (hides their stories; blocks dialogue)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    blocker_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="blocks_made",
    )
    blocker_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="blocks_made",
    )
    blocked_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="blocks_received",
    )
    blocked_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="blocks_received",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Block"
        verbose_name_plural = "Blocks"
        constraints = [
            models.CheckConstraint(
                condition=(
                    (
                        models.Q(blocker_account__isnull=False)
                        & models.Q(blocker_session__isnull=True)
                    )
                    | (
                        models.Q(blocker_account__isnull=True)
                        & models.Q(blocker_session__isnull=False)
                    )
                ),
                name="block_exactly_one_blocker",
            ),
            models.CheckConstraint(
                condition=(
                    (
                        models.Q(blocked_account__isnull=False)
                        & models.Q(blocked_session__isnull=True)
                    )
                    | (
                        models.Q(blocked_account__isnull=True)
                        & models.Q(blocked_session__isnull=False)
                    )
                ),
                name="block_exactly_one_blocked",
            ),
            models.UniqueConstraint(
                fields=[
                    "blocker_account",
                    "blocker_session",
                    "blocked_account",
                    "blocked_session",
                ],
                name="unique_block_pair",
            ),
        ]

    def __str__(self) -> str:
        return f"block:{self.id}"


class ModerationActionKind(models.TextChoices):
    REVIEWING = "reviewing", "Marked reviewing"
    HIDDEN = "hidden", "Content hidden"
    REMOVED = "removed", "Content removed"
    DISMISSED = "dismissed", "Report dismissed"
    # Support Cloud moderation has no report row: the cloud itself is the subject.
    CLOUD_APPROVED = "cloud_approved", "Cloud approved"
    CLOUD_REJECTED = "cloud_rejected", "Cloud rejected"


class ModerationAction(models.Model):
    """Audit log (Q12): every moderator decision goes into the journal.

    Stores the decision, the mandatory reason, a note and the staff actor.
    No reporter data: only what was done and why.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(
        Report,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="moderation_actions",
    )
    story = models.ForeignKey(
        "stories.Story",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="moderation_actions",
    )
    message = models.ForeignKey(
        "dialogue.Message",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="moderation_actions",
    )
    cloud = models.ForeignKey(
        "support.SupportCloud",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="moderation_actions",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="moderation_actions_made",
    )
    action = models.CharField(max_length=32, choices=ModerationActionKind.choices)
    reason = models.CharField(
        max_length=32,
        choices=ReportReason.choices,
        blank=True,
        default="",
        help_text="Required for terminal decisions (hide/remove/dismiss).",
    )
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Moderation action"
        verbose_name_plural = "Moderation actions"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["action", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"mod:{self.action}:{self.report_id}"
