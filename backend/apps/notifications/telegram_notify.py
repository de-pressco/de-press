"""Soft-notify via Telegram Bot API (Mini App host).

Opt-in only. Immediate pings + daily digests with startapp deep-links and an
inline "Open" button instead of a raw URL. Localized RU/EN from the account's
Telegram UI language.
Does not use Telegram chats as dialogue transport — only a nudge + link back.
"""

from __future__ import annotations

import html
import logging
from collections import Counter
from datetime import timedelta
from typing import Any, Literal
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.identity.models import Account
from apps.identity.services import Actor
from apps.notifications.models import Notification
from apps.notifications.tg_api import (
    bot_token,
    mini_app_deep_link,
    send_message,
    url_inline_keyboard,
)

logger = logging.getLogger(__name__)

KIND_LABELS: dict[str, dict[str, str]] = {
    "dialogue_request": {
        "ru": "Запрос на диалог по вашей истории",
        "en": "Dialogue request on your story",
    },
    "support_cloud": {"ru": "Новое облако поддержки", "en": "New support cloud"},
    "cloud_approved": {
        "ru": "Облако поддержки одобрено",
        "en": "Support cloud approved",
    },
    "dialogue_opened": {"ru": "Диалог открыт", "en": "Dialogue opened"},
    "outreach_intro": {
        "ru": "Человек, откликнувшийся на вашу историю, написал вам",
        "en": "A hearer of your story wrote to you",
    },
    "message": {"ru": "Новое сообщение в диалоге", "en": "New message in a dialogue"},
    "dialogue_deleted": {
        "ru": "Ваш собеседник удалил диалог",
        "en": "Your dialogue partner deleted the dialogue",
    },
}

DEFAULT_KIND_LABEL: dict[str, str] = {
    "ru": "Новое уведомление в de-press",
    "en": "New notification in de-press",
}

QUIET_FOOTER: dict[str, str] = {
    "ru": "Тихое напоминание. Отключить: меню → Telegram → Уведомления.",
    "en": "Quiet reminder. Turn off: menu → notifications in Telegram.",
}

OPEN_BUTTON_LABEL: dict[str, str] = {"ru": "Открыть", "en": "Open"}

DIGEST_HEADER: dict[str, str] = {
    "ru": "de-press: тихий дайджест",
    "en": "de-press: quiet digest",
}

DigestStatus = Literal[
    "sent",
    "skipped_empty",
    "skipped_config",
    "skipped_freq",
    "skipped_throttle",
    "skipped_recent",
    "failed",
]


def _locale_for_code(code: str | None) -> str:
    return "ru" if (code or "").strip().lower().startswith("ru") else "en"


def locale_for_account(account: Account | None) -> str:
    """Best known locale (ru/en) for server-side messages to an account."""
    if account is None:
        return "en"
    return _locale_for_code(getattr(account, "telegram_language_code", ""))


def _esc(text: str) -> str:
    return html.escape(text, quote=False)


def startapp_for_notification(kind: str, payload: dict[str, Any] | None) -> str:
    """Map notification → startapp param (max 64 chars, Telegram alphabet)."""
    data = dict(payload or {})

    def _uuid(key: str) -> str | None:
        raw = data.get(key)
        if not raw:
            return None
        try:
            return str(UUID(str(raw)))
        except (ValueError, TypeError):
            return None

    dialogue_id = _uuid("dialogue_id")
    story_id = _uuid("story_id")

    if kind in (
        "message",
        "dialogue_opened",
        "outreach_intro",
        "dialogue_deleted",
    ) and dialogue_id:
        return f"chat_{dialogue_id}"
    if kind == "dialogue_request":
        if dialogue_id:
            return f"chat_{dialogue_id}"
        if story_id:
            return f"story_{story_id}"
        return "chat"
    if kind in ("support_cloud", "cloud_approved"):
        if story_id:
            return f"story_{story_id}"
        return "notifications"
    return "notifications"


def _open_markup(locale: str, startapp: str) -> dict | None:
    """One inline 'Open' URL button opening the Mini App at `startapp`."""
    link = mini_app_deep_link(startapp)
    if not link:
        return None
    return url_inline_keyboard([[(OPEN_BUTTON_LABEL[locale], link)]])


def format_soft_notify_text(
    kind: str,
    payload: dict[str, Any] | None,
    locale: str = "en",
) -> str:
    """HTML text of one soft ping. The Open button is attached separately."""
    labels = KIND_LABELS.get(kind, DEFAULT_KIND_LABEL)
    label = labels.get(locale, labels["en"])
    lines = [f"<b>{_esc(label)}</b>", "", QUIET_FOOTER.get(locale, QUIET_FOOTER["en"])]
    return "\n".join(lines)


