from __future__ import annotations

from datetime import timedelta

import pytest
from django.test import Client
from django.utils import timezone

from apps.dialogue.help import create_help_request, list_help_inbox
from apps.dialogue.models import DialogueSource
from apps.dialogue.presence import (
    ONLINE_WINDOW,
    pick_helper_for_match,
    presence_for,
    touch_helper,
)
from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.moderation.blocks import block_actor
from apps.notifications.models import Notification, NotificationKind


def _online_helper(email: str, **extra) -> Account:
    acc = Account.objects.create_user(
        email=email,
        password="password123",
        is_helper=True,
        is_on_duty=True,
        **extra,
    )
    acc.helper_seen_at = timezone.now()
    acc.save(update_fields=["helper_seen_at"])
    return acc


@pytest.mark.django_db
def test_stale_heartbeat_is_not_online():
    acc = _online_helper("stale@ex.com")
    acc.helper_seen_at = timezone.now() - ONLINE_WINDOW - timedelta(seconds=5)
    acc.save(update_fields=["helper_seen_at"])
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    assert pick_helper_for_match(visitor) is None
    flags = presence_for(visitor)
    assert flags["someone_on_duty"] is True
    assert flags["someone_online"] is False


@pytest.mark.django_db
def test_off_duty_online_is_not_picked():
    acc = Account.objects.create_user(
        email="offping@ex.com", password="password123", is_helper=True
    )
    acc.helper_seen_at = timezone.now()
    acc.save(update_fields=["helper_seen_at"])
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    assert pick_helper_for_match(visitor) is None
    flags = presence_for(visitor)
    assert flags["someone_on_duty"] is False
    assert flags["someone_online"] is False


@pytest.mark.django_db
def test_instant_match_assigns_one_helper_skips_queue():
    chosen = _online_helper("live@ex.com")
    other = Account.objects.create_user(
        email="queued@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    req = create_help_request(visitor, note="мне тяжело")
    req.refresh_from_db()
    assert req.status == "accepted"
    assert req.accepted_by_id == chosen.id
    assert req.dialogue_id is not None
    assert req.dialogue.source == DialogueSource.HELP
    assert list_help_inbox(Actor(kind="account", account=chosen)) == []
    assert list_help_inbox(Actor(kind="account", account=other)) == []
    # Only the matched helper is pinged, and as a fresh request (B14).
    assert not Notification.objects.filter(
        kind=NotificationKind.HELP_REQUESTED, recipient_account=other
    ).exists()
    assert Notification.objects.filter(
        kind=NotificationKind.HELP_REQUESTED, recipient_account=chosen
    ).exists()
    assert Notification.objects.filter(
        kind=NotificationKind.HELP_ACCEPTED, recipient_session=visitor.session
    ).exists()
    assert not Notification.objects.filter(
        kind=NotificationKind.HELP_ACCEPTED, recipient_account=chosen
    ).exists()
    chosen.refresh_from_db()
    assert chosen.helper_last_matched_at is not None


@pytest.mark.django_db
def test_on_duty_without_ping_stays_in_queue():
    helper = Account.objects.create_user(
        email="dutyonly@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    req = create_help_request(visitor)
    assert req.status == "pending"
    assert list_help_inbox(Actor(kind="account", account=helper))[0].id == req.id


@pytest.mark.django_db
def test_least_recent_match_wins():
    older = _online_helper("rr1@ex.com")
    newer = _online_helper("rr2@ex.com")
    older.helper_last_matched_at = timezone.now() - timedelta(hours=2)
    newer.helper_last_matched_at = timezone.now() - timedelta(minutes=1)
    older.save(update_fields=["helper_last_matched_at"])
    newer.save(update_fields=["helper_last_matched_at"])
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    req = create_help_request(visitor)
    req.refresh_from_db()
    assert req.accepted_by_id == older.id


@pytest.mark.django_db
def test_blocked_online_helper_is_skipped():
    blocked = _online_helper("blk@ex.com")
    other = _online_helper("ok@ex.com")
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)
    block_actor(Actor(kind="account", account=blocked), target_session_id=sess.id)
    req = create_help_request(visitor)
    req.refresh_from_db()
    assert req.accepted_by_id == other.id


@pytest.mark.django_db
def test_touch_helper_and_http_presence_heartbeat():
    helper = Account.objects.create_user(
        email="beat@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )
    actor = Actor(kind="account", account=helper)
    assert presence_for(Actor(kind="anonymous", session=None))["someone_online"] is False
    touch_helper(actor)
    helper.refresh_from_db()
    assert helper.helper_seen_at is not None
    assert presence_for(Actor(kind="anonymous", session=None))["someone_online"] is True

    client = Client()
    client.force_login(helper)
    beat = client.post("/api/v1/help/heartbeat")
    assert beat.status_code == 200
    assert beat.json()["ok"] is True
    flags = client.get("/api/v1/help/presence")
    assert flags.status_code == 200
    body = flags.json()
    assert body["someone_on_duty"] is False  # excludes self
    assert body["someone_online"] is False
    anon = Client().get("/api/v1/help/presence")
    assert anon.status_code == 200
    assert anon.json()["someone_on_duty"] is True
    assert anon.json()["someone_online"] is True

    plain = Account.objects.create_user(email="noh@ex.com", password="password123")
    other = Client()
    other.force_login(plain)
    denied = other.post("/api/v1/help/heartbeat")
    assert denied.status_code == 403


@pytest.mark.django_db
def test_http_create_instant_match_returns_accepted():
    helper = _online_helper("http-live@ex.com")
    client = Client()
    client.force_login(helper)
    client.post("/api/v1/help/heartbeat")
    anon = Client()
    created = anon.post(
        "/api/v1/help/requests",
        data={"note": "мгновенно"},
        content_type="application/json",
    )
    assert created.status_code == 200
    body = created.json()
    assert body["status"] == "accepted"
    assert body["dialogue_id"]
    inbox = client.get("/api/v1/help/requests")
    assert inbox.status_code == 200
    assert inbox.json() == []
    mine = anon.get("/api/v1/help/requests/mine")
    assert mine.status_code == 200
    assert mine.json()["status"] == "accepted"
    assert mine.json()["dialogue_id"] == body["dialogue_id"]
