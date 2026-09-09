"""Bot update parsing and dispatch (private chats only).

No chat content is stored or echoed. For anything that is not a known command
the bot replies once with a quiet pointer into the app (cooldown-capped).
"""

from __future__ import annotations

import re

from django.core.cache import cache

from apps.bot.content import Locale, normalize_locale
from apps.bot.replies import (
    BotReply,
    fallback_reply,
    help_reply,
    open_reply,
    panic_reply,
    welcome_reply,
)
from apps.identity.models import Account
from apps.notifications.tg_api import send_message

_CMD_RE = re.compile(r"^/([A-Za-z_][A-Za-z0-9_]*)(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$")

# A plain-message reply is sent at most once per chat in this window.
_FALLBACK_COOLDOWN_SECONDS = 30
_FALLBACK_KEY = "tg:lobby:fallback:{chat_id}"

_START_PANIC_ARGS = {"panic", "meh", "calm", "antipanic"}
_START_HELP_ARGS = {"help", "help_wait", "help_ai", "helper", "safety"}


def parse_message_command(text: str) -> tuple[str | None, str]:
    """Split a message into (command without '/', arguments). Unknown → None."""
    match = _CMD_RE.match((text or "").strip())
    if not match:
        return None, ""
    return match.group(1).lower(), (match.group(2) or "").strip()


def _start_target(args: str) -> str | None:
    """First argument of /start maps to a lobby section (None → plain welcome)."""
    first = (args or "").split()[0].lower() if (args or "").strip() else ""
    if not first:
        return None
    if first in _START_PANIC_ARGS:
        return "panic"
    if first in _START_HELP_ARGS:
        return "help"
    return None


def _is_returning_user(user_id: object) -> bool:
    if not user_id:
        return False
    try:
        tg_id = int(user_id)
    except (TypeError, ValueError):
        return False
    if tg_id <= 0:
        return False
    return Account.objects.filter(telegram_id=tg_id, is_active=True).exists()


def _fallback_allowed(chat_id: int) -> bool:
    """One quiet fallback reply per chat per window (anti-flood)."""
    try:
        key = _FALLBACK_KEY.format(chat_id=chat_id)
        if cache.get(key):
            return False
        cache.set(key, "1", _FALLBACK_COOLDOWN_SECONDS)
        return True
    except Exception:
        return True


def process_update(update: dict) -> str:
    """Handle one Bot update. Returns an outcome label (never user content)."""
    message = update.get("message") if isinstance(update, dict) else None
    if not isinstance(message, dict):
        return "ignored"

    chat = message.get("chat")
    if not isinstance(chat, dict) or chat.get("type") not in ("private", None):
        return "ignored"

    text = message.get("text")
    if not isinstance(text, str) or not text.strip():
        return "ignored"  # stickers / media stay quiet

    sender = message.get("from")
    if not isinstance(sender, dict):
        return "ignored"

    try:
        chat_id = int(chat.get("id") or sender.get("id") or 0)
    except (TypeError, ValueError):
        return "ignored"
    if chat_id <= 0:
        return "ignored"

    locale: Locale = normalize_locale(sender.get("language_code"))
    cmd, args = parse_message_command(text)

    if cmd == "start":
        target = _start_target(args)
        if target == "panic":
            reply, kind = panic_reply(locale), "panic"
        elif target == "help":
            reply, kind = help_reply(locale), "help"
        else:
            returning = _is_returning_user(sender.get("id"))
            reply = welcome_reply(returning=returning, locale=locale)
            kind = "start_return" if returning else "start_new"
    elif cmd in ("open", "launch"):
        reply, kind = open_reply(locale), "open"
    elif cmd in ("help", "h"):
        reply, kind = help_reply(locale), "help"
    elif cmd in ("panic", "meh", "calm"):
        reply, kind = panic_reply(locale), "panic"
    else:
        reply, kind = fallback_reply(locale), "fallback"

    if kind == "fallback" and not _fallback_allowed(chat_id):
        return "throttled"

    ok = send_message(
        chat_id=chat_id,
        text=reply.text,
        reply_markup=reply.reply_markup,
    )
    return "sent" if ok else "send_failed"


def reply_for_command(
    text: str,
    *,
    locale: str | None = None,
    returning: bool = False,
) -> tuple[str, BotReply | None]:
    """Pure routing helper for tests: (kind, reply) without network/DB.

    `/start` honours the same arg shortcuts as process_update.
    """
    cmd, args = parse_message_command(text)
    loc = normalize_locale(locale)
    if cmd == "start":
        target = _start_target(args)
        if target == "panic":
            return "panic", panic_reply(loc)
        if target == "help":
            return "help", help_reply(loc)
        return (
            ("start_return" if returning else "start_new"),
            welcome_reply(returning=returning, locale=loc),
        )
    if cmd in ("open", "launch"):
        return "open", open_reply(loc)
    if cmd in ("help", "h"):
        return "help", help_reply(loc)
    if cmd in ("panic", "meh", "calm"):
        return "panic", panic_reply(loc)
    return "fallback", fallback_reply(loc)
