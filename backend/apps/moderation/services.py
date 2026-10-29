"""Deep moderation module: submit and resolve reports."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.common.rate_limit import RateLimitExceeded, assert_under_limit
from apps.identity.models import Account
from apps.identity.services import Actor
from apps.moderation.models import (
    ModerationAction,
    ModerationActionKind,
    Report,
    ReportReason,
    ReportStatus,
)
from apps.notifications.models import NotificationKind
from apps.notifications.services import NotificationError, notify
from apps.stories.models import StoryStatus
from apps.stories.services import StoryNotFound, get_story, moderate_story

REPORT_LIMIT = 20
REPORT_WINDOW_SECONDS = 3600


class ReportError(Exception):
    pass


def _notify_helpers_new_report(report: Report, *, source: str) -> None:
    """New report → on-duty Helpers (duty gates notifications, like help)."""
    payload = {
        "report_id": str(report.id),
        "reason": report.reason,
        "source": source,
    }
    for helper in Account.objects.on_duty_helpers():
        if report.from_account_id == helper.id:
            continue
        notify(
            Actor(kind="account", account=helper),
            NotificationKind.REPORT_NEW,
            payload,
        )


@dataclass(frozen=True, slots=True)
class SubmitResult:
    report: Report
    created: bool


@transaction.atomic
def submit_report(
    actor: Actor,
    story_id: UUID,
    *,
    reason: str,
    details: str = "",
    message_id: UUID | None = None,
) -> SubmitResult:
    if reason not in ReportReason.values:
        raise ReportError("Invalid report reason")
    if actor.account is None and actor.session is None:
        raise ReportError("Actor has no identity")

    try:
        assert_under_limit(
            actor=actor,
            queryset=Report.objects.all(),
            account_field="from_account",
            session_field="from_session",
            limit=REPORT_LIMIT,
            window_seconds=REPORT_WINDOW_SECONDS,
        )
    except RateLimitExceeded as exc:
        raise ReportError(str(exc)) from exc

    story = get_story(story_id, for_public=True)
    text = (details or "").strip()[:2000]
    message = None
    if message_id is not None:
        from apps.dialogue.models import Message

        try:
            message = Message.objects.select_related("dialogue").get(pk=message_id)
        except Message.DoesNotExist as exc:
            raise ReportError("Message not found") from exc
        if message.dialogue.story_id != story.id:
            raise ReportError("Message does not belong to this story")

    try:
        if actor.account is not None:
            report, created = Report.objects.get_or_create(
                story=story,
                from_account=actor.account,
                status=ReportStatus.OPEN,
                defaults={
                    "reason": reason,
                    "details": text,
                    "from_session": None,
                    "message": message,
                },
            )
        else:
            assert actor.session is not None
            report, created = Report.objects.get_or_create(
                story=story,
                from_session=actor.session,
                status=ReportStatus.OPEN,
                defaults={
                    "reason": reason,
                    "details": text,
                    "from_account": None,
                    "message": message,
                },
            )
    except IntegrityError:
        qs = Report.objects.filter(story=story, status=ReportStatus.OPEN)
        if actor.account is not None:
            report = qs.filter(from_account=actor.account).first()
        else:
            report = qs.filter(from_session=actor.session).first()
        if report is None:
            raise ReportError("Could not create report") from None
        return SubmitResult(report=report, created=False)

    if not created:
        return SubmitResult(report=report, created=False)

    _notify_helpers_new_report(report, source="story")
    return SubmitResult(report=report, created=True)


def _submit_help_message_report(
    actor: Actor,
    message,
    *,
    reason: str,
    details: str,
) -> SubmitResult:
    """Help dialogue has no Story; uniqueness is per message × actor."""
    text = (details or "").strip()[:2000]
    defaults = {
        "reason": reason,
        "details": text,
        "story": None,
    }
    try:
        if actor.account is not None:
            report, created = Report.objects.get_or_create(
                message=message,
                from_account=actor.account,
                status=ReportStatus.OPEN,
                defaults={**defaults, "from_session": None},
            )
        else:
            assert actor.session is not None
            report, created = Report.objects.get_or_create(
                message=message,
                from_session=actor.session,
                status=ReportStatus.OPEN,
                defaults={**defaults, "from_account": None},
            )
    except IntegrityError:
        qs = Report.objects.filter(
            message=message, status=ReportStatus.OPEN, story__isnull=True
        )
        if actor.account is not None:
            report = qs.filter(from_account=actor.account).first()
        else:
            report = qs.filter(from_session=actor.session).first()
        if report is None:
            raise ReportError("Could not create report") from None
        return SubmitResult(report=report, created=False)
    if created:
        _notify_helpers_new_report(report, source="help")
    return SubmitResult(report=report, created=created)


@transaction.atomic
def submit_message_report(
    actor: Actor,
    message_id: UUID,
    *,
    reason: str,
    details: str = "",
) -> SubmitResult:
    from apps.dialogue.models import Message

    if reason not in ReportReason.values:
        raise ReportError("Invalid report reason")
    if actor.account is None and actor.session is None:
        raise ReportError("Actor has no identity")

    try:
        message = Message.objects.select_related("dialogue").get(pk=message_id)
    except Message.DoesNotExist as exc:
        raise ReportError("Message not found") from exc

    story_id = message.dialogue.story_id
    if story_id is None:
        try:
            assert_under_limit(
                actor=actor,
                queryset=Report.objects.all(),
                account_field="from_account",
                session_field="from_session",
                limit=REPORT_LIMIT,
                window_seconds=REPORT_WINDOW_SECONDS,
            )
        except RateLimitExceeded as exc:
            raise ReportError(str(exc)) from exc
        return _submit_help_message_report(
            actor, message, reason=reason, details=details
        )

    return submit_report(
        actor,
        story_id,
        reason=reason,
        details=details,
        message_id=message_id,
    )


_DECISION_STATUS = {
    "reviewing": ReportStatus.REVIEWING,
    "hide": ReportStatus.RESOLVED_HIDDEN,
    "remove": ReportStatus.RESOLVED_HIDDEN,
    "dismiss": ReportStatus.RESOLVED_DISMISSED,
}
_TERMINAL_DECISIONS = ("hide", "remove", "dismiss")

# The audit row stores the model choice, not the API decision word.
_DECISION_ACTION = {
    "reviewing": ModerationActionKind.REVIEWING,
    "hide": ModerationActionKind.HIDDEN,
    "remove": ModerationActionKind.REMOVED,
    "dismiss": ModerationActionKind.DISMISSED,
}
# Rows written before 2026-10-27 hold the decision word itself.
_LEGACY_ACTION = {
    "hide": ModerationActionKind.HIDDEN,
    "remove": ModerationActionKind.REMOVED,
    "dismiss": ModerationActionKind.DISMISSED,
}


@transaction.atomic
def resolve_report(
    report_id: UUID,
    *,
    actor: Account | None = None,
    decision: str,
    reason: str = "",
    note: str = "",
) -> Report:
    """Moderator decision (Q12): a reason is mandatory, every action is logged.

    `hide` — the default and reversible: the story is hidden from the feed,
    the message is scrubbed for everyone (same scrub path as deletion).
    `remove` — exceptional hard deletion of the story.
    `dismiss` — the content is left untouched.
    Sibling open reports on the same content are closed with the same decision,
    each reporter is notified without the other party's data.
    """
    if decision not in _DECISION_STATUS:
        raise ReportError("Invalid decision")
    status = _DECISION_STATUS[decision]
    reason = (reason or "").strip()
    if decision in _TERMINAL_DECISIONS and reason not in ReportReason.values:
        raise ReportError("Resolution reason is required")
    note = (note or "").strip()[:2000]

    try:
        report = Report.objects.select_for_update().get(pk=report_id)
    except Report.DoesNotExist as exc:
        raise ReportError("Report not found") from exc
    if report.status not in (ReportStatus.OPEN, ReportStatus.REVIEWING):
        raise ReportError("Report already resolved")

    _apply_decision(
        report, actor=actor, decision=decision, status=status, reason=reason, note=note
    )

    if report.story_id:
        siblings_q = Q(story_id=report.story_id)
    else:
        siblings_q = Q(message_id=report.message_id)
    siblings = (
        Report.objects.filter(
            siblings_q, status__in=(ReportStatus.OPEN, ReportStatus.REVIEWING)
        )
        .exclude(pk=report.pk)
        .select_related("story", "message")
    )
    for sibling in siblings:
        _apply_decision(
            sibling,
            actor=actor,
            decision=decision,
            status=status,
            reason=reason,
            note=note,
        )
    return report


def _apply_decision(
    report: Report,
    *,
    actor: Account | None,
    decision: str,
    status: str,
    reason: str,
    note: str,
) -> None:
    story = report.story
    message = report.message
    report.status = status
    report.resolved_note = note
    report.updated_at = timezone.now()
    report.save(update_fields=["status", "resolved_note", "updated_at"])

    if decision in ("hide", "remove"):
        if story is not None:
            new_status = (
                StoryStatus.REMOVED if decision == "remove" else StoryStatus.HIDDEN
            )
            try:
                moderate_story(story.id, new_status)
            except StoryNotFound:
                pass  # story already deleted — record the decision only
        if message is not None:
            from apps.dialogue.services import moderator_scrub_message

            moderator_scrub_message(message.id)

    ModerationAction.objects.create(
        report=report,
        story=story,
        message=message,
        actor=actor,
        action=_DECISION_ACTION[decision],
        reason=reason,
        note=note,
    )

    if decision in _TERMINAL_DECISIONS:
        _notify_reporter(report, decision)


def _notify_reporter(report: Report, decision: str) -> None:
    """Notify the reporter about the decision — without the other party's data."""
    if report.from_account is not None:
        recipient = Actor(kind="account", account=report.from_account)
    elif report.from_session is not None:
        recipient = Actor(kind="anonymous", session=report.from_session)
    else:
        return
    try:
        notify(
            recipient,
            NotificationKind.REPORT_RESOLVED,
            {"report_id": str(report.id), "decision": decision},
        )
    except NotificationError:
        pass
