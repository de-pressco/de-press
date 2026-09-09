"""Lobby replies: message text + inline keyboards of Mini App deep links.

Buttons use URL buttons (t.me?startapp=…) — Telegram allows only one WebApp
button per keyboard, and deep links make each section reachable in one tap.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.bot.content import (
    Locale,
    btn_label,
    message,
    normalize_locale,
)
from apps.notifications.tg_api import mini_app_deep_link, url_inline_keyboard

# action -> startapp param (startParam catalog in apps/mini-app/src/core/host).
_ACTION_STARTAPP: dict[str, str] = {
    "feed": "feed",
    "chat": "chat",
    "help": "help",
    "help_wait": "help_wait",
    "help_ai": "help_ai",
    "panic": "panic",
    "calm": "panic",
    "open": "feed",
}


@dataclass(frozen=True, slots=True)
class BotReply:
    text: str
    reply_markup: dict | None = None


def _keyboard(rows: list[list[str]], locale: Locale) -> dict | None:
    """Rows of actions → inline URL keyboard (None when no reachable links)."""
    built: list[list[tuple[str, str]]] = []
    for row in rows:
        buttons = [
            (btn_label(action, locale), link)
            for action in row
            if (link := mini_app_deep_link(_ACTION_STARTAPP[action]))
        ]
        if buttons:
            built.append(buttons)
    if not built:
        return None
    return url_inline_keyboard(built)


def welcome_reply(*, returning: bool, locale: str | None = None) -> BotReply:
    loc = normalize_locale(locale)
    text = message("welcome_return" if returning else "welcome_new", loc)
    if returning:
        rows = [
            ["feed", "chat"],
            ["help", "panic"],
        ]
    else:
        rows = [
            ["open"],
            ["help", "panic"],
        ]
    return BotReply(text, _keyboard(rows, loc))


def open_reply(locale: str | None = None) -> BotReply:
    loc = normalize_locale(locale)
    return BotReply(message("open", loc), _keyboard([["open"]], loc))


def help_reply(locale: str | None = None) -> BotReply:
    loc = normalize_locale(locale)
    rows = [
        ["help"],
        ["help_wait"],
        ["help_ai"],
        ["panic"],
    ]
    return BotReply(message("help", loc), _keyboard(rows, loc))


def panic_reply(locale: str | None = None) -> BotReply:
    loc = normalize_locale(locale)
    return BotReply(message("panic", loc), _keyboard([["calm"]], loc))


def fallback_reply(locale: str | None = None) -> BotReply:
    loc = normalize_locale(locale)
    rows = [["open"], ["help", "panic"]]
    return BotReply(message("fallback", loc), _keyboard(rows, loc))
