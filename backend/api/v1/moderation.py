from __future__ import annotations

from datetime import datetime
from uuid import UUID

from ninja import Router, Schema
from ninja.errors import HttpError

from apps.identity.services import require_actor
from apps.moderation.blocks import (
    BlockError,
    block_actor,
    block_peer_in_dialogue,
    list_blocks_for,
    unblock_by_id,
    unblock_peer_in_dialogue,
)
from apps.moderation.models import (
    ModerationAction,
    ModerationActionKind,
    Report,
    ReportReason,
    ReportStatus,
)
from apps.moderation.services import ReportError, resolve_report, submit_message_report, submit_report
from apps.stories.services import StoryNotFound

router = Router(tags=["moderation"])


class DashboardOut(Schema):
    pending_clouds: int
    open_reports: int
    reviewing_reports: int
    reports_last_7d: int
    recent_reports: list[dict] = []


class ReportIn(Schema):
    reason: str
    details: str = ""


class ReportOut(Schema):
    ok: bool
    created: bool
    report_id: str
    message: str


class BlockIn(Schema):
    account_id: str | None = None
    session_id: str | None = None


class BlockOut(Schema):
    ok: bool
    created: bool
    message: str


class BlockItemOut(Schema):
    id: str
    created_at: datetime
    label: str
    target_kind: str


@router.get("/moderation/dashboard", response=DashboardOut)
def helper_dashboard(request):
    """Queue summary and recent reports for helpers (ethical metrics)."""
    actor = require_actor(request)
    if actor.account is None or not (
        actor.account.is_helper or actor.account.is_staff or actor.account.is_superuser
    ):
        raise HttpError(403, "Helper or staff role required")
    from apps.moderation.dashboard import build_dashboard

    view = build_dashboard()
    return DashboardOut(
        pending_clouds=view.pending_clouds,
        open_reports=view.open_reports,
        reviewing_reports=view.reviewing_reports,
        reports_last_7d=view.reports_last_7d,
        recent_reports=[
            {
                "id": r.id,
                "reason": r.reason,
                "status": r.status,
                "story_preview": r.story_preview,
                "details": r.details,
                "created_at": r.created_at,
            }
            for r in view.recent_reports
        ],
    )


@router.post("/stories/{story_id}/report", response=ReportOut)
def report_story(request, story_id: UUID, payload: ReportIn):
    actor = require_actor(request)
    if payload.reason not in ReportReason.values:
        raise HttpError(
            400,
            f"Invalid reason. Allowed: {', '.join(ReportReason.values)}",
        )
    try:
        result = submit_report(
            actor,
            story_id,
            reason=payload.reason,
            details=payload.details,
        )
    except StoryNotFound as exc:
        raise HttpError(404, str(exc)) from exc
    except ReportError as exc:
        raise HttpError(400, str(exc)) from exc

    return ReportOut(
        ok=True,
        created=result.created,
        report_id=str(result.report.id),
        message=(
            "Report received. Thank you for helping keep this place safe."
            if result.created
            else "You have already reported this story."
        ),
    )


@router.post("/messages/{message_id}/report", response=ReportOut)
def report_message(request, message_id: UUID, payload: ReportIn):
    actor = require_actor(request)
    if payload.reason not in ReportReason.values:
        raise HttpError(
            400,
            f"Invalid reason. Allowed: {', '.join(ReportReason.values)}",
        )
    try:
        result = submit_message_report(
            actor,
            message_id,
            reason=payload.reason,
            details=payload.details,
        )
    except StoryNotFound as exc:
        raise HttpError(404, str(exc)) from exc
    except ReportError as exc:
        raise HttpError(400, str(exc)) from exc
    return ReportOut(
        ok=True,
        created=result.created,
        report_id=str(result.report.id),
        message=(
            "Message report received."
            if result.created
            else "You have already reported this."
        ),
    )


@router.post("/blocks", response=BlockOut)
def create_block(request, payload: BlockIn):
    actor = require_actor(request)
    acc = UUID(payload.account_id) if payload.account_id else None
    sess = UUID(payload.session_id) if payload.session_id else None
    try:
        result = block_actor(
            actor,
            target_account_id=acc,
            target_session_id=sess,
        )
    except (BlockError, ValueError) as exc:
        raise HttpError(400, str(exc)) from exc
    return BlockOut(
        ok=True,
        created=result.created,
        message="Person hidden from your feed." if result.created else "Already hidden.",
    )


@router.post("/dialogues/{dialogue_id}/block-peer", response=BlockOut)
def block_dialogue_peer(request, dialogue_id: UUID):
    actor = require_actor(request)
    try:
        result = block_peer_in_dialogue(actor, dialogue_id)
    except BlockError as exc:
        raise HttpError(400, str(exc)) from exc
    return BlockOut(
        ok=True,
        created=result.created,
        message=(
            "Person hidden. New requests and stories from them will not appear."
            if result.created
            else "Already hidden."
        ),
    )


