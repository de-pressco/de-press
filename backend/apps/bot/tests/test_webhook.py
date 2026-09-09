"""Webhook endpoint: auth boundary and dispatch."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from django.test import Client, override_settings

URL = "/api/v1/bot/webhook"
HEADER = "HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN"


def _post(client: Client, *, secret: str | None, body: dict | None = None) -> object:
    headers = {}
    if secret is not None:
        headers[HEADER] = secret
    payload = json.dumps(body if body is not None else {"update_id": 1})
    return client.post(URL, data=payload, content_type="application/json", **headers)


@override_settings(TELEGRAM_BOT_WEBHOOK_SECRET="")
def test_disabled_without_secret():
    client = Client()
    resp = _post(client, secret=None)
    assert resp.status_code == 401


@override_settings(TELEGRAM_BOT_WEBHOOK_SECRET="topsecret")
def test_wrong_or_missing_secret_rejected():
    client = Client()
    assert _post(client, secret=None).status_code == 403
    assert _post(client, secret="wrong").status_code == 403


@override_settings(TELEGRAM_BOT_WEBHOOK_SECRET="topsecret")
def test_valid_update_dispatched():
    client = Client()
    update = {
        "update_id": 7,
        "message": {
            "message_id": 1,
            "from": {"id": 42, "language_code": "ru"},
            "chat": {"id": 42, "type": "private"},
            "text": "/start",
            "date": 1,
        },
    }
    with patch("api.v1.bot.process_update", return_value="sent") as process:
        resp = _post(client, secret="topsecret", body=update)
    assert resp.status_code == 200
    process.assert_called_once_with(update)


@override_settings(TELEGRAM_BOT_WEBHOOK_SECRET="topsecret")
def test_invalid_json_rejected():
    client = Client()
    resp = client.post(
        URL,
        data="{not json",
        content_type="application/json",
        HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="topsecret",
    )
    assert resp.status_code == 400
