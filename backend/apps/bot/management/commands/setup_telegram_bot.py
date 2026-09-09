"""Register the bot facade with the Bot API.

Idempotent: setWebhook (secret_token), menu WebApp button, localized
description/short description, and private-chat commands. Never touches
anything destructive except an explicit --delete-webhook.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.bot.content import (
    BOT_COMMANDS,
    BOT_DESCRIPTION,
    BOT_SHORT_DESCRIPTION,
    MENU_BUTTON_TEXT,
)
from apps.notifications.tg_api import bot_token, call_bot_api

WEBHOOK_PATH = "/api/v1/bot/webhook"


class Command(BaseCommand):
    help = (
        "Configure the Telegram bot facade (webhook, description, commands, "
        "menu button). Requires TELEGRAM_BOT_TOKEN."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument("--webhook-url", default="", help="Override webhook URL.")
        parser.add_argument(
            "--no-webhook",
            action="store_true",
            help="Skip setWebhook (facade-only update).",
        )
        parser.add_argument(
            "--delete-webhook",
            action="store_true",
            help="deleteWebhook with drop_pending_updates and exit.",
        )
        parser.add_argument(
            "--allow-insecure",
            action="store_true",
            help="Register the webhook without a secret_token (dev only).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        if not bot_token():
            raise CommandError(
                "TELEGRAM_BOT_TOKEN is empty — set it in the environment first."
            )

        if options["delete_webhook"]:
            result = call_bot_api(
                "deleteWebhook", payload={"drop_pending_updates": True}
            )
            self._report("deleteWebhook", result)
            return

        if not options["no_webhook"]:
            self._set_webhook(options)
        self._set_menu_button()
        self._set_descriptions()
        self._set_commands()

    # ------------------------------------------------------------------

    def _set_webhook(self, options: Any) -> None:
        webhook_url = (options["webhook_url"] or "").strip() or (
            getattr(settings, "TELEGRAM_BOT_WEBHOOK_URL", None) or ""
        ).strip()
        if not webhook_url:
            base = (getattr(settings, "PUBLIC_BASE_URL", None) or "").rstrip("/")
            if base:
                webhook_url = f"{base}{WEBHOOK_PATH}"
        if not webhook_url:
            self.stderr.write(
                "setWebhook skipped: no --webhook-url / "
                "TELEGRAM_BOT_WEBHOOK_URL / PUBLIC_BASE_URL."
            )
            return

        secret = (getattr(settings, "TELEGRAM_BOT_WEBHOOK_SECRET", None) or "").strip()
        if not secret and not options["allow_insecure"]:
            raise CommandError(
                "TELEGRAM_BOT_WEBHOOK_SECRET is empty — pass --allow-insecure "
                "only for local dev, or set the secret."
            )

        payload = {
            "url": webhook_url,
            "allowed_updates": ["message"],
            "drop_pending_updates": True,
            "max_connections": 40,
        }
        if secret:
            payload["secret_token"] = secret
        result = call_bot_api("setWebhook", payload=payload)
        self._report("setWebhook", result, detail=webhook_url)

    def _set_menu_button(self) -> None:
        base = (getattr(settings, "PUBLIC_BASE_URL", None) or "").strip()
        if not base:
            self.stderr.write(
                "setChatMenuButton skipped: PUBLIC_BASE_URL is empty."
            )
            return
        result = call_bot_api(
            "setChatMenuButton",
            payload={
                "menu_button": {
                    "type": "web_app",
                    "text": MENU_BUTTON_TEXT,
                    "web_app": {"url": base},
                }
            },
        )
        self._report("setChatMenuButton", result)

    def _set_descriptions(self) -> None:
        for lang, text in BOT_DESCRIPTION.items():
            result = call_bot_api(
                "setMyDescription",
                payload={"description": text, "language_code": lang},
            )
            self._report(f"setMyDescription[{lang}]", result)
        for lang, text in BOT_SHORT_DESCRIPTION.items():
            result = call_bot_api(
                "setMyShortDescription",
                payload={"short_description": text, "language_code": lang},
            )
            self._report(f"setMyShortDescription[{lang}]", result)

    def _set_commands(self) -> None:
        scope = {"type": "all_private_chats"}
        for lang, commands in BOT_COMMANDS.items():
            payload = {
                "commands": [
                    {"command": cmd, "description": desc} for cmd, desc in commands
                ],
                "scope": scope,
                "language_code": lang,
            }
            result = call_bot_api("setMyCommands", payload=payload)
            self._report(f"setMyCommands[{lang}]", result)

    def _report(self, method: str, result: dict | None, detail: str = "") -> None:
        if result is None:
            self.stderr.write(f"{method} failed (see logs for the status).")
        else:
            suffix = f" — {detail}" if detail else ""
            self.stdout.write(f"{method} ok{suffix}")
