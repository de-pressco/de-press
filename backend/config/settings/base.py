"""Shared Django settings for de-press backend."""

from __future__ import annotations

import os
from pathlib import Path

from celery.schedules import crontab
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
REPO_ROOT = BASE_DIR.parent

# Load root .env then backend/.env (later wins for overrides)
load_dotenv(REPO_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "django-insecure-dev-only-change-me",
)

DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() in ("1", "true", "yes")

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "channels",
    "apps.common",
    "apps.identity",
    "apps.stories",
    "apps.empathy",
    "apps.support",
    "apps.dialogue",
    "apps.moderation",
    "apps.fund",
    "apps.therapy",
    "apps.ai",
    "apps.notifications",
    "apps.bot",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.identity.middleware.AnonymousSessionMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "depress"),
        "USER": os.environ.get("POSTGRES_USER", "depress"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "depress"),
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

AUTH_USER_MODEL = "identity.Account"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# File uploads (voice notes)
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024

# Email (soft-notify). Defaults to the console backend for dev.
EMAIL_BACKEND = os.environ.get(
    "DJANGO_EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend",
)
EMAIL_HOST = os.environ.get("DJANGO_EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.environ.get("DJANGO_EMAIL_PORT", "25"))
EMAIL_HOST_USER = os.environ.get("DJANGO_EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("DJANGO_EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("DJANGO_EMAIL_USE_TLS", "false").lower() in ("1", "true", "yes")
DEFAULT_FROM_EMAIL = os.environ.get(
    "DJANGO_DEFAULT_FROM_EMAIL",
    "de-press <noreply@depress.local>",
)

# Public base URL used in soft-notify magic links (frontend).
# Default targets the Next.js dev server; override to the real frontend URL in prod.
PUBLIC_BASE_URL = os.environ.get(
    "PUBLIC_BASE_URL",
    os.environ.get("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:5174"),
)

# CORS
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "DJANGO_CORS_ALLOWED_ORIGINS",
        "http://localhost:3005,http://127.0.0.1:3005,"
        "http://localhost:5174,http://127.0.0.1:5174",
    ).split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = list(CORS_ALLOWED_ORIGINS)

# Redis / Celery
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://127.0.0.1:6379/1")
CELERY_RESULT_BACKEND = os.environ.get(
    "CELERY_RESULT_BACKEND",
    "redis://127.0.0.1:6379/2",
)
CELERY_TASK_TRACK_STARTED = True
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
# Beat: daily Telegram digests (UTC). Override via TELEGRAM_DIGEST_HOUR/MINUTE.
# Plus a neutral check-in nudge (opt-in, throttled to one per
# TELEGRAM_NUDGE_INTERVAL_DAYS, default 3; skipped if a digest went out today).
# Blind to local check-ins — ZK, ADR-0025.
# Run: celery -A config worker -l info & celery -A config beat -l info
# Or cron: python manage.py send_telegram_digests / send_checkin_nudges
_tg_digest_hour = int(os.environ.get("TELEGRAM_DIGEST_HOUR", "10") or "10")
_tg_digest_minute = int(os.environ.get("TELEGRAM_DIGEST_MINUTE", "0") or "0")
_tg_nudge_hour = int(os.environ.get("TELEGRAM_NUDGE_HOUR", "19") or "19")
_tg_nudge_minute = int(os.environ.get("TELEGRAM_NUDGE_MINUTE", "0") or "0")
TELEGRAM_NUDGE_INTERVAL_DAYS = int(
    os.environ.get("TELEGRAM_NUDGE_INTERVAL_DAYS", "3") or "3"
)
CELERY_BEAT_SCHEDULE = {
    "telegram-daily-digests": {
        "task": "apps.notifications.tasks.send_telegram_daily_digests",
        "schedule": crontab(hour=_tg_digest_hour, minute=_tg_digest_minute),
    },
    "telegram-checkin-nudges": {
        "task": "apps.notifications.tasks.send_checkin_nudges",
        "schedule": crontab(hour=_tg_nudge_hour, minute=_tg_nudge_minute),
    },
}

# Channels (WebSocket)
# CHANNEL_LAYER=memory for tests / no Redis; default redis for multi-process
_channel_backend = os.environ.get("CHANNEL_LAYER", "redis").lower()


def _channel_redis_host(url: str) -> dict:
    """Redis host kwargs for channels-redis.

    redis-py 8+ defaults socket_timeout=5s, which races
    RedisChannelLayer.brpop_timeout=5s and kills idle WebSockets
    with TimeoutError on BZPOPMIN. Disable the read timeout on
    this connection only; keep a short connect timeout.
    """
    return {
        "address": url,
        "socket_timeout": None,
        "socket_connect_timeout": 5,
    }


if _channel_backend == "memory":
    CHANNEL_LAYERS = {
        "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [
                    _channel_redis_host(
                        os.environ.get("CHANNEL_REDIS_URL", REDIS_URL)
                    )
                ],
            },
        },
    }

