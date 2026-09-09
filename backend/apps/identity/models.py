"""Identity domain: Account and AnonymousSession."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class VoiceRetention(models.TextChoices):
    DELETE_ON_CLOSE = "delete_on_close", "Delete on close"
    KEEP = "keep", "Keep"


class AccountManager(BaseUserManager):
    def create_user(
        self,
        email: str,
        password: str | None = None,
        **extra_fields,
    ) -> Account:
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        account = self.model(email=email, **extra_fields)
        account.set_password(password)
        account.save(using=self._db)
        return account

    def on_duty_helpers(self):
        return self.filter(is_helper=True, is_on_duty=True, is_active=True)

    def create_superuser(
        self,
        email: str,
        password: str | None = None,
        **extra_fields,
    ) -> Account:
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True")
        return self.create_user(email, password, **extra_fields)


class Account(AbstractBaseUser, PermissionsMixin):
    """Optional registered identity (email + password)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    default_pseudonym = models.CharField(max_length=64, blank=True, default="")
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    # Helper: verified volunteer / partner-org listener (ADR-0010). Not a clinician by default.
    is_helper = models.BooleanField(default=False, db_index=True)
    # Shift flag: Help Request notify+inbox only when on duty.
    is_on_duty = models.BooleanField(default=False, db_index=True)
    # Heartbeat for instant match. Online = helper_seen_at within 45s (see presence.py).
    helper_seen_at = models.DateTimeField(null=True, blank=True, db_index=True)
    helper_last_matched_at = models.DateTimeField(null=True, blank=True)
    helper_org = models.CharField(max_length=120, blank=True, default="")
    date_joined = models.DateTimeField(default=timezone.now)
    # Soft-notify preferences (P1: email/web).
    notify_email_opt_in = models.BooleanField(default=False)
    notify_digest_frequency = models.CharField(
        max_length=16,
        choices=[
            ("off", "Off"),
            ("immediate", "Immediate"),
            ("daily", "Daily digest"),
        ],
        default="daily",
    )
    email_verified = models.BooleanField(default=False)
    # Telegram Mini App host (ADR-0013): stable TG user id for seamless login.
    # Null for email-only accounts. Unique when set.
    telegram_id = models.BigIntegerField(
        null=True,
        blank=True,
        unique=True,
        db_index=True,
    )
    telegram_username = models.CharField(max_length=64, blank=True, default="")
    # Telegram UI language ("ru", "en", "pt-br", …) — used to pick the locale
    # of bot messages (soft-notify, digests). Not a full locale system.
    telegram_language_code = models.CharField(max_length=8, blank=True, default="")
    # Soft-notify via Telegram Bot (Mini App host). Opt-in only; never default spam.
    notify_telegram_opt_in = models.BooleanField(default=False)
    # Last successful Telegram daily digest (for incremental unread window).
    telegram_digest_last_at = models.DateTimeField(null=True, blank=True)
    # Last sent neutral check-in nudge (throttle; blind to local check-ins).
    telegram_nudge_last_at = models.DateTimeField(null=True, blank=True)
    voice_retention = models.CharField(
        max_length=32,
        choices=VoiceRetention.choices,
        default=VoiceRetention.DELETE_ON_CLOSE,
    )
    # Listener Tipping (ADR-0020): opt-in public Solana address for direct
    # P2P USDC tips. The platform never custodies funds and takes no fees.
    # Empty = tipping off. Helpers should use a dedicated wallet (on-chain
    # tips are linkable); validated in apps.fund.services.
    tip_wallet_address = models.CharField(max_length=44, blank=True, default="")
    # ADR-0020 phase 2: when the ownership signature was verified (off-chain
    # ed25519 over the canonical challenge). Empty address always clears it.
    tip_wallet_verified_at = models.DateTimeField(null=True, blank=True, default=None)

    objects = AccountManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        verbose_name = "Account"
        verbose_name_plural = "Accounts"
        ordering = ("-date_joined",)

    def __str__(self) -> str:
        return self.email

    @property
    def display_pseudonym(self) -> str:
        return self.default_pseudonym or self.email.split("@")[0]

    @property
    def helper_badge_label(self) -> str:
        """Author-private badge text, e.g. 'Helper · org'."""
        if not self.is_helper:
            return ""
        org = (self.helper_org or "").strip()
        return f"Helper · {org}" if org else "Helper"


class HelperInvite(models.Model):
    """One-time invite so a trusted person can become a Helper (ADR-0010)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=64, unique=True, db_index=True)
    org = models.CharField(max_length=120, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="helper_invites_created",
    )
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    used_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="helper_invites_accepted",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Helper invite"
        verbose_name_plural = "Helper invites"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"helper-invite:{self.token[:8]}"


class AnonymousSession(models.Model):
    """Server-side Visitor identity bound to a cookie."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pseudonym = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    # Soft-notify for anonymous authors: optional contact email (magic link).
    contact_email = models.EmailField(blank=True, default="")
    contact_email_verified = models.BooleanField(default=False)
    notify_email_opt_in = models.BooleanField(default=False)
    notify_digest_frequency = models.CharField(
        max_length=16,
        choices=[
            ("off", "Off"),
            ("immediate", "Immediate"),
            ("daily", "Daily digest"),
        ],
        default="daily",
    )
    voice_retention = models.CharField(
        max_length=32,
        choices=VoiceRetention.choices,
        default=VoiceRetention.DELETE_ON_CLOSE,
    )

    class Meta:
        verbose_name = "Anonymous session"
        verbose_name_plural = "Anonymous sessions"
        ordering = ("-last_seen_at",)

    def __str__(self) -> str:
        return f"anon:{self.id}"

    @property
    def display_pseudonym(self) -> str:
        return self.pseudonym or "anonymous"

    @property
    def notify_email(self) -> str:
        """Best contact email for soft-notify (empty if unset)."""
        return (self.contact_email or "").strip()