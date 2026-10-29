"""New chat message → MESSAGE notification for the peer (live/digest plumbing)."""

from __future__ import annotations

import pytest

from apps.dialogue.models import Dialogue, DialogueSource
from apps.dialogue.services import send_message
from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.notifications.models import Notification, NotificationKind


def _help_dialogue():
    helper = Account.objects.create_user(
        email="mn-helper@ex.com", password="password123", is_helper=True
    )
    sess = AnonymousSession.objects.create(pseudonym="гость")
    d = Dialogue.objects.create(
        story=None,
        source=DialogueSource.HELP,
        author_session=sess,
        peer_account=helper,
    )
    return d, helper, sess


@pytest.mark.django_db
def test_new_message_notifies_the_peer():
    d, helper, sess = _help_dialogue()
    send_message(Actor(kind="anonymous", session=sess), d.id, "привет")

    rows = Notification.objects.filter(kind=NotificationKind.MESSAGE)
    assert rows.count() == 1
    row = rows.first()
    assert row.recipient_account_id == helper.id
    assert row.recipient_session_id is None
    assert row.payload["dialogue_id"] == str(d.id)


@pytest.mark.django_db
def test_sender_never_notified_about_own_message():
    d, helper, sess = _help_dialogue()
    send_message(Actor(kind="account", account=helper), d.id, "я рядом")
    # peer (the visitor session) is notified; the sender is not.
    assert not Notification.objects.filter(
        kind=NotificationKind.MESSAGE, recipient_account=helper
    ).exists()
    assert Notification.objects.filter(
        kind=NotificationKind.MESSAGE, recipient_session=sess
    ).exists()


@pytest.mark.django_db
def test_peer_opt_out_of_message_kind():
    d, helper, sess = _help_dialogue()
    helper.notify_kinds = {"message": False}
    helper.save(update_fields=["notify_kinds"])
    send_message(Actor(kind="anonymous", session=sess), d.id, "привет")
    assert not Notification.objects.filter(kind=NotificationKind.MESSAGE).exists()