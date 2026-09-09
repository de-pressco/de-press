"""Celery tasks for notifications (Telegram digests, …)."""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="apps.notifications.tasks.send_telegram_daily_digests")
def send_telegram_daily_digests(limit_accounts: int = 500) -> dict:
    """Periodic: soft Telegram digests for accounts with frequency=daily."""
    from apps.notifications.telegram_notify import run_telegram_daily_digests

    stats = run_telegram_daily_digests(limit_accounts=limit_accounts)
    logger.info("telegram daily digests: %s", stats)
    return stats


@shared_task(name="apps.notifications.tasks.send_checkin_nudges")
def send_checkin_nudges(limit_accounts: int = 500) -> dict:
    """Periodic: neutral check-in nudges (opt-in Telegram, throttled).

    Blind to local check-ins by design (ZK, ADR-0025) — never reactive.
    """
    from apps.notifications.telegram_notify import run_checkin_nudges

    stats = run_checkin_nudges(limit_accounts=limit_accounts)
    logger.info("telegram check-in nudges: %s", stats)
    return stats
