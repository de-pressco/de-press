"""Per-kind opt-out gate (notify_kinds) on the notify() service."""

from __future__ import annotations

import pytest

from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.notifications.models import Notification, NotificationKind
from apps.notifications.services import kind_enabled_for, notify


@pytest.mark.django_db
def test_kind_enabled_by_default_and_opt_out():
    acc = Account.objects.create_user(email="g1@ex.com", password="password123")
    actor = Actor(kind="account", account=acc)
    assert kind_enabled_for(actor, NotificationKind.MESSAGE) is True

    acc.notify_kinds = {"message": False}
    acc.save(update_fields=["notify_kinds"])
    assert kind_enabled_for(actor, NotificationKind.MESSAGE) is False
    assert kind_enabled_for(actor, NotificationKind.HELP_REQUESTED) is True


@pytest.mark.django_db
def test_notify_skips_row_for_opted_out_kind():
    acc = Account.objects.create_user(email="g2@ex.com", password="password123")
    acc.notify_kinds = {"help_requested": False}
    acc.save(update_fields=["notify_kinds"])
    actor = Actor(kind="account", account=acc)

    assert notify(actor, NotificationKind.HELP_REQUESTED, {}) is None
    assert Notification.objects.filter(recipient_account=acc).count() == 0

    notif = notify(actor, NotificationKind.MESSAGE, {})
    assert notif is not None
    assert notif.kind == NotificationKind.MESSAGE


@pytest.mark.django_db
def test_notify_gate_works_for_anonymous_session():
    sess = AnonymousSession.objects.create()
    sess.notify_kinds = {"message": False}
    sess.save(update_fields=["notify_kinds"])
    actor = Actor(kind="anonymous", session=sess)

    assert notify(actor, NotificationKind.MESSAGE, {}) is None
    assert Notification.objects.filter(recipient_session=sess).count() == 0