@router.post("/dialogues/{dialogue_id}/unblock-peer", response=BlockOut)
def unblock_dialogue_peer(request, dialogue_id: UUID):
    actor = require_actor(request)
    try:
        removed = unblock_peer_in_dialogue(actor, dialogue_id)
    except BlockError as exc:
        raise HttpError(400, str(exc)) from exc
    return BlockOut(
        ok=True,
        created=removed > 0,
        message=(
            "Person visible in your feed again."
            if removed
            else "They were not hidden."
        ),
    )


@router.get("/blocks", response=list[BlockItemOut])
def list_blocks(request):
    """Blocks made by the viewer — for the chat-side blocked-users list."""
    actor = require_actor(request)
    return [
        BlockItemOut(
            id=str(entry.id),
            created_at=entry.created_at,
            label=entry.label,
            target_kind=entry.target_kind,
        )
        for entry in list_blocks_for(actor)
    ]


@router.delete("/blocks/{block_id}", response=BlockOut)
def delete_block(request, block_id: UUID):
    actor = require_actor(request)
    try:
        removed = unblock_by_id(actor, block_id)
    except BlockError as exc:
        raise HttpError(400, str(exc)) from exc
    return BlockOut(
        ok=removed,
        created=False,
        message=(
            "Person visible in your feed again."
            if removed
            else "Block not found."
        ),
    )


# --- Admin (staff) -----------------------------------------------------------------


class AdminOverviewOut(Schema):
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


class AdminReportOut(Schema):
    id: str
    status: str
    reason: str
    details: str
    target_kind: str
    target_text: str
    target_hidden: bool
    created_at: str
    resolved_note: str
    # Ticket trail (Q12: the moderator's own decision, never reporter/author data).
    decision: str = ""
    resolved_by: str = ""
    resolution_reason: str = ""
    resolved_at: str = ""


class AdminResolveIn(Schema):
    decision: str
    reason: str = ""
    note: str = ""


class AdminResolveOut(Schema):
    ok: bool
    report: AdminReportOut


class AdminActionOut(Schema):
    id: str
    action: str
    reason: str
    note: str
    actor_email: str
    report_id: str | None
    story_id: str | None
    message_id: str | None
    cloud_id: str | None
    created_at: str


class AdminHelperOut(Schema):
    id: str
    email: str
    helper_org: str
    is_on_duty: bool
    is_active: bool
    last_seen_at: str | None = None


class AdminHelperDutyIn(Schema):
    on: bool


def _require_staff_only(actor) -> None:
    acc = actor.account
    if acc is None or not (acc.is_staff or acc.is_superuser):
        raise HttpError(403, "Staff access required")


# Presentation normalisation for audit rows written before 2026-10-27, where the
# service stored the decision word ("dismiss") instead of the model choice.
_ACTION_WORD = {"hide": "hidden", "remove": "removed", "dismiss": "dismissed"}


def _latest_actions(report_ids) -> dict[str, ModerationAction]:
    """Latest terminal decision per report: who closed the ticket, when and why."""
    latest: dict[str, ModerationAction] = {}
    if not report_ids:
        return latest
    rows = (
        ModerationAction.objects.filter(
            report_id__in=report_ids,
            # Terminal only; legacy rows keep the decision word (see _ACTION_WORD).
            action__in=(
                ModerationActionKind.HIDDEN,
                ModerationActionKind.REMOVED,
                ModerationActionKind.DISMISSED,
                "hide",
                "remove",
                "dismiss",
            ),
        )
        .select_related("actor")
        .order_by("created_at")
    )
    for action in rows:
        latest[str(action.report_id)] = action
    return latest


def _admin_report_out(
    report: Report, action: ModerationAction | None = None
) -> AdminReportOut:
    """The moderator sees only the reported content itself (Q12), never the reporter identity."""
    if report.story_id and report.story is not None:
        target_kind = "story"
        target_text = report.story.body or ""
        target_hidden = report.story.status in ("hidden", "removed", "draft")
    else:
        target_kind = "message"
        target_text = ""
        target_hidden = False
        if report.message is not None:
            target_text = report.message.body or report.message.transcript or ""
            target_hidden = bool(report.message.deleted_at)
    return AdminReportOut(
        id=str(report.id),
        status=report.status,
        reason=report.reason,
        details=(report.details or "")[:500],
        target_kind=target_kind,
        target_text=target_text[:600],
        target_hidden=target_hidden,
        created_at=report.created_at.isoformat(),
        resolved_note=report.resolved_note or "",
        decision=_ACTION_WORD.get(action.action, action.action) if action else "",
        resolved_by=(action.actor.email if action and action.actor else ""),
        resolution_reason=action.reason if action else "",
        resolved_at=action.created_at.isoformat() if action else "",
    )


