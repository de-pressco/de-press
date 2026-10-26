"""Admin moderation API: staff-only overview, reports queue, resolve workflow."""

from __future__ import annotations

import pytest
from django.test import Client

from apps.dialogue.models import Dialogue, DialogueSource, Message
from apps.empathy.models import SilentEmpathy
from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.moderation.models import (
    ModerationAction,
    Report,
    ReportReason,
    ReportStatus,
)
from apps.moderation.services import submit_report
from apps.notifications.models import Notification, NotificationKind
from apps.stories.models import StoryStatus
from apps.stories.services import publish_story


def _client(user) -> Client:
    c = Client()
    c.force_login(user)
    return c


def _anon_actor(session: AnonymousSession) -> Actor:
    return Actor(kind="anonymous", session=session)


@pytest.fixture
def staff(db):
    return Account.objects.create_user(
        email="admin@ex.com", password="password123", is_staff=True
    )


@pytest.fixture
def helper(db):
    return Account.objects.create_user(
        email="helper@ex.com", password="password123", is_helper=True
    )


@pytest.fixture
def user(db):
    return Account.objects.create_user(email="user@ex.com", password="password123")


@pytest.fixture
def story(user):
    return publish_story(Actor(kind="account", account=user), "История для модерации.")


# --- Permissions -------------------------------------------------------------------


@pytest.mark.django_db
def test_admin_overview_requires_staff(staff, helper, user):
    assert Client().get("/api/v1/admin/overview").status_code == 403
    assert _client(user).get("/api/v1/admin/overview").status_code == 403
    assert _client(helper).get("/api/v1/admin/overview").status_code == 403
    assert _client(staff).get("/api/v1/admin/overview").status_code == 200


@pytest.mark.django_db
def test_admin_reports_and_resolve_require_staff(staff, helper, user, story):
    report = submit_report(
        Actor(kind="account", account=user), story.id, reason=ReportReason.SPAM
    ).report
    resolve_url = f"/api/v1/admin/reports/{report.id}/resolve"
    valid_body = {"decision": "dismiss", "reason": "other"}
    for client in (Client(), _client(user), _client(helper)):
        assert client.get("/api/v1/admin/reports").status_code == 403
        assert (
            client.post(resolve_url, valid_body, content_type="application/json").status_code
            == 403
        )
        assert client.get("/api/v1/admin/moderation-log").status_code == 403
    assert _client(staff).get("/api/v1/admin/reports").status_code == 200
    assert _client(staff).get("/api/v1/admin/moderation-log").status_code == 200


# --- Overview ---------------------------------------------------------------------


@pytest.mark.django_db
def test_admin_overview_is_counts_only(staff, user, story):
    session = AnonymousSession.objects.create()
    SilentEmpathy.objects.create(story=story, from_session=session)
    submit_report(
        Actor(kind="account", account=user), story.id, reason=ReportReason.SPAM
    )

    response = _client(staff).get("/api/v1/admin/overview")
    data = response.json()
    assert set(data) == {
        "sessions_24h",
        "sessions_7d",
        "sessions_total",
        "stories_total",
        "stories_7d",
        "hears_total",
        "dialogues_open",
        "dialogues_closed",
        "therapy_by_status",
        "pending_clouds",
        "reports_open",
        "reports_reviewing",
        "reports_7d",
        "reports_by_reason",
        "help_queue",
        "helpers_on_duty",
    }
    # Только счётчики: содержимого историй/личностей в ответе нет (Q12).
    assert "История для модерации" not in str(data)
    assert "user@ex.com" not in str(data)
    assert data["stories_total"] == 1
    assert data["hears_total"] == 1
    assert data["reports_open"] == 1
    assert data["reports_by_reason"]["spam"] == 1
    assert "awaiting_payment" in data["therapy_by_status"]


# --- Reports queue ----------------------------------------------------------------


@pytest.mark.django_db
def test_admin_reports_list_no_reporter_identity(staff, user, story):
    submit_report(
        Actor(kind="account", account=user),
        story.id,
        reason=ReportReason.SPAM,
        details="реклама",
    )
    rows = _client(staff).get("/api/v1/admin/reports").json()
    assert rows and rows[0]["target_kind"] == "story"
    assert "История для модерации" in rows[0]["target_text"]
    assert rows[0]["status"] == ReportStatus.OPEN
    assert "user@ex.com" not in str(rows)
    assert "from_account" not in rows[0]