def build_soft_notify_message(
    kind: str,
    payload: dict[str, Any] | None,
    locale: str = "en",
) -> tuple[str, dict | None]:
    """(text, reply_markup) for one soft ping."""
    text = format_soft_notify_text(kind, payload, locale)
    return text, _open_markup(locale, startapp_for_notification(kind, payload))


def _account_base_tg_ok(account: Account) -> bool:
    if not account or not account.telegram_id:
        return False
    if not bool(getattr(account, "notify_telegram_opt_in", False)):
        return False
    if not bot_token():
        return False
    return True


def account_wants_telegram_soft_notify(account: Account) -> bool:
    """Immediate per-event Bot pings."""
    if not _account_base_tg_ok(account):
        return False
    freq = (account.notify_digest_frequency or "off").lower()
    return freq == "immediate"


def account_wants_telegram_daily_digest(account: Account) -> bool:
    """Daily batch digest (not per-event)."""
    if not _account_base_tg_ok(account):
        return False
    freq = (account.notify_digest_frequency or "off").lower()
    return freq == "daily"


def maybe_send_telegram_soft_notify(
    recipient: Actor,
    notification: Notification,
) -> bool:
    """Send TG soft-notify if recipient is opt-in TG account. Safe no-op otherwise."""
    account = recipient.account
    if account is None or not account_wants_telegram_soft_notify(account):
        return False
    locale = locale_for_account(account)
    text, markup = build_soft_notify_message(
        notification.kind,
        notification.payload,
        locale,
    )
    return send_message(
        chat_id=int(account.telegram_id),
        text=text,
        reply_markup=markup,
    )


def schedule_telegram_soft_notify(
    recipient: Actor,
    notification: Notification,
) -> None:
    """Defer send until after DB commit (same pattern as WS broadcast)."""

    notif_id = notification.pk
    account_id = recipient.account_id

    def _send() -> None:
        if account_id is None:
            return
        try:
            account = Account.objects.get(pk=account_id)
            notif = Notification.objects.get(pk=notif_id)
        except (Account.DoesNotExist, Notification.DoesNotExist):
            return
        actor = Actor(kind="account", account=account)
        maybe_send_telegram_soft_notify(actor, notif)

    transaction.on_commit(_send)


def unread_for_telegram_digest(
    account: Account,
    *,
    limit: int = 20,
) -> list[Notification]:
    """Unread notifications since last successful daily digest (or all if never)."""
    limit = max(1, min(int(limit or 20), 50))
    q = Q(recipient_account=account, is_read=False)
    last = getattr(account, "telegram_digest_last_at", None)
    if last is not None:
        q &= Q(created_at__gt=last)
    return list(
        Notification.objects.filter(q).order_by("-created_at", "-id")[:limit]
    )


def format_digest_text(
    notifications: list[Notification],
    locale: str = "en",
) -> str:
    """HTML text of one soft digest: counts by kind. Button is separate."""
    header = DIGEST_HEADER.get(locale, DIGEST_HEADER["en"])
    lines = [f"<b>{_esc(header)} ({len(notifications)})</b>"]
    counts = Counter(n.kind for n in notifications)
    for kind, count in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        labels = KIND_LABELS.get(kind, DEFAULT_KIND_LABEL)
        label = labels.get(locale, labels["en"])
        lines.append(f"• {count}× {_esc(label)}")
    lines.append("")
    lines.append(QUIET_FOOTER.get(locale, QUIET_FOOTER["en"]))
    return "\n".join(lines)


def build_digest_message(
    notifications: list[Notification],
    locale: str = "en",
) -> tuple[str, dict | None]:
    """(text, reply_markup) for one soft digest."""
    text = format_digest_text(notifications, locale)
    return text, _open_markup(locale, "notifications")


def send_telegram_daily_digest_for_account(account: Account) -> DigestStatus:
    """Send one daily digest if eligible and there is new unread. Updates last_at."""
    if not account_wants_telegram_daily_digest(account):
        if not _account_base_tg_ok(account):
            return "skipped_config"
        return "skipped_freq"

    rows = unread_for_telegram_digest(account)
    if not rows:
        return "skipped_empty"

    text, markup = build_digest_message(rows, locale_for_account(account))
    ok = send_message(
        chat_id=int(account.telegram_id),
        text=text,
        reply_markup=markup,
    )
    if not ok:
        return "failed"

    account.telegram_digest_last_at = timezone.now()
    account.save(update_fields=["telegram_digest_last_at"])
    return "sent"