@router.get("/admin/overview", response=AdminOverviewOut)
def admin_overview(request):
    """Staff overview: counters only, no content."""
    actor = require_actor(request)
    _require_staff_only(actor)
    from apps.moderation.dashboard import build_admin_overview

    view = build_admin_overview()
    return AdminOverviewOut(
        sessions_24h=view.sessions_24h,
        sessions_7d=view.sessions_7d,
        sessions_total=view.sessions_total,
        stories_total=view.stories_total,
        stories_7d=view.stories_7d,
        hears_total=view.hears_total,
        dialogues_open=view.dialogues_open,
        dialogues_closed=view.dialogues_closed,
        therapy_by_status=dict(view.therapy_by_status),
        pending_clouds=view.pending_clouds,
        reports_open=view.reports_open,
        reports_reviewing=view.reports_reviewing,
        reports_7d=view.reports_7d,
        reports_by_reason=dict(view.reports_by_reason),
        help_queue=view.help_queue,
        helpers_on_duty=view.helpers_on_duty,
    )


@router.get("/admin/reports", response=list[AdminReportOut])
def admin_reports(request, status: str = "open", limit: int = 50, offset: int = 0):
    """Staff report queue: status filter, no reporter identities."""
    actor = require_actor(request)
    _require_staff_only(actor)
    if status not in ("all", "resolved") and status not in ReportStatus.values:
        raise HttpError(
            400,
            f"Invalid status. Allowed: all, resolved, {', '.join(ReportStatus.values)}",
        )
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    qs = Report.objects.order_by("-created_at").select_related("story", "message")
    if status == "resolved":
        # Both resolved kinds — the history view; `decision` tells them apart.
        qs = qs.filter(status__startswith="resolved_")
    elif status != "all":
        qs = qs.filter(status=status)
    page = list(qs[offset : offset + limit])
    actions = _latest_actions([r.id for r in page])
    return [_admin_report_out(r, actions.get(str(r.id))) for r in page]


@router.post("/admin/reports/{report_id}/resolve", response=AdminResolveOut)
def admin_resolve_report(request, report_id: UUID, payload: AdminResolveIn):
    """Report decision: hide|remove|dismiss + a mandatory reason (Q12)."""
    actor = require_actor(request)
    _require_staff_only(actor)
    try:
        report = resolve_report(
            report_id,
            actor=actor.account,
            decision=payload.decision,
            reason=payload.reason,
            note=payload.note,
        )
    except ReportError as exc:
        msg = str(exc)
        raise HttpError(404 if "not found" in msg else 400, msg) from exc
    fresh = Report.objects.select_related("story", "message").get(pk=report.id)
    actions = _latest_actions([fresh.id])
    return AdminResolveOut(
        ok=True, report=_admin_report_out(fresh, actions.get(str(fresh.id)))
    )


@router.get("/admin/moderation-log", response=list[AdminActionOut])
def admin_moderation_log(request, limit: int = 100, offset: int = 0):
    """Moderation action log: who, what, why."""
    actor = require_actor(request)
    _require_staff_only(actor)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    rows = ModerationAction.objects.select_related("actor")[offset : offset + limit]
    return [
        AdminActionOut(
            id=str(a.id),
            action=_ACTION_WORD.get(a.action, a.action),
            reason=a.reason,
            note=a.note,
            actor_email=(a.actor.email if a.actor else ""),
            report_id=str(a.report_id) if a.report_id else None,
            story_id=str(a.story_id) if a.story_id else None,
            message_id=str(a.message_id) if a.message_id else None,
            cloud_id=str(a.cloud_id) if a.cloud_id else None,
            created_at=a.created_at.isoformat(),
        )
        for a in rows
    ]


def _admin_helper_out(acc) -> AdminHelperOut:
    return AdminHelperOut(
        id=str(acc.id),
        email=acc.email,
        helper_org=acc.helper_org or "",
        is_on_duty=acc.is_on_duty,
        is_active=acc.is_active,
        last_seen_at=acc.helper_seen_at.isoformat() if acc.helper_seen_at else None,
    )


@router.get("/admin/helpers", response=list[AdminHelperOut])
def admin_helpers(request, limit: int = 100):
    """Helper roster (staff only): who can take human-help requests."""
    actor = require_actor(request)
    _require_staff_only(actor)
    from apps.identity.models import Account

    limit = max(1, min(limit, 200))
    rows = Account.objects.filter(is_helper=True).order_by("-is_on_duty", "email")[:limit]
    return [_admin_helper_out(acc) for acc in rows]


@router.post("/admin/helpers/{account_id}/duty", response=AdminHelperOut)
def admin_helper_duty(request, account_id: UUID, payload: AdminHelperDutyIn):
    """Staff can put a Helper on/off duty without touching Django admin."""
    actor = require_actor(request)
    _require_staff_only(actor)
    from apps.identity.models import Account

    try:
        acc = Account.objects.get(pk=account_id, is_helper=True)
    except Account.DoesNotExist as exc:
        raise HttpError(404, "Helper not found") from exc
    acc.is_on_duty = bool(payload.on)
    acc.save(update_fields=["is_on_duty"])
    return _admin_helper_out(acc)
