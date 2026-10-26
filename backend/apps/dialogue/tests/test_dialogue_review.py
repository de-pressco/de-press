from __future__ import annotations

import pytest

from apps.dialogue.models import DialogueRequestStatus
from apps.dialogue.services import (
    DialogueError,
    accept_request,
    create_request,
    list_inbox,
)
from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.notifications.models import Notification, NotificationKind
from apps.stories.services import publish_story


@pytest.mark.django_db
def test_create_request_goes_to_author():
    helper_acc = Account.objects.create_user(
        email="revh@ex.com", password="password123", is_helper=True, is_on_duty=True
    )
    helper = Actor(kind="account", account=helper_acc)
    author_acc = Account.objects.create_user(
        email="reva@ex.com", password="password123"
    )
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Мне нужно, чтобы меня услышали.")
    peer = Actor(kind="anonymous", session=AnonymousSession.objects.create())

    req = create_request(peer, story.id, intent="listen", note="я рядом")
    assert req.status == DialogueRequestStatus.PENDING
    assert list_inbox(author)[0].id == req.id
    assert Notification.objects.filter(
        kind=NotificationKind.DIALOGUE_REQUEST,
        recipient_account=author_acc,
    ).exists()
    assert not Notification.objects.filter(
        kind=NotificationKind.DIALOGUE_REQUEST_REVIEW,
        recipient_account=helper_acc,
    ).exists()

    dialogue = accept_request(author, req.id)
    assert dialogue.source == "request"


@pytest.mark.django_db
def test_author_decline_hides_request():
    from apps.dialogue.services import decline_request

    author = Actor(
        kind="account",
        account=Account.objects.create_user(
            email="reja@ex.com", password="password123"
        ),
    )
    story = publish_story(author, "тихо")
    peer = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    req = create_request(peer, story.id, intent="listen")
    decline_request(author, req.id)
    req.refresh_from_db()
    assert req.status == DialogueRequestStatus.DECLINED
    assert list_inbox(author) == []
