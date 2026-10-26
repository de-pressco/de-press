"""Translation adapter for dialogue messages and UI catalogs.

Deep interface: translate_text(text, target_lang).
Offline adapter for tests and no-key dev; online uses OpenAI-compatible APIs.
"""

from __future__ import annotations

import logging
from typing import Protocol

from django.conf import settings

from apps.ai.gateway import ChatMessage, get_gateway

logger = logging.getLogger(__name__)


class Translator(Protocol):
    def translate(self, text: str, *, target_lang: str, source_lang: str = "") -> str: ...


# Hunyuan-MT-7B language table (model card). Codes outside the table are
# still attempted via the base LLM — a rough translation beats a refusal.
_MT_LANG_NAMES = {
    "zh": "Chinese",
    "en": "English",
    "fr": "French",
    "pt": "Portuguese",
    "es": "Spanish",
    "ja": "Japanese",
    "tr": "Turkish",
    "ru": "Russian",
    "ar": "Arabic",
    "ko": "Korean",
    "th": "Thai",
    "it": "Italian",
    "de": "German",
    "vi": "Vietnamese",
    "ms": "Malay",
    "id": "Indonesian",
    "tl": "Filipino",
    "hi": "Hindi",
    "zh-hant": "Traditional Chinese",
    "pl": "Polish",
    "cs": "Czech",
    "nl": "Dutch",
    "km": "Khmer",
    "my": "Burmese",
    "fa": "Persian",
    "gu": "Gujarati",
    "ur": "Urdu",
    "te": "Telugu",
    "mr": "Marathi",
    "he": "Hebrew",
    "bn": "Bengali",
    "ta": "Tamil",
    "uk": "Ukrainian",
    "bo": "Tibetan",
    "kk": "Kazakh",
    "mn": "Mongolian",
    "ug": "Uyghur",
    "yue": "Cantonese",
    # Not in Hunyuan-MT's training list; base-LLM best effort.
    "be": "Belarusian",
    "uz": "Uzbek",
    "hy": "Armenian",
    "ka": "Georgian",
    "az": "Azerbaijani",
    "tg": "Tajik",
    "sk": "Slovak",
    "hu": "Hungarian",
    "ro": "Romanian",
    "bg": "Bulgarian",
    "el": "Greek",
    "sv": "Swedish",
    "da": "Danish",
    "fi": "Finnish",
    "no": "Norwegian",
    "sw": "Swahili",
}


def _mt_prompt(text: str, *, target: str) -> str:
    """Exact Hunyuan-MT training template. zh target uses the ZH<=>XX variant."""
    if target == "zh":
        return f"把下面的文本翻译成中文，不要额外解释。\n\n{text}"
    name = _MT_LANG_NAMES.get(target, target)
    return (
        f"Translate the following segment into {name}, "
        f"without additional explanation.\n\n{text}"
    )


def is_stub_translation(text: str) -> bool:
    t = (text or "").lstrip().lower()
    # ASCII sentinel plus the legacy localized marker some old rows still carry.
    return t.startswith(("[offline", "[офлайн"))


class OfflineTranslator:
    def translate(self, text: str, *, target_lang: str, source_lang: str = "") -> str:
        t = (text or "").strip()
        if not t:
            return ""
        code = (target_lang or "en")[:2].lower()
        # Honest offline marker — not a fake translation. Stable ASCII sentinel
        # ("[offline {code}]") so clients detect it regardless of any locale.
        return f"[offline {code}] {t}"


class AITranslator:
    """Translate via dedicated OpenAI-compatible server, then the AI gateway."""

    def __init__(self) -> None:
        self._client: object | None = None

    def translate(self, text: str, *, target_lang: str, source_lang: str = "") -> str:
        t = (text or "").strip()
        if not t:
            return ""
        target = (target_lang or "en")[:2].lower()
        source = (source_lang or "").strip()[:2]
        dedicated = self._try_dedicated(t, target=target, source=source)
        if dedicated:
            return dedicated
        return self._via_gateway(t, target=target, source=source)

    def _messages(self, text: str, *, target: str, source: str) -> list[ChatMessage]:
        src_hint = f" from {source}" if source else ""
        system = (
            "You are a careful translator for a mental-health peer support chat. "
            "Translate the user message accurately. Preserve tone; do not add advice, "
            "diagnosis, or positivity. Output only the translation, no quotes or notes."
        )
        user = f"Translate{src_hint} to language code '{target}':\n\n{text}"
        return [
            ChatMessage(role="system", content=system),
            ChatMessage(role="user", content=user),
        ]

    def _dedicated_messages(self, text: str, *, target: str) -> list[ChatMessage]:
        # Specialized MT models (Hunyuan-MT) have no system prompt and expect
        # their exact per-string template — see _mt_prompt.
        return [ChatMessage(role="user", content=_mt_prompt(text, target=target))]

    def _try_dedicated(self, text: str, *, target: str, source: str) -> str | None:
        base = str(getattr(settings, "TRANSLATOR_BASE_URL", "") or "").strip()
        if not base:
            return None
        model = str(getattr(settings, "TRANSLATOR_MODEL", "") or "Hy-MT1.5-1.8B")
        key = str(getattr(settings, "TRANSLATOR_API_KEY", "") or "").strip() or "not-needed"
        timeout = float(getattr(settings, "TRANSLATOR_TIMEOUT", 60) or 60)
        payload = [
            {"role": m.role, "content": m.content}
            for m in self._dedicated_messages(text, target=target)
        ]
        try:
            from openai import OpenAI

            if self._client is None:  # one client per instance: reused per-value
                self._client = OpenAI(
                    api_key=key, base_url=base.rstrip("/"), timeout=timeout
                )
            resp = self._client.chat.completions.create(
                model=model,
                messages=payload,
                # Hunyuan-MT card: top_k=20, top_p=0.6, rep_penalty=1.05,
                # temperature=0.7 (top_k/rep_penalty not in OpenAI schema).
                # Greedy (0) tends to meta-explain short ambiguous strings.
                temperature=0.7,
                max_tokens=1024,
            )
            out = (resp.choices[0].message.content or "").strip()
            return out or None
        except Exception:
            logger.warning("dedicated translator failed; falling back", exc_info=False)
            self._client = None
            return None

    def _via_gateway(self, text: str, *, target: str, source: str) -> str:
        gateway = get_gateway()
        from apps.ai.gateway import OfflineGateway

        if isinstance(gateway, OfflineGateway):
            return OfflineTranslator().translate(
                text, target_lang=target, source_lang=source
            )
        out = gateway.complete(self._messages(text, target=target, source=source))
        return (out or "").strip() or OfflineTranslator().translate(
            text, target_lang=target, source_lang=source
        )


def get_translator() -> Translator:
    return AITranslator()
