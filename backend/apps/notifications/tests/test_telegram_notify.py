from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.identity.models import Account
from apps.identity.services import Actor
from apps.notifications.models import Notification, NotificationKind
from apps.notifications.telegram_notify import (
    account_wants_telegram_daily_digest,
    account_wants_telegram_soft_notify,
    build_checkin_nudge_message,
    build_digest_message,
    build_soft_notify_message,
    format_checkin_nudge_text,
    format_digest_text,
    format_soft_notify_text,
    maybe_send_telegram_soft_notify,
    run_checkin_nudges,
    run_telegram_daily_digests,
    send_checkin_nudge_for_account,
    send_telegram_daily_digest_for_account,
    startapp_for_notification,
    unread_for_telegram_digest,
)
from apps.notifications.tg_api import mini_app_deep_link


def test_startapp_for_notification_mapping():
    did = str(uuid4())
    sid = str(uuid4())
    assert (
        startapp_for_notification("message", {"dialogue_id": did})
        == f"chat_{did}"
    )
    assert (
        startapp_for_notification("support_cloud", {"story_id": sid})
        == f"story_{sid}"
    )
    assert startapp_for_notification("dialogue_request", {}) == "chat"
    assert startapp_for_notification("cloud_approved", {}) == "notifications"


@override_settings(TELEGRAM_BOT_USERNAME="depress_bot")
def test_mini_app_deep_link():
    assert (
        mini_app_deep_link("inbox")
        == "https://t.me/depress_bot?startapp=inbox"
    )


@override_settings(TELEGRAM_BOT_USERNAME="")
@override_settings(PUBLIC_BASE_URL="http://127.0.0.1:5174")
def test_mini_app_deep_link_web_fallback():
    assert (
        mini_app_deep_link("chat")
        == "http://127.0.0.1:5174/?startapp=chat"
    )


def test_format_soft_notify_text_en_html():
    text = format_soft_notify_text("message", {"dialogue_id": str(uuid4())})
    assert "<b>" in text
    assert "message" in text.lower() or "dialogue" in text.lower()
    assert "https://t.me/" not in text  # links live in the button, not the text


def test_build_soft_notify_message_has_open_button():
    did = str(uuid4())
    with override_settings(TELEGRAM_BOT_USERNAME="depress_bot"):
        text, markup = build_soft_notify_message("message", {"dialogue_id": did})
    assert text.startswith("<b>")
    assert markup is not None
    button = markup["inline_keyboard"][0][0]
    assert button["url"] == f"https://t.me/depress_bot?startapp=chat_{did}"


def test_soft_notify_ru_locale_uses_ru_label():
    text, markup = build_soft_notify_message("message", {}, locale="ru")
    assert "Новое сообщение в диалоге" in text
    assert markup is not None
    assert markup["inline_keyboard"][0][0]["text"] == "Открыть"


