"""Copy and config for the de-press Telegram bot lobby.

Message text is static (user content is never echoed back), so it is safe to
send as Telegram HTML. The tone follows the product: quiet, no toxic
positivity, honest crisis path, no "chat buddy" imitation.
"""

from __future__ import annotations

from typing import Literal

Locale = Literal["ru", "en"]

# ---------------------------------------------------------------------------
# Bot facade (BotFather / Bot API)
# ---------------------------------------------------------------------------

# Shown in the bot profile ("What can this bot do?").
BOT_DESCRIPTION: dict[str, str] = {
    "ru": (
        "de-press — тихая гавань. Напишите о том, что тяжело, — без лайков и "
        "оценок; рядом молча побудут люди. Диалог начинается только по вашему "
        "желанию. Это не замена терапии и не медицина. Если опасно — 112 или "
        "103. Команды: /start, /help, /panic."
    ),
    "en": (
        "de-press — a quiet harbor. Write about what is heavy — no likes, no "
        "ratings; people stay nearby in silence. A dialogue starts only when "
        "you want it. This is not therapy or medicine. In danger — your local "
        "emergency number. Commands: /start, /help, /panic."
    ),
}

# Short text under the bot name (up to 140 chars).
BOT_SHORT_DESCRIPTION: dict[str, str] = {
    "ru": "Тихая гавань: выговориться без лайков.",
    "en": "A quiet harbor: monologues without likes.",
}

# setMyCommands list per language (private chats only).
BOT_COMMANDS: dict[str, list[tuple[str, str]]] = {
    "ru": [
        ("start", "Открыть de-press"),
        ("open", "Открыть приложение"),
        ("help", "Разделы помощи"),
        ("panic", "Мне плохо"),
    ],
    "en": [
        ("start", "Open de-press"),
        ("open", "Open the app"),
        ("help", "Help sections"),
        ("panic", "I am not ok"),
    ],
}

# Menu button (WebApp) label; Bot API has no per-language localization here.
MENU_BUTTON_TEXT = "Открыть"

# ---------------------------------------------------------------------------
# Lobby messages
# ---------------------------------------------------------------------------

MESSAGES: dict[str, dict[Locale, str]] = {
    "welcome_new": {
        "ru": (
            "<b>de-press</b> — тихая гавань.\n\n"
            "Здесь можно выговориться без лайков, оценок и комментариев под "
            "историей. Рядом — люди, которые молча побудут с вами. Диалог "
            "начинается только по вашему желанию.\n\n"
            "Это не замена терапии и не медицина. Если жизни что-то угрожает "
            "— сразу 112 или 103.\n\n"
            "Всё внутри приложения."
        ),
        "en": (
            "<b>de-press</b> — a quiet harbor.\n\n"
            "You can let it out here — no likes, no ratings, no comments under "
            "your story. People stay nearby in silence. A dialogue starts only "
            "when you ask for it.\n\n"
            "This is not therapy and not medicine. If you are in danger — call "
            "your local emergency number right away.\n\n"
            "Everything lives inside the app."
        ),
    },
    "welcome_return": {
        "ru": "<b>de-press</b>\n\nРады, что вы здесь. Что открыть?",
        "en": "<b>de-press</b>\n\nGlad you are here. What would you like to open?",
    },
    "open": {
        "ru": "Приложение откроется по кнопке ниже.",
        "en": "The app will open with the button below.",
    },
    "help": {
        "ru": (
            "<b>Помощь рядом</b>\n\n"
            "Внутри приложения:\n"
            "• карточки самопомощи и безопасность;\n"
            "• запрос к человеку, который рядом;\n"
            "• ИИ-компаньон — всегда подписан как ИИ, без диагнозов.\n\n"
            "Если сейчас опасно — 112 или 103."
        ),
        "en": (
            "<b>Help is near</b>\n\n"
            "Inside the app:\n"
            "• self-help cards and safety;\n"
            "• a request to a person nearby;\n"
            "• an AI companion — always labeled as AI, never diagnoses.\n\n"
            "If you are in danger right now — call your local emergency number."
        ),
    },
    "panic": {
        "ru": (
            "<b>Мне плохо</b>\n\n"
            "Откройте антипанику — тихое дыхание и опоры рядом с вами.\n"
            "Если есть угроза жизни — 112 или 103."
        ),
        "en": (
            "<b>I am not ok</b>\n\n"
            "Open the anti-panic mode — quiet breathing and anchors nearby.\n"
            "If your life is in danger — call your local emergency number."
        ),
    },
    "fallback": {
        "ru": (
            "Я не переписываюсь в этом чате и не сохраняю сообщения. Здесь "
            "тихо: истории и диалоги живут внутри приложения."
        ),
        "en": (
            "I do not chat in here and do not store messages. It is quiet: "
            "stories and dialogues live inside the app."
        ),
    },
}

# Inline button labels keyed by action (see _ACTION_STARTAPP in replies.py).
BTN_LABELS: dict[str, dict[Locale, str]] = {
    "open": {"ru": "Открыть de-press", "en": "Open de-press"},
    "feed": {"ru": "Лента", "en": "Feed"},
    "chat": {"ru": "Диалоги", "en": "Dialogues"},
    "help": {"ru": "Помощь", "en": "Help"},
    "help_wait": {"ru": "Человек рядом", "en": "A person nearby"},
    "help_ai": {"ru": "ИИ-компаньон", "en": "AI companion"},
    "panic": {"ru": "Мне плохо", "en": "I am not ok"},
    "calm": {"ru": "Дышать — антипаника", "en": "Breathe — anti-panic"},
}


def normalize_locale(code: str | None) -> Locale:
    """Map a Telegram language_code to the two supported locales."""
    return "ru" if (code or "").strip().lower().startswith("ru") else "en"


def message(key: str, locale: Locale) -> str:
    return MESSAGES[key].get(locale, MESSAGES[key]["en"])


def btn_label(action: str, locale: Locale) -> str:
    labels = BTN_LABELS.get(action, BTN_LABELS["open"])
    return labels.get(locale, labels["en"])

