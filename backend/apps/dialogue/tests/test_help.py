import pytest
from django.db import IntegrityError

from apps.dialogue.help import (
    HELP_CREATE_LIMIT,
    HelpError,
    accept_help_request,
    cancel_help_request,
    create_help_request,
    list_help_inbox,
    my_help_request,
    skip_help_request,
)
from apps.dialogue.models import Dialogue, DialogueSource, HelpRequest, HelpRequestSkip
from apps.dialogue.services import list_messages, send_message
from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.moderation.blocks import block_actor
from apps.notifications.models import Notification, NotificationKind


@pytest.mark.django_db
def test_help_request_one_pending_per_account():
    acc = Account.objects.create_user(email="u@ex.com", password="password123")
    HelpRequest.objects.create(from_account=acc, note="тихо")
    with pytest.raises(IntegrityError):
        HelpRequest.objects.create(from_account=acc, note="ещё")


@pytest.mark.django_db
def test_dialogue_help_allows_null_story():
    helper = Account.objects.create_user(
        email="h@ex.com", password="password123", is_helper=True, is_on_duty=True
    )
    sess = AnonymousSession.objects.create(pseudonym="гость")
    d = Dialogue.objects.create(
        story=None,
        source=DialogueSource.HELP,
        author_session=sess,
        peer_account=helper,
    )
    assert d.story_id is None
    assert d.source == DialogueSource.HELP


@pytest.mark.django_db
def test_anon_create_helper_accept_creates_dialogue_without_story():
    helper_acc = Account.objects.create_user(
        email="helper@ex.com", password="password123", is_helper=True, is_on_duty=True
    )
    helper = Actor(kind="account", account=helper_acc)
    sess = AnonymousSession.objects.create(pseudonym="гость")
    visitor = Actor(kind="anonymous", session=sess)

    req = create_help_request(visitor, note="мне тяжело")
    assert req.status == "pending"
    assert Notification.objects.filter(
        kind=NotificationKind.HELP_REQUESTED, recipient_account=helper_acc
    ).exists()
    assert list_help_inbox(helper)[0].id == req.id

    dialogue = accept_help_request(helper, req.id)
    assert dialogue.story_id is None
    assert dialogue.source == "help"
    assert dialogue.author_session_id == sess.id
    assert dialogue.peer_account_id == helper_acc.id
    req.refresh_from_db()
    assert req.status == "accepted"
    assert req.dialogue_id == dialogue.id
    assert Notification.objects.filter(
        kind=NotificationKind.HELP_ACCEPTED, recipient_session=sess
    ).exists()
    assert list_help_inbox(helper) == []


@pytest.mark.django_db
def test_second_helper_loses_the_race():
    h1 = Account.objects.create_user(email="h1@ex.com", password="password123", is_helper=True, is_on_duty=True)
    h2 = Account.objects.create_user(email="h2@ex.com", password="password123", is_helper=True, is_on_duty=True)
    sess = AnonymousSession.objects.create()
    req = create_help_request(Actor(kind="anonymous", session=sess))
    accept_help_request(Actor(kind="account", account=h1), req.id)
    with pytest.raises(HelpError):
        accept_help_request(Actor(kind="account", account=h2), req.id)


@pytest.mark.django_db
def test_skip_hides_only_for_that_helper():
    h1 = Account.objects.create_user(email="s1@ex.com", password="password123", is_helper=True, is_on_duty=True)
    h2 = Account.objects.create_user(email="s2@ex.com", password="password123", is_helper=True, is_on_duty=True)
    sess = AnonymousSession.objects.create()
    req = create_help_request(Actor(kind="anonymous", session=sess))
    skip_help_request(Actor(kind="account", account=h1), req.id)
    assert list_help_inbox(Actor(kind="account", account=h1)) == []
    assert list_help_inbox(Actor(kind="account", account=h2))[0].id == req.id
    req.refresh_from_db()
    assert req.status == "pending"


@pytest.mark.django_db
def test_create_is_idempotent_pending():
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)
    a = create_help_request(visitor, note="раз")
    b = create_help_request(visitor, note="два")
    assert a.id == b.id
    assert b.note == "раз"  # first note kept


@pytest.mark.django_db
def test_cancel_by_requester():
    helper = Account.objects.create_user(email="c@ex.com", password="password123", is_helper=True, is_on_duty=True)
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)
    req = create_help_request(visitor)
    cancel_help_request(visitor, req.id)
    req.refresh_from_db()
    assert req.status == "cancelled"
    assert list_help_inbox(Actor(kind="account", account=helper)) == []


@pytest.mark.django_db
def test_non_helper_cannot_accept():
    acc = Account.objects.create_user(email="n@ex.com", password="password123")
    sess = AnonymousSession.objects.create()
    req = create_help_request(Actor(kind="anonymous", session=sess))
    with pytest.raises(HelpError):
        accept_help_request(Actor(kind="account", account=acc), req.id)


@pytest.mark.django_db
def test_helper_cannot_accept_own_request():
    helper = Account.objects.create_user(email="self@ex.com", password="password123", is_helper=True, is_on_duty=True)
    actor = Actor(kind="account", account=helper)
    req = create_help_request(actor)
    assert list_help_inbox(actor) == []
    with pytest.raises(HelpError):
        accept_help_request(actor, req.id)