@pytest.mark.django_db
def test_admin_reports_filter_by_status(staff, user, story):
    report = submit_report(
        Actor(kind="account", account=user), story.id, reason=ReportReason.SPAM
    ).report
    open_rows = _client(staff).get("/api/v1/admin/reports?status=open").json()
    assert [r["id"] for r in open_rows] == [str(report.id)]
    resolved_rows = _client(staff).get(
        "/api/v1/admin/reports?status=resolved_hidden"
    ).json()
    assert resolved_rows == []
    assert _client(staff).get("/api/v1/admin/reports?status=bogus").status_code == 400


# --- Resolve workflow ---------------------------------------------------------------


@pytest.mark.django_db
def test_resolve_hides_story_logs_and_notifies(staff, user, story):
    first_session = AnonymousSession.objects.create()
    first = submit_report(
        _anon_actor(first_session), story.id, reason=ReportReason.ABUSE, details="травля"
    ).report
    second_reporter = Account.objects.create_user(
        email="r2@ex.com", password="password123"
    )
    second = submit_report(
        Actor(kind="account", account=second_reporter),
        story.id,
        reason=ReportReason.SPAM,
    ).report

    response = _client(staff).post(
        f"/api/v1/admin/reports/{first.id}/resolve",
        {"decision": "hide", "reason": "abuse", "note": "травля подтверждена"},
        content_type="application/json",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True and body["report"]["target_hidden"] is True

    story.refresh_from_db()
    assert story.status == StoryStatus.HIDDEN
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.status == ReportStatus.RESOLVED_HIDDEN
    assert first.resolved_note == "травля подтверждена"
    # Смежные жалобы на ту же историю закрыты тем же решением.
    assert second.status == ReportStatus.RESOLVED_HIDDEN
    actions = ModerationAction.objects.filter(action="hide")
    assert actions.count() == 2
    assert actions.filter(actor=staff, reason="abuse").count() == 2
    # Оба автора жалоб уведомлены, без данных второй стороны.
    notifs = Notification.objects.filter(kind=NotificationKind.REPORT_RESOLVED)
    assert notifs.count() == 2
    assert "user@ex.com" not in str([n.payload for n in notifs])


@pytest.mark.django_db
def test_resolve_removes_story(staff, user, story):
    report = submit_report(
        Actor(kind="account", account=user), story.id, reason=ReportReason.SPAM
    ).report
    response = _client(staff).post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        {"decision": "remove", "reason": "spam"},
        content_type="application/json",
    )
    assert response.status_code == 200
    story.refresh_from_db()
    assert story.status == StoryStatus.REMOVED
    assert ModerationAction.objects.filter(action="remove").count() == 1


@pytest.mark.django_db
def test_resolve_dismiss_keeps_content(staff, user, story):
    report = submit_report(
        Actor(kind="account", account=user), story.id, reason=ReportReason.OTHER
    ).report
    response = _client(staff).post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        {"decision": "dismiss", "reason": "other", "note": "нарушений нет"},
        content_type="application/json",
    )
    assert response.status_code == 200
    story.refresh_from_db()
    assert story.status == StoryStatus.PUBLISHED
    report.refresh_from_db()
    assert report.status == ReportStatus.RESOLVED_DISMISSED
    assert (
        Notification.objects.filter(kind=NotificationKind.REPORT_RESOLVED).count() == 1
    )


@pytest.mark.django_db
def test_resolve_scrubs_reported_message(staff, user, story):
    dialogue = Dialogue.objects.create(story=story, source=DialogueSource.REQUEST)
    message = Message.objects.create(
        dialogue=dialogue, body="грубое сообщение", from_account=user
    )
    report = submit_report(
        Actor(kind="account", account=user),
        story.id,
        reason=ReportReason.ABUSE,
        message_id=message.id,
    ).report
    response = _client(staff).post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        {"decision": "hide", "reason": "abuse"},
        content_type="application/json",
    )
    assert response.status_code == 200
    story.refresh_from_db()
    message.refresh_from_db()
    assert story.status == StoryStatus.HIDDEN
    assert message.body == ""
    assert message.deleted_at is not None
    row = response.json()["report"]
    assert row["target_kind"] == "story"
    assert row["target_text"] == "История для модерации."


