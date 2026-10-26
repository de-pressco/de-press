"""HTTP contract tests for the therapy endpoints (ADR 0022)."""

from __future__ import annotations

import pytest
from django.test import Client
from django.conf import settings

from apps.identity.cookies import sign_anon_session_id
from apps.identity.models import AnonymousSession
from apps.therapy.models import TherapySessionStatus
from apps.therapy.tests.test_therapy import SOL_ADDR, make_profile


def anon_client(session_id: str) -> Client:
    client = Client()
    client.cookies[settings.ANON_SESSION_COOKIE_NAME] = sign_anon_session_id(
        session_id
    )
    return client


@pytest.mark.django_db
def test_profiles_public_and_session_http_flow():
    profile = make_profile()

    public = Client().get("/api/v1/therapy/profiles")
    assert public.status_code == 200
    rows = public.json()
    assert len(rows) == 1
    assert rows[0]["pseudonym"] == "Д-р Тихий"
    assert rows[0]["solana_address"] == SOL_ADDR
    assert "account" not in rows[0]  # never leak the therapist's account

    anon = AnonymousSession.objects.create(pseudonym="клиент")
    client = anon_client(str(anon.id))

    created = client.post(
        "/api/v1/therapy/sessions",
        content_type="application/json",
        data={"therapist_id": str(profile.id), "note": "можно мне сессию"},
    )
    assert created.status_code == 200, created.content
    body = created.json()
    sid = body["id"]
    assert body["status"] == TherapySessionStatus.AWAITING_PAYMENT
    assert body["dialogue_id"] is None

    mine = client.get("/api/v1/me/therapy/sessions")
    assert [s["id"] for s in mine.json()] == [sid]

    foreign = Client().get("/api/v1/me/therapy/sessions")
    assert foreign.json() == []

    ipaid = client.post(f"/api/v1/therapy/sessions/{sid}/i-paid")
    assert ipaid.status_code == 200
    assert ipaid.json()["status"] == TherapySessionStatus.PAYMENT_CLAIMED

    inbox = Client()
    inbox.force_login(profile.account)
    listed = inbox.get("/api/v1/me/therapy/inbox")
    assert listed.status_code == 200
    assert [s["id"] for s in listed.json()] == [sid]
    assert listed.json()[0]["client_label"] == "клиент"

    confirmed = inbox.post(f"/api/v1/therapy/sessions/{sid}/confirm")
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == TherapySessionStatus.PAID
    dialogue_id = confirmed.json()["dialogue_id"]
    assert dialogue_id

    done = inbox.post(f"/api/v1/therapy/sessions/{sid}/complete")
    assert done.json()["status"] == TherapySessionStatus.DONE

    # Non-participant cannot see the session
    other = anon_client(str(AnonymousSession.objects.create().id))
    assert other.get(f"/api/v1/therapy/sessions/{sid}").status_code == 404


@pytest.mark.django_db
def test_me_reports_therapist_flag():
    profile = make_profile()
    c = Client()
    c.force_login(profile.account)
    me = c.get("/api/v1/me").json()
    assert me["is_therapist"] is True