@pytest.mark.django_db
def test_my_help_request_returns_pending():
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)
    req = create_help_request(visitor, note="жду")
    mine = my_help_request(visitor)
    assert mine is not None
    assert mine.id == req.id
    assert mine.status == "pending"


@pytest.mark.django_db
def test_my_help_request_returns_accepted_within_24h():
    helper_acc = Account.objects.create_user(
        email="mh@ex.com", password="password123", is_helper=True, is_on_duty=True
    )
    helper = Actor(kind="account", account=helper_acc)
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)
    req = create_help_request(visitor)
    dialogue = accept_help_request(helper, req.id)
    mine = my_help_request(visitor)
    assert mine is not None
    assert mine.id == req.id
    assert mine.status == "accepted"
    assert mine.dialogue_id == dialogue.id


@pytest.mark.django_db
def test_create_rate_limit_after_five_in_window():
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)
    for _ in range(HELP_CREATE_LIMIT):
        req = create_help_request(visitor)
        cancel_help_request(visitor, req.id)
    with pytest.raises(HelpError):
        create_help_request(visitor)


@pytest.mark.django_db
def test_accept_blocked_between_raises():
    helper_acc = Account.objects.create_user(
        email="blk-h@ex.com", password="password123", is_helper=True, is_on_duty=True
    )
    helper = Actor(kind="account", account=helper_acc)
    sess = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=sess)
    req = create_help_request(visitor)
    block_actor(helper, target_session_id=sess.id)
    with pytest.raises(HelpError):
        accept_help_request(helper, req.id)


@pytest.mark.django_db
def test_help_dialogue_both_participants_can_send_message():
    """Story-less Help chat: send_message must not join story under FOR UPDATE."""
    helper_acc = Account.objects.create_user(
        email="send-h@ex.com", password="password123", is_helper=True, is_on_duty=True
    )
    helper = Actor(kind="account", account=helper_acc)
    sess = AnonymousSession.objects.create(pseudonym="гость")
    visitor = Actor(kind="anonymous", session=sess)

    req = create_help_request(visitor, note="нужно поговорить")
    dialogue = accept_help_request(helper, req.id)
    assert dialogue.story_id is None

    send_message(visitor, dialogue.id, "привет, мне тяжело")
    send_message(helper, dialogue.id, "я здесь, слушаю")

    bodies = [m.body for m in list_messages(visitor, dialogue.id)]
    assert "привет, мне тяжело" in bodies
    assert "я здесь, слушаю" in bodies
    assert [m.body for m in list_messages(helper, dialogue.id)] == bodies


@pytest.mark.django_db
def test_existing_story_dialogue_still_requires_story_in_request_flow():
    from apps.dialogue.services import accept_request
    from apps.dialogue.tests.helpers import create_reviewed_request
    from apps.stories.services import publish_story

    author = Account.objects.create_user(email="a@ex.com", password="password123")
    story = publish_story(Actor(kind="account", account=author), "монолог")
    sess = AnonymousSession.objects.create()
    req = create_reviewed_request(
        Actor(kind="anonymous", session=sess), story, intent="listen"
    )
    d = accept_request(Actor(kind="account", account=author), req.id)
    assert d.story_id == story.id
    assert d.source == "request"


@pytest.mark.django_db
def test_off_duty_helper_is_not_notified_but_sees_the_queue():
    """Duty gates notifications, not visibility (owner decision 2026-10-27)."""
    off = Account.objects.create_user(
        email="off@ex.com", password="password123", is_helper=True
    )
    on = Account.objects.create_user(
        email="on@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
    )
    sess = AnonymousSession.objects.create()
    req = create_help_request(Actor(kind="anonymous", session=sess))

    assert not Notification.objects.filter(
        kind=NotificationKind.HELP_REQUESTED, recipient_account=off
    ).exists()
    assert Notification.objects.filter(
        kind=NotificationKind.HELP_REQUESTED, recipient_account=on
    ).exists()
    assert list_help_inbox(Actor(kind="account", account=off))[0].id == req.id
    assert list_help_inbox(Actor(kind="account", account=on))[0].id == req.id



@pytest.mark.django_db
def test_instant_match_notifies_helper_as_requested():
    """B14: the matched helper gets HELP_REQUESTED; HELP_ACCEPTED is for the asker."""
    from django.utils import timezone

    helper = Account.objects.create_user(
        email="instant@ex.com",
        password="password123",
        is_helper=True,
        is_on_duty=True,
        helper_seen_at=timezone.now(),
    )
    sess = AnonymousSession.objects.create()
    requester = Actor(kind="anonymous", session=sess)

    req = create_help_request(requester)
    req.refresh_from_db()

    assert req.status == "accepted"
    assert req.dialogue_id is not None
    assert Notification.objects.filter(
        kind=NotificationKind.HELP_REQUESTED, recipient_account=helper
    ).exists()
    assert not Notification.objects.filter(
        kind=NotificationKind.HELP_ACCEPTED, recipient_account=helper
    ).exists()
    assert Notification.objects.filter(
        kind=NotificationKind.HELP_ACCEPTED, recipient_session=sess
    ).exists()
