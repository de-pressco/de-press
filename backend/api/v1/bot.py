"""Telegram bot webhook endpoint (Bot API updates)."""

from __future__ import annotations

import hmac
import json

from django.conf import settings
from django.http import HttpRequest
from ninja import Router
from ninja.errors import HttpError

from apps.bot.updates import process_update

router = Router(tags=["bot"])

_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token"


@router.post("/bot/webhook")
def bot_webhook(request: HttpRequest) -> dict:
    """Receive a Bot API update for the lobby bot.

    Auth is the ``secret_token`` Telegram echoes back in the
    ``X-Telegram-Bot-Api-Secret-Token`` header (constant-time compare). Returns
    200 quickly; update handling is lightweight and synchronous.
    """
    secret = (getattr(settings, "TELEGRAM_BOT_WEBHOOK_SECRET", None) or "").strip()
    if not secret:
        raise HttpError(401, "Bot webhook is not configured")

    provided = request.headers.get(_SECRET_HEADER, "") or ""
    if not hmac.compare_digest(provided.encode("utf-8"), secret.encode("utf-8")):
        raise HttpError(403, "Forbidden")

    try:
        update = json.loads(request.body or b"{}")
    except json.JSONDecodeError as exc:
        raise HttpError(400, "Invalid JSON body") from exc
    if not isinstance(update, dict):
        raise HttpError(400, "Invalid update payload")

    process_update(update)
    return {"ok": True}
