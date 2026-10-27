"""HTTP contract for HelpRequest (visitor ask / Helper inbox)."""

from __future__ import annotations

import pytest
from django.conf import settings
from django.test import Client

from apps.identity.models import Account


@pytest.fixture
def helper(db):
    return Account.objects.create_user(
        email="help-api-h@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )


@pytest.fixture
def helper2(db):
    return Account.objects.create_user(
        email="help-api-h2@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )


@pytest.fixture
def helper_client(helper):
    c = Client()
    c.force_login(helper)
    return c


@pytest.fixture
def helper2_client(helper2):
    c = Client()
    c.force_login(helper2)
    return c


@pytest.mark.django_db
def test_anon_create_helper_list_accept_second_fails_anon_list_403_cancel(
    helper_client, helper2_client
):
    anon = Client()
    created = anon.post(
        "/api/v1/help/requests",
        data={"note": "мне тяжело"},
        content_type="application/json",
    )
    assert created.status_code == 200
    body = created.json()
    assert body["note"] == "мне тяжело"
    assert body["status"] == "pending"
    assert body["dialogue_id"] is None
    assert "id" in body
    assert "created_at" in body
    assert settings.ANON_SESSION_COOKIE_NAME in anon.cookies
    req_id = body["id"]

    inbox = helper_client.get("/api/v1/help/requests")
    assert inbox.status_code == 200
    ids = [r["id"] for r in inbox.json()]
    assert req_id in ids

    accepted = helper_client.post(f"/api/v1/help/requests/{req_id}/accept")
    assert accepted.status_code == 200
    dialogue = accepted.json()
    assert dialogue["story_id"] is None
    assert dialogue["source"] == "help"

    second = helper2_client.post(f"/api/v1/help/requests/{req_id}/accept")
    assert second.status_code == 400

    forbidden = Client().get("/api/v1/help/requests")
    assert forbidden.status_code == 403


@pytest.mark.django_db
def test_cancel_then_helper_list_empty(helper_client):
    anon = Client()
    created = anon.post(
        "/api/v1/help/requests",
        data={"note": "отмена"},
        content_type="application/json",
    )
    assert created.status_code == 200
    req_id = created.json()["id"]

    cancelled = anon.post(f"/api/v1/help/requests/{req_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    inbox = helper_client.get("/api/v1/help/requests")
    assert inbox.status_code == 200
    assert inbox.json() == []


@pytest.mark.django_db
def test_anon_create_then_mine_returns_same_pending():
    anon = Client()
    created = anon.post(
        "/api/v1/help/requests",
        data={"note": "мое"},
        content_type="application/json",
    )
    assert created.status_code == 200
    req_id = created.json()["id"]

    mine = anon.get("/api/v1/help/requests/mine")
    assert mine.status_code == 200
    body = mine.json()
    assert body["id"] == req_id
    assert body["status"] == "pending"


@pytest.mark.django_db
def test_helper_skip_hides_from_inbox(helper_client):
    anon = Client()
    created = anon.post(
        "/api/v1/help/requests",
        data={"note": "скип"},
        content_type="application/json",
    )
    assert created.status_code == 200
    req_id = created.json()["id"]

    skipped = helper_client.post(f"/api/v1/help/requests/{req_id}/skip")
    assert skipped.status_code == 200
    assert skipped.json()["status"] == "pending"
    assert skipped.json()["id"] == req_id

    inbox = helper_client.get("/api/v1/help/requests")
    assert inbox.status_code == 200
    assert req_id not in [r["id"] for r in inbox.json()]


@pytest.mark.django_db
def test_helper_sees_the_queue_off_duty():
    """D2 (2026-10-27): the shared pool is visible to every Helper; duty only
    controls notifications and instant match."""
    helper = Account.objects.create_user(
        email="duty-api@ex.com", password="password123", is_helper=True
    )
    client = Client()
    client.force_login(helper)
    anon = Client()
    created = anon.post(
        "/api/v1/help/requests",
        data={"note": "дежурство"},
        content_type="application/json",
    )
    assert created.status_code == 200
    req_id = created.json()["id"]

    off_inbox = client.get("/api/v1/help/requests")
    assert off_inbox.status_code == 200
    assert req_id in [r["id"] for r in off_inbox.json()]

    toggled = client.post(
        "/api/v1/me/helper-duty",
        data={"on": True},
        content_type="application/json",
    )
    assert toggled.status_code == 200
    assert toggled.json()["is_on_duty"] is True

    on_inbox = client.get("/api/v1/help/requests")
    assert on_inbox.status_code == 200
    assert req_id in [r["id"] for r in on_inbox.json()]
