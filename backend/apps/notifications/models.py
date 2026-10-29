"""Private nudge events for recipient actors. Not public vanity metrics."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class NotificationKind(models.TextChoices):
    DIALOGUE_REQUEST = "dialogue_request", "Dialogue request"
    SUPPORT_CLOUD = "support_cloud", "Support cloud"
    CLOUD_APPROVED = "cloud_approved", "Support cloud approved"
    DIALOGUE_OPENED = "dialogue_opened", "Dialogue opened"
    OUTREACH_INTRO = "outreach_intro", "Author outreach intro"
    MESSAGE = "message", "New chat message"
    DIALOGUE_DELETED = "dialogue_deleted", "Dialogue deleted"
    SILENT_EMPATHY = "silent_empathy", "Silent empathy / rays"
    HELP_REQUESTED = "help_requested", "Help request"
    HELP_ACCEPTED = "help_accepted", "Help request accepted"
    DIALOGUE_REQUEST_REVIEW = "dialogue_request_review", "Dialogue request helper review"
    REPORT_RESOLVED = "report_resolved", "Report resolved"
    REPORT_NEW = "report_new", "New report"


class Notification(models.Model):
    """Recipient-private notification. Source of truth for read state.

    payload is a JSON dict with stable refs, e.g.:
      {"story_id": "...", "dialogue_id": "...", "cloud_id": "...", "request_id": "..."}
    Frontend renders localized text from `kind` + `payload`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    recipient_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    kind = models.CharField(
        max_length=32,
        choices=NotificationKind.choices,
        db_index=True,
    )
    payload = models.JSONField(default=dict, blank=True)
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Notification"
        verbose_name_plural = "Notifications"
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    (
                        Q(recipient_account__isnull=False)
                        & Q(recipient_session__isnull=True)
                    )
                    | (
                        Q(recipient_account__isnull=True)
                        & Q(recipient_session__isnull=False)
                    )
                ),
                name="notification_exactly_one_recipient",
            ),
        ]
        indexes = [
            models.Index(fields=["recipient_account", "-created_at"]),
            models.Index(fields=["recipient_session", "-created_at"]),
            models.Index(fields=["recipient_account", "is_read", "-created_at"]),
            models.Index(fields=["recipient_session", "is_read", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"notif:{self.id}:{self.kind}:read={self.is_read}"


class EmailDigestStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    SENT = "sent", "Sent"
    FAILED = "failed", "Failed"


class EmailDigest(models.Model):
    """Soft-notify digest record for a recipient (account or anon session).

    Payload is a JSON dict of context items included in the email:
      {"unread": 3, "kinds": ["dialogue_request", "support_cloud"]}
    The magic token links to the web inbox without a password.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="email_digests",
    )
    recipient_session = models.ForeignKey(
        "identity.AnonymousSession",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="email_digests",
    )
    to_email = models.EmailField()
    token = models.CharField(max_length=64, unique=True, db_index=True)
    subject = models.CharField(max_length=200, default="")
    body_text = models.TextField(blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=16,
        choices=EmailDigestStatus.choices,
        default=EmailDigestStatus.PENDING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    failed_reason = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Email digest"
        verbose_name_plural = "Email digests"
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    (
                        Q(recipient_account__isnull=False)
                        & Q(recipient_session__isnull=True)
                    )
                    | (
                        Q(recipient_account__isnull=True)
                        & Q(recipient_session__isnull=False)
                    )
                ),
                name="email_digest_exactly_one_recipient",
            ),
        ]
        indexes = [
            models.Index(fields=["recipient_account", "-created_at"]),
            models.Index(fields=["recipient_session", "-created_at"]),
            models.Index(fields=["status", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"digest:{self.id}:{self.status}"
