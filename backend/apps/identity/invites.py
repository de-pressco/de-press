"""Helper invite tokens — no open self-signup."""

from __future__ import annotations

import secrets
from datetime import timedelta

from django.utils import timezone

from apps.identity.models import Account, HelperInvite
from apps.identity.services import Actor


class InviteError(Exception):
    pass


DEFAULT_TTL_HOURS = 168
MAX_TTL_HOURS = 720


def _can_invite(actor: Actor) -> bool:
    acc = actor.account
    if acc is None or not acc.is_active:
        return False
    return bool(acc.is_helper or acc.is_staff or acc.is_superuser)


def create_helper_invite(
    actor: Actor,
    *,
    org: str = "",
    ttl_hours: int = DEFAULT_TTL_HOURS,
) -> HelperInvite:
    if not _can_invite(actor):
        raise InviteError("Only a Helper or staff can create invites")
    hours = ttl_hours if ttl_hours > 0 else DEFAULT_TTL_HOURS
    hours = min(hours, MAX_TTL_HOURS)
    org_s = (org or "").strip()[:120] or (actor.account.helper_org if actor.account else "")
    token = secrets.token_urlsafe(32)
    return HelperInvite.objects.create(
        token=token,
        org=org_s[:120],
        created_by=actor.account,
        expires_at=timezone.now() + timedelta(hours=hours),
    )


def list_my_invites(actor: Actor, *, limit: int = 20) -> list[HelperInvite]:
    if not _can_invite(actor):
        raise InviteError("Only a Helper or staff can create invites")
    return list(
        HelperInvite.objects.filter(created_by=actor.account).order_by("-created_at")[
            :limit
        ]
    )


def get_helper_invite(token: str) -> HelperInvite:
    raw = (token or "").strip()
    if not raw:
        raise InviteError("Invite not found")
    try:
        return HelperInvite.objects.get(token=raw)
    except HelperInvite.DoesNotExist as exc:
        raise InviteError("Invite not found") from exc


def revoke_helper_invite(actor: Actor, token: str) -> None:
    """Delete an unused invite (its author or any staff member)."""
    if not _can_invite(actor):
        raise InviteError("Only a Helper or staff can revoke invites")
    invite = get_helper_invite(token)
    account = actor.account
    is_owner = invite.created_by_id == (account.id if account else None)
    if not is_owner and not (account.is_staff or account.is_superuser):
        raise InviteError("Only the author or staff can revoke this invite")
    if invite.used_at is not None:
        raise InviteError("Invite already used")
    invite.delete()


def accept_helper_invite(actor: Actor, token: str, *, pledge: bool) -> Account:
    if actor.account is None:
        raise InviteError("An account is required to become a Helper")
    if not pledge:
        raise InviteError("The promise must be accepted first")
    invite = get_helper_invite(token)
    now = timezone.now()
    if invite.used_at is not None:
        raise InviteError("Invite already used")
    if invite.expires_at <= now:
        raise InviteError("Invite expired")
    account = actor.account
    if account.is_helper:
        raise InviteError("You are already a Helper")
    account.is_helper = True
    if invite.org:
        account.helper_org = invite.org
    account.save(update_fields=["is_helper", "helper_org"])
    invite.used_at = now
    invite.used_by = account
    invite.save(update_fields=["used_at", "used_by"])
    return account
