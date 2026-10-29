"""HTTP contract for per-kind notification settings (notify_kinds)."""

from __future__ import annotations

import pytest
from django.test import Client

from apps.identity.models import Account


def _post(client: Client, kinds: dict | None):
    payload: dict = {
        "notify_email_opt_in": False,
        "notify_digest_frequency": "off",
    }
    if kinds is not None:
        payload["notify_kinds"] = kinds
    return client.post(
        "/api/v1/me/notify-settings",
        data=payload,
        content_type="application/json",
    )


@pytest.mark.django_db
def test_notify_kinds_round_trip_and_merge():
    acc = Account.objects.create_user(email="ns@ex.com", password="password123")
    client = Client()
    client.force_login(acc)

    res = _post(client, {"message": False})
    assert res.status_code == 200, res.content
    assert res.json()["notify_kinds"] == {"message": False}

    # Merge: the second key is added, the first survives.
    res = _post(client, {"help_requested": False})
    assert res.status_code == 200
    assert res.json()["notify_kinds"] == {"message": False, "help_requested": False}

    acc.refresh_from_db()
    assert acc.notify_kinds == {"message": False, "help_requested": False}


@pytest.mark.django_db
def test_notify_kinds_rejects_unknown_kind():
    acc = Account.objects.create_user(email="ns2@ex.com", password="password123")
    client = Client()
    client.force_login(acc)

    res = _post(client, {"nope": False})
    assert res.status_code == 400


@pytest.mark.django_db
def test_notify_kinds_rejects_non_bool_value():
    acc = Account.objects.create_user(email="ns3@ex.com", password="password123")
    client = Client()
    client.force_login(acc)

    res = _post(client, {"message": "off"})
    assert res.status_code == 400