@pytest.mark.django_db
def test_resolve_requires_reason_and_fails_when_already_resolved(staff, user, story):
    report = submit_report(
        Actor(kind="account", account=user), story.id, reason=ReportReason.SPAM
    ).report
    url = f"/api/v1/admin/reports/{report.id}/resolve"
    # Причина обязательна для терминальных решений.
    assert (
        _client(staff)
        .post(url, {"decision": "hide", "reason": ""}, content_type="application/json")
        .status_code
        == 400
    )
    assert (
        _client(staff)
        .post(
            url,
            {"decision": "hide", "reason": "bogus"},
            content_type="application/json",
        )
        .status_code
        == 400
    )
    ok = _client(staff).post(
        url, {"decision": "dismiss", "reason": "other"}, content_type="application/json"
    )
    assert ok.status_code == 200
    # Повторное решение по закрытой жалобе невозможно.
    assert (
        _client(staff)
        .post(
            url,
            {"decision": "dismiss", "reason": "other"},
            content_type="application/json",
        )
        .status_code
        == 400
    )


@pytest.mark.django_db
def test_resolve_unknown_report_returns_404(staff):
    import uuid

    response = _client(staff).post(
        f"/api/v1/admin/reports/{uuid.uuid4()}/resolve",
        {"decision": "dismiss", "reason": "other"},
        content_type="application/json",
    )
    assert response.status_code == 404


# --- Pagination & helpers roster ---------------------------------------------------


@pytest.mark.django_db
def test_admin_reports_pagination_offset(staff, user):
    story = publish_story(Actor(kind="account", account=user), "Жалоба.")
    for reason in (ReportReason.ABUSE, ReportReason.SPAM, ReportReason.OTHER):
        submit_report(Actor(kind="account", account=user), story.id, reason=reason)
    # One open report per account+story is enforced: only the first lands.
    client = _client(staff)
    first = client.get("/api/v1/admin/reports?status=all&limit=1&offset=0").json()
    second = client.get("/api/v1/admin/reports?status=all&limit=1&offset=1").json()
    assert len(first) == 1
    assert len(second) <= 1
    if second:
        assert first[0]["id"] != second[0]["id"]


@pytest.mark.django_db
def test_admin_moderation_log_pagination(staff, user, story):
    submit_report(
        Actor(kind="account", account=user), story.id, reason=ReportReason.SPAM
    )
    report = Report.objects.filter(story=story).first()
    client = _client(staff)
    client.post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        {"decision": "dismiss", "reason": "other"},
        content_type="application/json",
    )
    page = client.get("/api/v1/admin/moderation-log?limit=1&offset=0").json()
    assert len(page) == 1
    assert client.get("/api/v1/admin/moderation-log?limit=1&offset=99").json() == []


@pytest.mark.django_db
def test_admin_helpers_roster_and_duty_toggle(staff, helper):
    client = _client(staff)
    roster = client.get("/api/v1/admin/helpers")
    assert roster.status_code == 200
    rows = roster.json()
    assert [row["email"] for row in rows] == [helper.email]
    assert rows[0]["is_on_duty"] is False

    on = client.post(
        f"/api/v1/admin/helpers/{helper.id}/duty",
        {"on": True},
        content_type="application/json",
    )
    assert on.status_code == 200
    assert on.json()["is_on_duty"] is True
    helper.refresh_from_db()
    assert helper.is_on_duty is True

    # A non-helper account cannot be toggled via this endpoint.
    plain = Account.objects.create_user(email="plain@ex.com", password="password123")
    assert (
        client.post(
            f"/api/v1/admin/helpers/{plain.id}/duty",
            {"on": True},
            content_type="application/json",
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_admin_endpoints_reject_non_staff(helper, user):
    client = _client(user)
    assert client.get("/api/v1/admin/helpers").status_code == 403
    assert (
        client.post(
            f"/api/v1/admin/helpers/{helper.id}/duty",
            {"on": True},
            content_type="application/json",
        ).status_code
        == 403
    )
