"""Thin Telegram Bot API transport (send-only side).

Shared by the soft-notify outbox and the bot "living lobby". No domain logic,
no PII in logs: failures log only the method name and HTTP status.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

_API_URL = "https://api.telegram.org/bot{token}/{method}"


def bot_token() -> str:
    """Configured bot token ("" when not configured)."""
    return (getattr(settings, "TELEGRAM_BOT_TOKEN", None) or "").strip()


def bot_username() -> str:
    """Bot username without leading '@' ("" when not configured)."""
    return (getattr(settings, "TELEGRAM_BOT_USERNAME", None) or "").strip().lstrip(
        "@"
    )


def call_bot_api(
    method: str,
    *,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """POST one Bot API method and return the decoded JSON ``result``.

    Returns None when the token is missing, the HTTP status is >= 400, or the
    transport raised. Never raises; response bodies are never logged.
    """
    token = bot_token()
    if not token:
        return None
    url = _API_URL.format(token=token, method=method)
    try:
        with httpx.Client(timeout=8.0) as client:
            res = client.post(url, json=payload or {})
        if res.status_code >= 400:
            logger.warning("telegram %s failed: %s", method, res.status_code)
            return None
        data = res.json()
        return data.get("result") if isinstance(data, dict) else None
    except Exception:
        logger.exception("telegram %s error", method)
        return None


def send_message(
    *,
    chat_id: int,
    text: str,
    parse_mode: str = "HTML",
    reply_markup: dict[str, Any] | None = None,
    disable_web_page_preview: bool = True,
) -> bool:
    """POST sendMessage. Returns True when Telegram accepted it."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text[:4000],
        "disable_web_page_preview": disable_web_page_preview,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return call_bot_api("sendMessage", payload=payload) is not None


def mini_app_deep_link(startapp: str) -> str:
    """t.me deep link when bot username is configured; else web PUBLIC_BASE_URL.

    Opens the Mini App (inside Telegram) at the given in-app target.
    """
    param = (startapp or "notifications").strip()[:64]
    username = bot_username()
    if username:
        return f"https://t.me/{username}?startapp={param}"
    base = (getattr(settings, "PUBLIC_BASE_URL", None) or "").rstrip("/")
    if base:
        return f"{base}/?startapp={param}"
    return ""


def url_inline_keyboard(rows: list[list[tuple[str, str]]]) -> dict[str, Any]:
    """Build ``inline_keyboard`` markup from rows of (label, url) tuples."""
    return {
        "inline_keyboard": [
            [{"text": text, "url": url} for text, url in row] for row in rows
        ]
    }
