"""Helper dashboard: ethical ops metrics for moderation (not public metrics).

Queue summaries and recent report activity. No "public vanity metrics":
internal aggregates for the team/helpers only.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils import timezone

from apps.moderation.models import Report, ReportReason, ReportStatus
from apps.support.models import SupportCloud, SupportCloudStatus


@dataclass(frozen=True, slots=True)
class ReportRowView:
    id: str
    reason: str
    status: str
    story_preview: str
    details: str
    created_at: str


@dataclass(frozen=True, slots=True)
class DashboardView:
    pending_clouds: int
    open_reports: int
    reviewing_reports: int
    reports_last_7d: int
    recent_reports: list[ReportRowView]


def build_dashboard() -> DashboardView:
    """Light summary for the helper page (no heavy aggregates)."""
    pending_clouds = SupportCloud.objects.filter(
        status=SupportCloudStatus.PENDING
    ).count()
    open_reports = Report.objects.filter(status="open").count()
    reviewing_reports = Report.objects.filter(status="reviewing").count()

    since = timezone.now() - timezone.timedelta(days=7)
    reports_last_7d = Report.objects.filter(created_at__gte=since).count()

    recent_rows = (
        Report.objects.filter(
            status__in=(ReportStatus.OPEN, ReportStatus.REVIEWING)
        )
        .order_by("-created_at")
        .select_related("story", "message")[:10]
    )
    recent = []
    for r in recent_rows:
        if r.story_id and r.story is not None:
            preview = (r.story.body or "")[:120]
        elif r.message_id and r.message is not None:
            preview = (r.message.body or "")[:120]
        else:
            preview = ""
        recent.append(
            ReportRowView(
                id=str(r.id),
                reason=r.reason,
                status=r.status,
                story_preview=preview,
                details=(r.details or "")[:200],
                created_at=r.created_at.isoformat(),
            )
        )
    return DashboardView(
        pending_clouds=pending_clouds,
        open_reports=open_reports,
        reviewing_reports=reviewing_reports,
        reports_last_7d=reports_last_7d,
        recent_reports=recent,
    )


@dataclass(frozen=True, slots=True)
class AdminOverview:
    """Staff overview. Counters only (Q12):

    no IPs/fingerprints/identity lists — aggregates and queues.
    """

    sessions_24h: int
    sessions_7d: int
    sessions_total: int
    stories_total: int
    stories_7d: int
    hears_total: int
    dialogues_open: int
    dialogues_closed: int
    therapy_by_status: dict[str, int]
    pending_clouds: int
    reports_open: int
    reports_reviewing: int
    reports_7d: int
    reports_by_reason: dict[str, int]
    help_queue: int
    helpers_on_duty: int


def build_admin_overview() -> AdminOverview:
    """Light count queries for /admin/overview (no content)."""
    from apps.dialogue.models import (
        Dialogue,
        DialogueStatus,
        HelpRequest,
        HelpRequestStatus,
    )
    from apps.empathy.models import SilentEmpathy
    from apps.identity.models import Account, AnonymousSession
    from apps.stories.models import Story, StoryStatus
    from apps.therapy.models import TherapySession, TherapySessionStatus

    now = timezone.now()
    since_24h = now - timezone.timedelta(hours=24)
    since_7d = now - timezone.timedelta(days=7)
    open_reports = Report.objects.filter(status="open")

    return AdminOverview(
        sessions_24h=AnonymousSession.objects.filter(created_at__gte=since_24h).count(),
        sessions_7d=AnonymousSession.objects.filter(created_at__gte=since_7d).count(),
        sessions_total=AnonymousSession.objects.count(),
        stories_total=Story.objects.filter(status=StoryStatus.PUBLISHED).count(),
        stories_7d=Story.objects.filter(
            status=StoryStatus.PUBLISHED, created_at__gte=since_7d
        ).count(),
        hears_total=SilentEmpathy.objects.count(),
        dialogues_open=Dialogue.objects.filter(status=DialogueStatus.OPEN).count(),
        dialogues_closed=Dialogue.objects.filter(status=DialogueStatus.CLOSED).count(),
        therapy_by_status={
            status: TherapySession.objects.filter(status=status).count()
            for status in TherapySessionStatus.values
        },
        pending_clouds=SupportCloud.objects.filter(
            status=SupportCloudStatus.PENDING
        ).count(),
        reports_open=open_reports.count(),
        reports_reviewing=Report.objects.filter(status="reviewing").count(),
        reports_7d=Report.objects.filter(created_at__gte=since_7d).count(),
        reports_by_reason={
            reason: open_reports.filter(reason=reason).count()
            for reason in ReportReason.values
        },
        help_queue=HelpRequest.objects.filter(
            status=HelpRequestStatus.PENDING
        ).count(),
        helpers_on_duty=Account.objects.on_duty_helpers().count(),
    )