# Anonymous session cookie
ANON_SESSION_COOKIE_NAME = "depress_anon"
ANON_SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year

# AI gateway (OpenAI-compatible: DeepSeek default, or xAI / other)
# Empty AI_API_KEY → offline template replies (dev-safe).
AI_API_KEY = os.environ.get("AI_API_KEY", "") or os.environ.get("DEEPSEEK_API_KEY", "")
AI_BASE_URL = os.environ.get("AI_BASE_URL", "https://api.deepseek.com")
AI_MODEL = os.environ.get("AI_MODEL", "deepseek-chat")

# Dedicated translator (OpenAI-compatible /v1/chat/completions).
# Empty TRANSLATOR_BASE_URL → existing get_gateway() / OfflineTranslator.
TRANSLATOR_BASE_URL = os.environ.get("TRANSLATOR_BASE_URL", "")
TRANSLATOR_MODEL = os.environ.get("TRANSLATOR_MODEL", "Hy-MT1.5-1.8B")
TRANSLATOR_API_KEY = os.environ.get("TRANSLATOR_API_KEY", "")
# Per-call timeout for the dedicated translator; local CPU inference needs
# more headroom than the previous hard-coded 30s (first call loads the model).
TRANSLATOR_TIMEOUT = float(os.environ.get("TRANSLATOR_TIMEOUT", "60") or "60")

# Non-custodial public fund (ADR-0020). The platform never moves money: the
# treasury is a Squads Multisig vault; the backend only displays its address
# and keeps a transparent duty-hours ledger. Empty address hides fund UI.
TREASURY_SOLANA_ADDRESS = os.environ.get("TREASURY_SOLANA_ADDRESS", "").strip()
TREASURY_SQUADS_URL = os.environ.get("TREASURY_SQUADS_URL", "").strip()
# Duty accounting: a helper's open shift segment closes lazily when heartbeats
# stop for this many minutes (credited up to the last heartbeat), and credit
# is capped per helper per UTC day (anti "forgotten shift" / farming).
FUND_STALE_GAP_MINUTES = int(os.environ.get("FUND_STALE_GAP_MINUTES", "15") or "15")
FUND_MAX_MINUTES_PER_DAY = int(os.environ.get("FUND_MAX_MINUTES_PER_DAY", "600") or "600")

# Live 1:1 voice (ADR 0021): self-hosted coturn TURN/STUN. Empty = ICE falls
# back to the browser's own candidates only (LAN / permissive NATs). DEPLOY.md §8.1.
WEBRTC_TURN_URL = os.environ.get("WEBRTC_TURN_URL", "").strip()
WEBRTC_TURN_USERNAME = os.environ.get("WEBRTC_TURN_USERNAME", "").strip()
WEBRTC_TURN_CREDENTIAL = os.environ.get("WEBRTC_TURN_CREDENTIAL", "").strip()

# Local sim_kids (Ollama). Not used in production product paths.
KIDS_BASE_URL = os.environ.get("KIDS_BASE_URL", "http://127.0.0.1:11434/v1")
KIDS_MODEL = os.environ.get("KIDS_MODEL", "qwen2.5:0.5b")
KIDS_API_KEY = os.environ.get("KIDS_API_KEY", "not-needed")
KIDS_PASSWORD = os.environ.get("KIDS_PASSWORD", "kid-local-not-secret")

# Telegram Mini App host (empty = /auth/telegram returns not configured).
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
# Public bot username without @ — for t.me deep links in soft-notify.
TELEGRAM_BOT_USERNAME = os.environ.get("TELEGRAM_BOT_USERNAME", "")
# Bot lobby webhook (Option B "living lobby"). Secret must match the
# secret_token passed to setWebhook. Empty = webhook endpoint is disabled (401).
TELEGRAM_BOT_WEBHOOK_SECRET = os.environ.get("TELEGRAM_BOT_WEBHOOK_SECRET", "")
# Full public webhook URL used by `manage.py setup_telegram_bot`. Empty =
# derived from PUBLIC_BASE_URL ("/api/v1/bot/webhook").
TELEGRAM_BOT_WEBHOOK_URL = os.environ.get("TELEGRAM_BOT_WEBHOOK_URL", "")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "depress-local",
    }
}

# Minimal server observability: errors reach stderr without request bodies or
# any user content (audit Q7). runserver request lines stay via django.server.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "{levelname} {name} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "django.server": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        # 4xx stay quiet; 5xx surface as ERROR — message only, never payloads.
        "django.request": {"level": "ERROR"},
        "apps": {"level": "ERROR"},
    },
}
