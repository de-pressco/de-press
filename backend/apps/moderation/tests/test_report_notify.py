"""New report → REPORT_NEW notification to on-duty Helpers."""

from __future__ import annotations

import pytest

from apps.dialogue.help import accept_help_request, create_help_request
from apps.dialogue.services import send_message
from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.moderation.models import ReportReason
from apps.moderation.services import submit_message_report, submit_report
from apps.notifications.models import Notification, NotificationKind
from apps.stories.services import publish_story


def _on_duty_helper(email: str, *, opt_out: bool = False) -> Account:
    acc = Account.objects.create_user(
        email=email, password="password123", is_helper=True, is_on_duty=True
    )
    if opt_out:
        acc.notify_kinds = {"report_new": False}
        acc.save(update_fields=["notify_kinds"])
    return acc


def _story(actor_email: str, body: str):
    author = Account.objects.create_user(email=actor_email, password="password123")
    return publish_story(Actor(kind="account", account=author), body)


@pytest.mark.django_db
def test_story_report_notifies_on_duty_helpers_only():
    on = _on_duty_helper("rn-on@ex.com")
    Account.objects.create_user(  # off duty → no ping
        email="rn-off@ex.com", password="password123", is_helper=True
    )
    story = _story("rn-a@ex.com", "История.")
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())

    submit_report(visitor, story.id, reason=ReportReason.ABUSE, details="троллинг")

    assert Notification.objects.filter(
        kind=NotificationKind.REPORT_NEW, recipient_account=on
    ).exists()
    row = Notification.objects.get(
        kind=NotificationKind.REPORT_NEW, recipient_account=on
    )
    assert row.payload["source"] == "story"
    assert row.payload["reason"] == ReportReason.ABUSE
    assert not Notification.objects.filter(
        kind=NotificationKind.REPORT_NEW,
        recipient_account__isnull=True,
    ).exists()


@pytest.mark.django_db
def test_reporter_helper_not_notified_about_own_report():
    reporter = _on_duty_helper("rn-self@ex.com")
    story = _story("rn-a2@ex.com", "История 2.")

    submit_report(
        Actor(kind="account", account=reporter), story.id, reason=ReportReason.SPAM
    )

    assert not Notification.objects.filter(
        kind=NotificationKind.REPORT_NEW, recipient_account=reporter
    ).exists()


@pytest.mark.django_db
def test_duplicate_report_does_not_notify_again():
    on = _on_duty_helper("rn-dup@ex.com")
    story = _story("rn-a3@ex.com", "История 3.")
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())

    submit_report(visitor, story.id, reason=ReportReason.ABUSE)
    assert Notification.objects.filter(kind=NotificationKind.REPORT_NEW).count() == 1

    submit_report(visitor, story.id, reason=ReportReason.SPAM)  # created=False
    assert Notification.objects.filter(kind=NotificationKind.REPORT_NEW).count() == 1
    assert on  # helper referenced to keep the fixture explicit


@pytest.mark.django_db
def test_help_message_report_notifies_and_respects_opt_out():
    helper_acc = Account.objects.create_user(  # accepted, off duty → no ping
        email="rn-help@ex.com", password="password123", is_helper=True
    )
    on = _on_duty_helper("rn-help-on@ex.com")
    off = _on_duty_helper("rn-help-opt@ex.com", opt_out=True)
    helper = Actor(kind="account", account=helper_acc)
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)

    req = create_help_request(visitor, note="мне тяжело")
    dialogue = accept_help_request(helper, req.id)
    msg = send_message(helper, dialogue.id, "я рядом")

    result = submit_message_report(
        visitor, msg.id, reason=ReportReason.ABUSE, details="плохо"
    )
    assert result.created is True

    row = Notification.objects.get(
        kind=NotificationKind.REPORT_NEW, recipient_account=on
    )
    assert row.payload["source"] == "help"
    assert not Notification.objects.filter(
        kind=NotificationKind.REPORT_NEW, recipient_account=off
    ).exists()