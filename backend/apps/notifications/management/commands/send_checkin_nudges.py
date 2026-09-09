"""Run the neutral check-in nudges once (cron / manual; same logic as beat)."""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.notifications.telegram_notify import run_checkin_nudges


class Command(BaseCommand):
    help = (
        "Send neutral check-in nudges to opt-in Telegram accounts "
        "(throttled per account; blind to local check-ins, ADR-0025)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=500,
            help="Max accounts to process (default 500).",
        )

    def handle(self, *args, **options):
        limit = int(options.get("limit") or 500)
        stats = run_checkin_nudges(limit_accounts=limit)
        self.stdout.write(self.style.SUCCESS(f"Check-in nudges: {stats}"))