def test_soft_notify_no_username_no_link_button():
    with override_settings(TELEGRAM_BOT_USERNAME="", PUBLIC_BASE_URL=""):
        _, markup = build_soft_notify_message("message", {})
    assert markup is None


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_account_wants_telegram_soft_notify():
    acc = Account.objects.create_user(
        email="tg1@users.de-press.local",
        password=None,
    )
    acc.set_unusable_password()
    acc.telegram_id = 1001
    acc.notify_telegram_opt_in = True
    acc.notify_digest_frequency = "immediate"
    acc.save()
    assert account_wants_telegram_soft_notify(acc) is True

    acc.notify_telegram_opt_in = False
    acc.save(update_fields=["notify_telegram_opt_in"])
    assert account_wants_telegram_soft_notify(acc) is False


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test", TELEGRAM_BOT_USERNAME="bot")
def test_maybe_send_calls_bot_api():
    acc = Account.objects.create_user(
        email="tg2@users.de-press.local",
        password="unusedpass1",
    )
    acc.telegram_id = 2002
    acc.notify_telegram_opt_in = True
    acc.notify_digest_frequency = "immediate"
    acc.save()

    notif = Notification.objects.create(
        recipient_account=acc,
        kind=NotificationKind.MESSAGE,
        payload={"dialogue_id": str(uuid4())},
    )
    actor = Actor(kind="account", account=acc)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = "ok"
    mock_resp.json.return_value = {"ok": True, "result": {"message_id": 1}}

    with patch("apps.notifications.tg_api.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = None
        client.post.return_value = mock_resp
        client_cls.return_value = client

        ok = maybe_send_telegram_soft_notify(actor, notif)
        assert ok is True
        client.post.assert_called_once()
        args, kwargs = client.post.call_args
        assert "sendMessage" in args[0]
        payload = kwargs["json"]
        assert payload["chat_id"] == 2002
        assert payload["parse_mode"] == "HTML"
        assert "<b>" in payload["text"]
        # Link is inside the inline button, not pasted into the text.
        assert "https://t.me/" not in payload["text"]
        button = payload["reply_markup"]["inline_keyboard"][0][0]
        assert button["url"].startswith("https://t.me/bot?startapp=")


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_daily_digest_wants_and_unread_window():
    acc = Account.objects.create_user(
        email="tg3@users.de-press.local",
        password="unusedpass1",
    )
    acc.telegram_id = 3003
    acc.notify_telegram_opt_in = True
    acc.notify_digest_frequency = "daily"
    acc.save()
    assert account_wants_telegram_daily_digest(acc) is True
    assert account_wants_telegram_soft_notify(acc) is False

    n1 = Notification.objects.create(
        recipient_account=acc,
        kind=NotificationKind.MESSAGE,
        payload={},
    )
    rows = unread_for_telegram_digest(acc)
    assert n1 in rows
    text = format_digest_text(rows)
    assert "digest" in text.lower()
    assert "de-press:" in text


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test", TELEGRAM_BOT_USERNAME="bot")
def test_send_daily_digest_updates_last_at():
    acc = Account.objects.create_user(
        email="tg4@users.de-press.local",
        password="unusedpass1",
    )
    acc.telegram_id = 4004
    acc.notify_telegram_opt_in = True
    acc.notify_digest_frequency = "daily"
    acc.save()
    Notification.objects.create(
        recipient_account=acc,
        kind=NotificationKind.DIALOGUE_REQUEST,
        payload={},
    )

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = "ok"
    mock_resp.json.return_value = {"ok": True, "result": {"message_id": 1}}

    with patch("apps.notifications.tg_api.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = None
        client.post.return_value = mock_resp
        client_cls.return_value = client

        status = send_telegram_daily_digest_for_account(acc)
        assert status == "sent"
        acc.refresh_from_db()
        assert acc.telegram_digest_last_at is not None

        # Second run: no notifications newer than last_at → empty
        status2 = send_telegram_daily_digest_for_account(acc)
        assert status2 == "skipped_empty"


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_run_batch_counts():
    stats = run_telegram_daily_digests(limit_accounts=10)
    assert "sent" in stats
    assert "candidates" in stats


def test_checkin_nudge_message_shape():
    text = format_checkin_nudge_text("en")
    assert "<b>" in text
    assert "Patterns" in text
    # Neutral + ZK: no claims about the user's activity, links live in the button.
    assert "not checked in" not in text.lower()
    assert "we noticed" not in text.lower()
    assert "https://t.me/" not in text

    with override_settings(TELEGRAM_BOT_USERNAME="bot"):
        _, markup = build_checkin_nudge_message("en")
    assert markup is not None
    assert markup["inline_keyboard"][0][0]["url"].endswith("startapp=mood")

    text_ru, markup_ru = build_checkin_nudge_message("ru")
    assert "Паттернах" in text_ru
    assert "только на твоём устройстве" in text_ru
    assert markup_ru is not None
    assert markup_ru["inline_keyboard"][0][0]["text"] == "Открыть"


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_checkin_nudge_throttle_and_recent_digest():
    acc = Account.objects.create_user(
        email="tg5@users.de-press.local",
        password="unusedpass1",
    )
    acc.telegram_id = 5005
    acc.notify_telegram_opt_in = True
    acc.save()

    now = timezone.now()
    # A digest went out earlier today → stay quiet even on the first nudge.
    acc.telegram_digest_last_at = now - timedelta(hours=1)
    acc.save()
    assert send_checkin_nudge_for_account(acc) == "skipped_recent"

    acc.telegram_digest_last_at = None
    acc.telegram_nudge_last_at = now - timedelta(days=1)
    acc.save()
    assert send_checkin_nudge_for_account(acc) == "skipped_throttle"

    # Eligible now: mock the Bot API and check the throttle timestamp lands.
    acc.telegram_nudge_last_at = None
    acc.save()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = "ok"
    mock_resp.json.return_value = {"ok": True, "result": {"message_id": 1}}
    with patch("apps.notifications.tg_api.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = None
        client.post.return_value = mock_resp
        client_cls.return_value = client

        status = send_checkin_nudge_for_account(acc)
        assert status == "sent"
        acc.refresh_from_db()
        assert acc.telegram_nudge_last_at is not None

        args, kwargs = client.post.call_args
        payload = kwargs["json"]
        assert payload["chat_id"] == 5005
        assert "https://t.me/" not in payload["text"]
        button = payload["reply_markup"]["inline_keyboard"][0][0]
        assert button["url"].endswith("startapp=mood")

        # Right after a nudge → throttled.
        assert send_checkin_nudge_for_account(acc) == "skipped_throttle"


@pytest.mark.django_db
@override_settings(TELEGRAM_BOT_TOKEN="1:test")
def test_run_checkin_nudges_batch_counts():
    stats = run_checkin_nudges(limit_accounts=10)
    assert "sent" in stats
    assert "candidates" in stats
    assert "skipped_throttle" in stats
    assert "skipped_recent" in stats
