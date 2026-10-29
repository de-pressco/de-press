"""Translate flattened UI chrome strings. Never used for user content."""

from __future__ import annotations

import json
import logging
import re

from django.conf import settings

from apps.dialogue.speech import get_translator, is_stub_translation

logger = logging.getLogger(__name__)

# UI catalog cap for the AI translation proxy. Raised 560 -> 640 when the
# therapy contour (ADR-0022) added its ru/en strings; 640 -> 690 when the
# notifications comeback added pane + per-kind settings strings. Keep the
# vitest catalog-budget test (flatten.test.ts) in sync with this number.
MAX_KEYS = 690
CHUNK = 500

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I | re.M)


class I18nUiError(Exception):
    pass


def _dedicated_translator_configured() -> bool:
    """TRANSLATOR_BASE_URL targets a specialized MT model (e.g. Hunyuan-MT).
    That model class wants its exact per-string template, not JSON blobs."""
    return bool(str(getattr(settings, "TRANSLATOR_BASE_URL", "") or "").strip())


def _translate_per_value(
    translator,
    strings: dict[str, str],
    *,
    target: str,
    source: str,
) -> dict[str, str]:
    """One dedicated call per string: fits the MT template and the dedicated
    max_tokens budget (a 500-key JSON blob does not). A translator that is
    down fails the whole catalog (honest marker — the client falls back to
    on-device translation), but a single meta-explained string only keeps
    its source text — one weird word must not kill the whole language."""
    out: dict[str, str] = {}
    for key, value in strings.items():
        if not value.strip():
            out[key] = value
            continue
        # Model occasionally meta-explains short ambiguous words instead of
        # translating them; such output is several times longer than the
        # source. Resample once (temperature sampling differs per call),
        # then keep the source text rather than serving garbage.
        cap = 3 * len(value) + 40
        try:
            raw = translator.translate(value, target_lang=target, source_lang=source)
            if raw and not is_stub_translation(raw) and len(raw) > cap:
                raw = translator.translate(
                    value, target_lang=target, source_lang=source
                )
        except Exception as exc:
            raise I18nUiError("Translation is unavailable right now") from exc
        if not raw or is_stub_translation(raw):
            raise I18nUiError("Translation is unavailable right now")
        out[key] = value if len(raw) > cap else raw
    return {k: out.get(k) or strings[k] for k in strings}


def translate_ui_strings(
    strings: dict[str, str],
    *,
    target_lang: str,
    source_lang: str = "en",
) -> dict[str, str]:
    if not strings:
        raise I18nUiError("Empty catalog")
    if len(strings) > MAX_KEYS:
        raise I18nUiError("Catalog too large")
    target = (target_lang or "")[:8].lower()
    if not target or target in {"ru", "en"}:
        raise I18nUiError("target_lang must be a machine locale")
    source = (source_lang or "en")[:8].lower() or "en"

    translator = get_translator()
    if _dedicated_translator_configured():
        return _translate_per_value(translator, strings, target=target, source=source)
    keys = list(strings.keys())
    out: dict[str, str] = {}
    for i in range(0, len(keys), CHUNK):
        chunk = {k: strings[k] for k in keys[i : i + CHUNK]}
        blob = json.dumps(chunk, ensure_ascii=False)
        prompt = (
            f"Translate JSON object values to language '{target}' (source '{source}'). "
            "Keep the same keys. Do not translate tokens like {count}. "
            "Output a JSON object only.\n\n"
            f"{blob}"
        )
        raw = translator.translate(prompt, target_lang=target, source_lang=source)
        if not raw or is_stub_translation(raw):
            raise I18nUiError("Translation is unavailable right now")
        parsed = _parse_json_object(raw)
        for k, v in parsed.items():
            if k in chunk and isinstance(v, str) and v.strip():
                out[k] = v
    return {k: out.get(k) or strings[k] for k in strings}


def _parse_json_object(raw: str) -> dict:
    text = _FENCE.sub("", raw.strip())
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(text[start : end + 1])
        else:
            raise I18nUiError("Bad translator JSON") from exc
    if not isinstance(data, dict):
        raise I18nUiError("Bad translator JSON")
    return data
