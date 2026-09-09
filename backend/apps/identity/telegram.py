"""Telegram Mini App initData validation and account linking.

Official algorithm:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl

from django.conf import settings
from django.contrib.auth import login
from django.db import transaction
from django.http import HttpRequest

from apps.identity.models import Account
from apps.identity.services import AuthError


# Reject initData older than this (seconds). Telegram recommends checking auth_date.
INIT_DATA_MAX_AGE_SEC = 60 * 60 * 24  # 24h


@dataclass(frozen=True, slots=True)
class TelegramWebAppUser:
    id: int
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    language_code: str = ""
    is_premium: bool = False
    photo_url: str = ""


@dataclass(frozen=True, slots=True)
class ValidatedInitData:
    user: TelegramWebAppUser
    auth_date: int
    query_id: str = ""
    start_param: str = ""
    raw: dict[str, str] | None = None


def _bot_token() -> str:
    return (getattr(settings, "TELEGRAM_BOT_TOKEN", None) or "").strip()


def validate_init_data(
    init_data: str,
    *,
    bot_token: str | None = None,
    max_age_sec: int = INIT_DATA_MAX_AGE_SEC,
    now: int | None = None,
) -> ValidatedInitData:
    """Parse and HMAC-verify Telegram.WebApp.initData. Raises AuthError on failure."""
    token = (bot_token if bot_token is not None else _bot_token()).strip()
    if not token:
        raise AuthError("Telegram login is not configured")

    raw = (init_data or "").strip()
    if not raw:
        raise AuthError("Missing Telegram init data")

    pairs = dict(parse_qsl(raw, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise AuthError("Invalid Telegram init data")

    # Optional signature field (Bot API 8+); not part of data-check-string for classic hash.
    pairs.pop("signature", None)

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(
        b"WebAppData",
        token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    calculated = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(calculated, received_hash):
        raise AuthError("Invalid Telegram signature")

    try:
        auth_date = int(pairs.get("auth_date") or "0")
    except ValueError as exc:
        raise AuthError("Invalid Telegram auth_date") from exc

    ts = int(time.time()) if now is None else now
    if auth_date <= 0 or (ts - auth_date) > max_age_sec:
        raise AuthError("Telegram init data expired")

    user_raw = pairs.get("user")
    if not user_raw:
        raise AuthError("Telegram user missing from init data")

    try:
        user_obj: dict[str, Any] = json.loads(user_raw)
    except json.JSONDecodeError as exc:
        raise AuthError("Invalid Telegram user payload") from exc

    try:
        user_id = int(user_obj["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AuthError("Invalid Telegram user id") from exc

    user = TelegramWebAppUser(
        id=user_id,
        first_name=str(user_obj.get("first_name") or "")[:64],
        last_name=str(user_obj.get("last_name") or "")[:64],
        username=str(user_obj.get("username") or "")[:64],
        language_code=str(user_obj.get("language_code") or "")[:16],
        is_premium=bool(user_obj.get("is_premium")),
        photo_url=str(user_obj.get("photo_url") or "")[:512],
    )

    return ValidatedInitData(
        user=user,
        auth_date=auth_date,
        query_id=str(pairs.get("query_id") or ""),
        start_param=str(pairs.get("start_param") or ""),
        raw=pairs,
    )


def _synthetic_email(telegram_id: int) -> str:
    """Stable unique email for TG-only accounts (not a real mailbox)."""
    return f"tg{telegram_id}@users.de-press.local"


def _default_pseudonym(user: TelegramWebAppUser) -> str:
    name = (user.first_name or "").strip()
    if name:
        return name[:64]
    if user.username:
        return user.username[:64]
    return "guest"


@transaction.atomic
def login_or_register_telegram(
    *,
    init_data: str,
    request: HttpRequest,
    bot_token: str | None = None,
) -> Account:
    """Validate initData, find/create Account by telegram_id, log into Django session."""
    validated = validate_init_data(init_data, bot_token=bot_token)
    user = validated.user

    account = Account.objects.filter(telegram_id=user.id).first()
    if account is None:
        email = _synthetic_email(user.id)
        # Rare race: email taken without telegram_id — reclaim if same synthetic pattern.
        existing = Account.objects.filter(email__iexact=email).first()
        if existing is not None:
            if existing.telegram_id and existing.telegram_id != user.id:
                raise AuthError("Telegram identity conflict")
            account = existing
            account.telegram_id = user.id
        else:
            account = Account(
                email=email,
                default_pseudonym=_default_pseudonym(user),
                telegram_id=user.id,
                email_verified=False,
            )
            account.set_unusable_password()
            account.save()

    # Refresh non-secret TG metadata; never put @username in public feed automatically.
    if user.username and account.telegram_username != user.username:
        account.telegram_username = user.username[:64]
        account.save(update_fields=["telegram_username"])

    # Remember Telegram UI language (lowercased, short) for bot message locale.
    tg_lang = (user.language_code or "").strip().lower()[:8]
    if tg_lang and account.telegram_language_code != tg_lang:
        account.telegram_language_code = tg_lang
        account.save(update_fields=["telegram_language_code"])

    if not account.default_pseudonym:
        account.default_pseudonym = _default_pseudonym(user)
        account.save(update_fields=["default_pseudonym"])

    login(request, account)
    return account
