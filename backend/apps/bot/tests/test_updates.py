"""process_update end-to-end (DB returning detection, send dispatch)."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.test import override_settings

from apps.bot.updates import process_update
from apps.identity.models import Account


def _update(*, text: str, user_id: int = 555, lang: str = "ru", chat_type="private"):
    return {
        "update_id": 1,
        "message": {
            "message_id": 10,
            "from": {"id": user_id, "language_code": lang},
            "chat": {"id": user_id, "type": chat_type},
            "text": text,
            "date": 1,
        },
    }


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_process_start_sends_welcome_new():
    with patch("apps.bot.updates.send_message", return_value=True) as send:
        outcome = process_update(_update(text="/start"))
    assert outcome == "sent"
    assert send.call_count == 1
    kwargs = send.call_args.kwargs
    assert kwargs["chat_id"] == 555
    assert "<b>de-press</b>" in kwargs["text"]


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_process_start_returning_user_text():
    acc = Account.objects.create_user(
        email="tg555@users.de-press.local",
        password=None,
    )
    acc.set_unusable_password()
    acc.telegram_id = 555
    acc.telegram_language_code = "ru"
    acc.save()

    with patch("apps.bot.updates.send_message", return_value=True) as send:
        outcome = process_update(_update(text="/start"))
    assert outcome == "sent"
    assert "Что открыть" in send.call_args.kwargs["text"]


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_process_plain_message_ignored_from_group():
    with patch("apps.bot.updates.send_message", return_value=True) as send:
        outcome = process_update(
            _update(text="привет", user_id=1, chat_type="supergroup")
        )
    assert outcome == "ignored"
    send.assert_not_called()


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_process_non_text_message_ignored():
    update = _update(text="/start")
    update["message"].pop("text")
    update["message"]["sticker"] = {"file_id": "x"}
    with patch("apps.bot.updates.send_message", return_value=True) as send:
        outcome = process_update(update)
    assert outcome == "ignored"
    send.assert_not_called()


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_fallback_cooldown_per_chat():
    try:
        cache.clear()
        update = _update(text="привет")
        with patch("apps.bot.updates.send_message", return_value=True) as send:
            first = process_update(update)
            second = process_update(update)
        assert first == "sent"
        assert second == "throttled"
        assert send.call_count == 1
    finally:
        cache.clear()


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_send_failure_reported():
    update = _update(text="/panic")
    with patch("apps.bot.updates.send_message", return_value=False) as send:
        outcome = process_update(update)
    assert outcome == "send_failed"
    send.assert_called_once()