def run_telegram_daily_digests(*, limit_accounts: int = 500) -> dict[str, int]:
    """Batch job: daily digests for all eligible accounts.

    Returns counters: sent, skipped_empty, skipped_config, skipped_freq, failed.
    """
    stats: dict[str, int] = {
        "sent": 0,
        "skipped_empty": 0,
        "skipped_config": 0,
        "skipped_freq": 0,
        "failed": 0,
        "candidates": 0,
    }
    if not bot_token():
        return stats

    qs = (
        Account.objects.filter(
            is_active=True,
            notify_telegram_opt_in=True,
            notify_digest_frequency="daily",
            telegram_id__isnull=False,
        )
        .order_by("id")[: max(1, min(int(limit_accounts or 500), 5000))]
    )
    for account in qs:
        stats["candidates"] += 1
        status = send_telegram_daily_digest_for_account(account)
        stats[status] = stats.get(status, 0) + 1
    return stats


# --- Neutral check-in nudge -------------------------------------------------
#
# Zero-Knowledge means the server never learns whether (or when) the user
# checked in (ADR-0005/0025), so the nudge cannot be reactive. It is a
# periodic, neutral invitation — no "we noticed you were away", no data.

CHECKIN_NUDGE_TITLE: dict[str, str] = {
    "ru": "Тихая отметка",
    "en": "Quiet check-in",
}

CHECKIN_NUDGE_BODY: dict[str, str] = {
    "ru": (
        "Как ты сегодня? Можно отметить состояние в «Паттернах» — "
        "записи остаются только на твоём устройстве."
    ),
    "en": (
        "How are you today? You can note your state in Patterns — "
        "entries stay on your device only."
    ),
}

# startapp param: `mood` maps to /patterns in the Mini App.
CHECKIN_NUDGE_STARTAPP = "mood"


def checkin_nudge_interval_days() -> int:
    """Minimum days between two nudges to the same account (default 3)."""
    try:
        return max(1, int(getattr(settings, "TELEGRAM_NUDGE_INTERVAL_DAYS", 3)))
    except (TypeError, ValueError):
        return 3


def format_checkin_nudge_text(locale: str = "en") -> str:
    title = CHECKIN_NUDGE_TITLE.get(locale, CHECKIN_NUDGE_TITLE["en"])
    body = CHECKIN_NUDGE_BODY.get(locale, CHECKIN_NUDGE_BODY["en"])
    lines = [
        f"<b>{_esc(title)}</b>",
        "",
        _esc(body),
        "",
        QUIET_FOOTER.get(locale, QUIET_FOOTER["en"]),
    ]
    return "\n".join(lines)


def build_checkin_nudge_message(locale: str = "en") -> tuple[str, dict | None]:
    """(text, reply_markup) for one neutral check-in nudge."""
    return format_checkin_nudge_text(locale), _open_markup(
        locale, CHECKIN_NUDGE_STARTAPP
    )


def send_checkin_nudge_for_account(account: Account) -> DigestStatus:
    """Send one neutral check-in nudge if eligible. Updates the throttle."""
    if not _account_base_tg_ok(account):
        return "skipped_config"

    now = timezone.now()
    last = account.telegram_nudge_last_at
    if last is not None and now - last < timedelta(
        days=checkin_nudge_interval_days()
    ):
        return "skipped_throttle"
    # Already heard from us today (a digest went out) — stay quiet.
    digest_last = account.telegram_digest_last_at
    if digest_last is not None and now - digest_last < timedelta(days=1):
        return "skipped_recent"

    text, markup = build_checkin_nudge_message(locale_for_account(account))
    ok = send_message(
        chat_id=int(account.telegram_id),
        text=text,
        reply_markup=markup,
    )
    if not ok:
        return "failed"

    account.telegram_nudge_last_at = now
    account.save(update_fields=["telegram_nudge_last_at"])
    return "sent"


def run_checkin_nudges(*, limit_accounts: int = 500) -> dict[str, int]:
    """Batch job: neutral check-in nudges for opt-in Telegram accounts."""
    stats: dict[str, int] = {
        "sent": 0,
        "skipped_config": 0,
        "skipped_throttle": 0,
        "skipped_recent": 0,
        "failed": 0,
        "candidates": 0,
    }
    if not bot_token():
        return stats

    cutoff = timezone.now() - timedelta(days=checkin_nudge_interval_days())
    qs = (
        Account.objects.filter(
            is_active=True,
            notify_telegram_opt_in=True,
            telegram_id__isnull=False,
        )
        .filter(
            Q(telegram_nudge_last_at__isnull=True)
            | Q(telegram_nudge_last_at__lt=cutoff)
        )
        .order_by("id")[: max(1, min(int(limit_accounts or 500), 5000))]
    )
    for account in qs:
        stats["candidates"] += 1
        status = send_checkin_nudge_for_account(account)
        stats[status] = stats.get(status, 0) + 1
    return stats
