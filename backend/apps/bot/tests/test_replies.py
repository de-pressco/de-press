"""Lobby content and routing tests (no network, no DB)."""

from __future__ import annotations

from django.test import override_settings

from apps.bot.content import BOT_COMMANDS, normalize_locale
from apps.bot.replies import (
    fallback_reply,
    help_reply,
    open_reply,
    panic_reply,
    welcome_reply,
)
from apps.bot.updates import parse_message_command, reply_for_command


def _urls(reply) -> list[str]:
    if not reply.reply_markup:
        return []
    return [
        button["url"]
        for row in reply.reply_markup["inline_keyboard"]
        for button in row
    ]


def _labels(reply) -> list[str]:
    if not reply.reply_markup:
        return []
    return [
        button["text"]
        for row in reply.reply_markup["inline_keyboard"]
        for button in row
    ]


def test_normalize_locale():
    assert normalize_locale("ru") == "ru"
    assert normalize_locale("ru-RU") == "ru"
    assert normalize_locale("en") == "en"
    assert normalize_locale("pt-br") == "en"
    assert normalize_locale(None) == "en"


@override_settings(TELEGRAM_BOT_USERNAME="depress_bot")
def test_welcome_new_ru_crisis_note_and_buttons():
    reply = welcome_reply(returning=False, locale="ru")
    assert "<b>de-press</b>" in reply.text
    assert "112 или 103" in reply.text
    urls = _urls(reply)
    assert any(u == "https://t.me/depress_bot?startapp=feed" for u in urls)
    assert any(u.endswith("?startapp=panic") for u in urls)


@override_settings(TELEGRAM_BOT_USERNAME="depress_bot")
def test_welcome_returning_differs_and_has_sections():
    new_reply = welcome_reply(returning=False, locale="ru")
    ret_reply = welcome_reply(returning=True, locale="ru")
    assert new_reply.text != ret_reply.text
    assert "Что открыть" in ret_reply.text
    urls = _urls(ret_reply)
    assert any(u.endswith("?startapp=feed") for u in urls)
    assert any(u.endswith("?startapp=chat") for u in urls)


@override_settings(TELEGRAM_BOT_USERNAME="depress_bot")
def test_help_and_panic_keys():
    help_text = help_reply("ru")
    assert "Помощь рядом" in help_text.text
    assert any(lbl == "ИИ-компаньон" for lbl in _labels(help_text))

    panic_text = panic_reply("ru")
    assert "112 или 103" in panic_text.text
    assert any(u.endswith("?startapp=panic") for u in _urls(panic_text))

    open_text = open_reply("en")
    assert any(
        u.endswith("?startapp=feed") for u in _urls(open_text)
    )


def test_fallback_does_not_echo_user_text():
    user_text = "привет, как дела, расскажи секрет"
    reply = fallback_reply("ru")
    assert user_text not in reply.text
    assert "приложения" in reply.text


def test_parse_message_command():
    cmd, args = parse_message_command("/start@DepressBot panic")
    assert cmd == "start"
    assert args == "panic"
    cmd, args = parse_message_command("просто текст")
    assert cmd is None
    assert args == ""
    cmd, args = parse_message_command("/HELP")
    assert cmd == "help"


def test_reply_for_command_routing():
    assert reply_for_command("/start", returning=False)[0] == "start_new"
    assert reply_for_command("/start", returning=True)[0] == "start_return"
    assert reply_for_command("/start panic")[0] == "panic"
    assert reply_for_command("/start help_wait")[0] == "help"
    assert reply_for_command("/panic")[0] == "panic"
    assert reply_for_command("/meh")[0] == "panic"
    assert reply_for_command("/open")[0] == "open"
    assert reply_for_command("/help")[0] == "help"
    assert reply_for_command("/unknown")[0] == "fallback"
    assert reply_for_command("anything")[0] == "fallback"


def test_command_descriptions_length_limits():
    for lang, commands in BOT_COMMANDS.items():
        for command, description in commands:
            assert 1 <= len(command) <= 32
            assert 3 <= len(description) <= 256
