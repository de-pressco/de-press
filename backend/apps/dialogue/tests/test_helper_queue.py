"""Helper dashboard: live queue WS (P5/Q4) + Q8 metrics endpoint."""

from __future__ import annotations

import json

import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import Client
from django.utils import timezone

from apps.dialogue.help import (
    accept_help_request,
    cancel_help_request,
    create_help_request,
)
from apps.dialogue.models import DialogueStatus
from apps.identity.models import Account
from apps.identity.services import Actor
from config.asgi import application

IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


@pytest.fixture
def helper(db):
    return Account.objects.create_user(
        email="dash-h@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )


@pytest.fixture
def visitor(db):
    return Account.objects.create_user(email="dash-v@ex.com", password="password123")


@pytest.fixture
def helper_client(helper):
    c = Client()
    c.force_login(helper)
    return c


@database_sync_to_async
def _comm_for(account) -> WebsocketCommunicator:
    from django.contrib.sessions.backends.db import SessionStore

    store = SessionStore()
    store["_auth_user_id"] = str(account.id)
    store["_auth_user_backend"] = "django.contrib.auth.backends.ModelBackend"
    store["_auth_user_hash"] = account.get_session_auth_hash()
    store.save()
    return WebsocketCommunicator(
        application,
        "/ws/helper/queue/",
        headers=[(b"cookie", f"sessionid={store.session_key}".encode())],
    )


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_queue_ws_requires_helper(settings):
    settings.CHANNEL_LAYERS = IN_MEMORY
    plain = await database_sync_to_async(Account.objects.create_user)(
        email="qws-plain@ex.com",
        password="password123",
    )
    comm = await _comm_for(plain)
    connected, _ = await comm.connect()
    assert connected is False


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_queue_ws_snapshot_and_live_events(settings):
    settings.CHANNEL_LAYERS = IN_MEMORY
    helper = await database_sync_to_async(Account.objects.create_user)(
        email="qws-h@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )
    visitor = await database_sync_to_async(Account.objects.create_user)(
        email="qws-v@ex.com",
        password="password123",
    )

    comm = await _comm_for(helper)
    connected, _ = await comm.connect()
    assert connected is True

    snapshot = await comm.receive_json_from(timeout=5)
    assert snapshot["type"] == "snapshot"
    assert snapshot["queue"] == []

    req = await database_sync_to_async(create_help_request)(
        Actor(kind="account", account=visitor),
        note="very bad day",
    )
    evt = await comm.receive_json_from(timeout=5)
    assert evt["type"] == "queue.new"
    assert evt["request"]["id"] == str(req.id)
    assert evt["request"]["note"] == "very bad day"
    assert evt["request"]["created_at"]

    # A second Helper connection sees the pending row in its snapshot.
    comm2 = await _comm_for(helper)
    connected2, _ = await comm2.connect()
    assert connected2 is True
    snap2 = await comm2.receive_json_from(timeout=5)
    assert [row["id"] for row in snap2["queue"]] == [str(req.id)]

    await database_sync_to_async(accept_help_request)(
        Actor(kind="account", account=helper),
        req.id,
    )
    taken1 = await comm.receive_json_from(timeout=5)
    taken2 = await comm2.receive_json_from(timeout=5)
    assert taken1 == {"type": "queue.taken", "id": str(req.id)}
    assert taken2 == {"type": "queue.taken", "id": str(req.id)}

    await comm.send_to(text_data=json.dumps({"type": "queue.refresh"}))
    snap3 = await comm.receive_json_from(timeout=5)
    assert snap3 == {"type": "snapshot", "queue": []}

    await comm.disconnect()
    await comm2.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_queue_ws_cancel_event(settings):
    settings.CHANNEL_LAYERS = IN_MEMORY
    helper = await database_sync_to_async(Account.objects.create_user)(
        email="qws-h2@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )
    visitor = await database_sync_to_async(Account.objects.create_user)(
        email="qws-v2@ex.com",
        password="password123",
    )

    comm = await _comm_for(helper)
    connected, _ = await comm.connect()
    assert connected is True
    await comm.receive_json_from(timeout=5)  # snapshot

    req = await database_sync_to_async(create_help_request)(
        Actor(kind="account", account=visitor),
    )
    await comm.receive_json_from(timeout=5)  # queue.new

    await database_sync_to_async(cancel_help_request)(
        Actor(kind="account", account=visitor),
        req.id,
    )
    evt = await comm.receive_json_from(timeout=5)
    assert evt == {"type": "queue.cancelled", "id": str(req.id)}

    await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_queue_ws_snapshot_visible_off_duty(settings):
    """D2 (2026-10-27): visibility is not gated by duty — a Helper who comes
    online later still sees the shared pool; duty gates notifications/match."""
    settings.CHANNEL_LAYERS = IN_MEMORY
    helper = await database_sync_to_async(Account.objects.create_user)(
        email="qws-off@ex.com",
        password="password123",
        is_helper=True,  # is_on_duty defaults to False
    )
    visitor = await database_sync_to_async(Account.objects.create_user)(
        email="qws-off-v@ex.com",
        password="password123",
    )
    req = await database_sync_to_async(create_help_request)(
        Actor(kind="account", account=visitor),
        note="я тут",
    )

    comm = await _comm_for(helper)
    connected, _ = await comm.connect()
    assert connected is True
    snapshot = await comm.receive_json_from(timeout=5)
    assert snapshot["type"] == "snapshot"
    assert [row["id"] for row in snapshot["queue"]] == [str(req.id)]
    await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_queue_ws_allows_staff_moderator(settings):
    """Moderator IS a Helper: a staff account connects without an extra flag."""
    settings.CHANNEL_LAYERS = IN_MEMORY
    staff = await database_sync_to_async(Account.objects.create_user)(
        email="qws-staff@ex.com",
        password="password123",
        is_staff=True,
    )
    comm = await _comm_for(staff)
    connected, _ = await comm.connect()
    assert connected is True
    snapshot = await comm.receive_json_from(timeout=5)
    assert snapshot == {"type": "snapshot", "queue": []}
    await comm.disconnect()


@pytest.mark.django_db
def test_helper_dashboard_metrics(helper_client, helper, visitor):
    body = helper_client.get("/api/v1/help/dashboard").json()
    assert body["queue_length"] == 0
    assert body["median_wait_seconds_7d"] is None
    assert body["taken_24h"] == 0
    assert body["closed_7d"] == 0
    assert body["on_duty"] == 1

    req = create_help_request(Actor(kind="account", account=visitor), note="n")
    body = helper_client.get("/api/v1/help/dashboard").json()
    assert body["queue_length"] == 1

    accept_help_request(Actor(kind="account", account=helper), req.id)
    req.refresh_from_db()
    body = helper_client.get("/api/v1/help/dashboard").json()
    assert body["queue_length"] == 0
    assert body["taken_24h"] == 1
    assert body["taken_7d"] == 1
    assert isinstance(body["median_wait_seconds_7d"], int)

    dialogue = req.dialogue
    dialogue.status = DialogueStatus.CLOSED
    dialogue.closed_at = timezone.now()
    dialogue.save(update_fields=["status", "closed_at"])
    body = helper_client.get("/api/v1/help/dashboard").json()
    assert body["closed_24h"] == 1
    assert body["closed_7d"] == 1


@pytest.mark.django_db
def test_helper_dashboard_access():
    assert Client().get("/api/v1/help/dashboard").status_code == 403

    plain = Account.objects.create_user(
        email="dash-plain@ex.com", password="password123"
    )
    c = Client()
    c.force_login(plain)
    assert c.get("/api/v1/help/dashboard").status_code == 403

    staff = Account.objects.create_user(
        email="dash-staff@ex.com", password="password123", is_staff=True
    )
    s = Client()
    s.force_login(staff)
    assert s.get("/api/v1/help/dashboard").status_code == 200
