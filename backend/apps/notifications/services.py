"""Deep notifications module: private nudge events with read state."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import transaction
from django.db.models import Q

from apps.identity.services import Actor
from apps.notifications.models import Notification, NotificationKind
from apps.notifications.realtime import broadcast_notification, serialize_notification
from apps.notifications.telegram_notify import schedule_telegram_soft_notify


class NotificationError(Exception):
    pass


# Chat unread lives on the dialogue list; clouds live as a feed-row gesture.
_INBOX_HIDDEN = (
    NotificationKind.MESSAGE,
    NotificationKind.SUPPORT_CLOUD,
    NotificationKind.CLOUD_APPROVED,
    NotificationKind.SILENT_EMPATHY,
)


def kind_enabled_for(recipient: Actor, kind: str) -> bool:
    """Per-kind opt-out gate (notify_kinds JSON). Missing kind = enabled."""
    src = recipient.account if recipient.account is not None else recipient.session
    if src is None:
        return False
    prefs = src.notify_kinds or {}
    return bool(prefs.get(kind, True))


def _recipient_q(actor: Actor) -> Q:
    """Query filter for notifications belonging to this actor."""
    if actor.account is not None:
        return Q(recipient_account=actor.account)
    if actor.session is not None:
        return Q(recipient_session=actor.session)
    return Q(pk=None)  # no identity → nothing


def notify(
    recipient: Actor,
    kind: str,
    payload: dict[str, Any] | None = None,
) -> Notification | None:
    """Create a private notification for the recipient and broadcast live.

    Safe inside `@transaction.atomic`: the broadcast is deferred to
    `transaction.on_commit`, so peers only see committed state.
    Returns None (no row) when the recipient opted out of this kind.
    """
    if recipient.account is None and recipient.session is None:
        raise NotificationError("Recipient has no identity")

    if kind not in NotificationKind.values:
        raise NotificationError(f"Unknown kind: {kind}")

    if not kind_enabled_for(recipient, kind):
        return None

    notif = Notification.objects.create(
        recipient_account=recipient.account,
        recipient_session=recipient.session if recipient.account is None else None,
        kind=kind,
        payload=dict(payload or {}),
        is_read=False,
    )

    def _broadcast() -> None:
        try:
            fresh = Notification.objects.get(pk=notif.pk)
        except Notification.DoesNotExist:
            return
        broadcast_notification(fresh, recipient)

    transaction.on_commit(_broadcast)
    # Opt-in Telegram Bot soft-notify (Mini App host); no-op if not configured.
    schedule_telegram_soft_notify(recipient, notif)
    return notif


def list_notifications(
    actor: Actor,
    *,
    limit: int = 30,
    only_unread: bool = False,
) -> list[Notification]:
    limit = max(1, min(int(limit or 30), 100))
    q = _recipient_q(actor) & ~Q(kind__in=_INBOX_HIDDEN)
    if only_unread:
        q &= Q(is_read=False)
    return list(
        Notification.objects.filter(q).order_by("-created_at", "-id")[:limit]
    )


def unread_count(actor: Actor) -> int:
    q = _recipient_q(actor) & ~Q(kind__in=_INBOX_HIDDEN)
    return Notification.objects.filter(q, is_read=False).count()


@transaction.atomic
def mark_read(actor: Actor, notification_id: UUID) -> Notification:
    try:
        notif = Notification.objects.select_for_update().get(pk=notification_id)
    except Notification.DoesNotExist as exc:
        raise NotificationError("Notification not found") from exc

    if actor.account is not None:
        is_recipient = notif.recipient_account_id == actor.account.id
    elif actor.session is not None:
        is_recipient = notif.recipient_session_id == actor.session.id
    else:
        is_recipient = False

    if not is_recipient:
        raise NotificationError("Not a recipient")

    if not notif.is_read:
        notif.is_read = True
        notif.save(update_fields=["is_read"])
    return notif


def mark_all_read(actor: Actor) -> int:
    q = _recipient_q(actor) & Q(is_read=False)
    updated = Notification.objects.filter(q).update(is_read=True)
    return int(updated)