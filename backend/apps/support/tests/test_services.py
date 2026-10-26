"""Tests through the support module interface."""

from __future__ import annotations

import pytest

from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.moderation.blocks import block_actor
from apps.moderation.models import ModerationAction, ModerationActionKind
from apps.stories.services import publish_story
from apps.support.models import QuietPhrase, SupportCloud
from apps.support.models import SupportCloudStatus
from apps.support.services import (
    SupportError,
    approve_cloud,
    list_clouds_for_author,
    list_pending_queue,
    list_quiet_phrases,
    reject_cloud,
    send_quiet_phrase,
    submit_moderated_cloud,
)


@pytest.fixture
def phrase(db) -> QuietPhrase:
    return QuietPhrase.objects.create(
        key="i_am_here",
        text_ru="Я рядом. Без слов.",
        sort_order=10,
        is_active=True,
    )


@pytest.fixture
def inactive_phrase(db) -> QuietPhrase:
    return QuietPhrase.objects.create(
        key="old",
        text_ru="Старая фраза",
        sort_order=99,
        is_active=False,
    )


@pytest.mark.django_db
def test_list_quiet_phrases_only_active(phrase, inactive_phrase):
    items = list_quiet_phrases()
    keys = [p.key for p in items]
    assert "i_am_here" in keys
    assert "old" not in keys
    assert items[0].text == "Я рядом. Без слов."


@pytest.mark.django_db
def test_seed_keeps_three_active():
    from django.core.management import call_command

    QuietPhrase.objects.create(
        key="extra_old", text_ru="лишнее", sort_order=1, is_active=True
    )
    call_command("seed_quiet_phrases")
    active = list(
        QuietPhrase.objects.filter(is_active=True).values_list("key", flat=True)
    )
    assert set(active) == {"i_am_here", "i_hear", "not_alone"}


@pytest.mark.django_db
def test_list_quiet_phrases_lang_en():
    QuietPhrase.objects.create(
        key="i_am_here",
        text_ru="Я рядом. Без слов.",
        text_en="I'm here. No words needed.",
        sort_order=10,
        is_active=True,
    )
    ru = list_quiet_phrases(lang="ru")
    en = list_quiet_phrases(lang="en")
    assert ru[0].text == "Я рядом. Без слов."
    assert en[0].text == "I'm here. No words needed."


@pytest.mark.django_db
def test_send_quiet_phrase_happy_path(phrase):
    author_acc = Account.objects.create_user(
        email="author@example.com", password="password123", default_pseudonym="автор"
    )
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Сегодня очень тяжело.")

    session = AnonymousSession.objects.create(pseudonym="слушатель")
    visitor = Actor(kind="anonymous", session=session)

    result = send_quiet_phrase(visitor, story.id, "i_am_here")
    assert result.created is True
    assert result.cloud.body_snapshot == "Я рядом. Без слов."
    assert result.cloud.pseudonym_snapshot == "слушатель"
    assert result.cloud.status == "delivered"

    clouds = list_clouds_for_author(author, story.id)
    assert len(clouds) == 1
    assert clouds[0].body == "Я рядом. Без слов."
    assert clouds[0].pseudonym == "слушатель"
    assert clouds[0].sender_ref.startswith("session:")
    assert clouds[0].kind == "quiet_phrase"


@pytest.mark.django_db
def test_send_quiet_phrase_unique_per_phrase(phrase):
    author_acc = Account.objects.create_user(email="a@ex.com", password="password123")
    story = publish_story(Actor(kind="account", account=author_acc), "Текст.")

    session = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=session)

    first = send_quiet_phrase(visitor, story.id, "i_am_here")
    second = send_quiet_phrase(visitor, story.id, "i_am_here")
    assert first.created is True
    assert second.created is False
    assert SupportCloud.objects.filter(story=story).count() == 1


@pytest.mark.django_db
def test_one_cloud_per_sender(phrase):
    QuietPhrase.objects.create(
        key="i_hear", text_ru="Слышу. Это тяжело.", sort_order=20, is_active=True
    )
    author_acc = Account.objects.create_user(email="a2@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Текст.")
    session = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=session)

    send_quiet_phrase(visitor, story.id, "i_am_here")
    with pytest.raises(SupportError, match="one cloud"):
        send_quiet_phrase(visitor, story.id, "i_hear")
    assert SupportCloud.objects.filter(story=story).count() == 1


@pytest.mark.django_db
def test_author_dismiss_cloud(phrase):
    from apps.support.services import dismiss_cloud

    author_acc = Account.objects.create_user(email="ad@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Текст.")
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    result = send_quiet_phrase(visitor, story.id, "i_am_here")
    dismiss_cloud(author, story.id, result.cloud.id)
    assert list_clouds_for_author(author, story.id) == []


@pytest.mark.django_db
def test_cannot_send_to_own_story(phrase):
    account = Account.objects.create_user(email="self@ex.com", password="password123")
    actor = Actor(kind="account", account=account)
    story = publish_story(actor, "Моя история.")
    with pytest.raises(SupportError, match="own story"):
        send_quiet_phrase(actor, story.id, "i_am_here")


@pytest.mark.django_db
def test_non_author_cannot_list_clouds(phrase):
    author_acc = Account.objects.create_user(email="au@ex.com", password="password123")
    story = publish_story(Actor(kind="account", account=author_acc), "Текст.")
    session = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=session)
    send_quiet_phrase(visitor, story.id, "i_am_here")

    other = Actor(
        kind="anonymous", session=AnonymousSession.objects.create(pseudonym="другой")
    )
    with pytest.raises(SupportError, match="Only the author can see clouds"):
        list_clouds_for_author(other, story.id)


@pytest.mark.django_db
def test_blocked_cannot_send(phrase):
    author_acc = Account.objects.create_user(email="b-auth@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Текст.")

    peer_acc = Account.objects.create_user(email="peer@ex.com", password="password123")
    peer = Actor(kind="account", account=peer_acc)
    block_actor(author, target_account_id=peer_acc.id)

    with pytest.raises(SupportError, match="unavailable"):
        send_quiet_phrase(peer, story.id, "i_am_here")


@pytest.mark.django_db
def test_inactive_phrase_rejected(inactive_phrase):
    author_acc = Account.objects.create_user(email="c@ex.com", password="password123")
    story = publish_story(Actor(kind="account", account=author_acc), "Текст.")
    session = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=session)
    with pytest.raises(SupportError, match="not found"):
        send_quiet_phrase(visitor, story.id, "old")


@pytest.mark.django_db
def test_body_snapshot_survives_catalog_edit(phrase):
    author_acc = Account.objects.create_user(email="d@ex.com", password="password123")
    story = publish_story(Actor(kind="account", account=author_acc), "Текст.")
    session = AnonymousSession.objects.create()
    visitor = Actor(kind="anonymous", session=session)

    send_quiet_phrase(visitor, story.id, "i_am_here")
    phrase.text_ru = "Новый текст каталога"
    phrase.save(update_fields=["text_ru", "updated_at"])

    clouds = list_clouds_for_author(
        Actor(kind="account", account=author_acc), story.id
    )
    assert clouds[0].body == "Я рядом. Без слов."


@pytest.mark.django_db
def test_moderated_free_text_pending_then_approve():
    author_acc = Account.objects.create_user(email="ma@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Мне тяжело сегодня.")

    visitor = Actor(
        kind="anonymous",
        session=AnonymousSession.objects.create(pseudonym="гость"),
    )
    result = submit_moderated_cloud(visitor, story.id, "Держу пространство рядом.")
    assert result.created is True
    assert result.cloud.status == SupportCloudStatus.PENDING

    # Author must not see pending
    assert list_clouds_for_author(author, story.id) == []

    helper = Account.objects.create_user(
        email="helper@ex.com",
        password="password123",
        is_helper=True,
        helper_org="Тихая линия",
    )
    helper_actor = Actor(kind="account", account=helper)

    queue = list_pending_queue(helper_actor)
    assert len(queue) == 1
    assert queue[0].body == "Держу пространство рядом."

    approve_cloud(helper_actor, result.cloud.id)
    clouds = list_clouds_for_author(author, story.id)
    assert len(clouds) == 1
    assert clouds[0].body == "Держу пространство рядом."
    assert clouds[0].helper_badge == ""


@pytest.mark.django_db
def test_moderated_reject_not_visible():
    author_acc = Account.objects.create_user(email="mr@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Текст.")
    visitor = Actor(
        kind="anonymous", session=AnonymousSession.objects.create(pseudonym="v")
    )
    result = submit_moderated_cloud(visitor, story.id, "Спам или шум.")
    staff = Account.objects.create_user(
        email="staff@ex.com", password="password123", is_staff=True
    )
    reject_cloud(Actor(kind="account", account=staff), result.cloud.id)
    assert list_clouds_for_author(author, story.id) == []


@pytest.mark.django_db
def test_helper_free_text_delivers_with_badge():
    author_acc = Account.objects.create_user(email="ha@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "История.")

    helper = Account.objects.create_user(
        email="h2@ex.com",
        password="password123",
        default_pseudonym="волонтёр",
        is_helper=True,
        helper_org="НКО Забота",
    )
    helper_actor = Actor(kind="account", account=helper)
    result = submit_moderated_cloud(
        helper_actor, story.id, "Я рядом. Если нужно — можно молчать."
    )
    assert result.cloud.status == SupportCloudStatus.DELIVERED
    assert result.cloud.helper_badge == "Helper · НКО Забота"
    assert result.cloud.is_priority is True

    clouds = list_clouds_for_author(author, story.id)
    assert len(clouds) == 1
    assert clouds[0].helper_badge == "Helper · НКО Забота"
    assert clouds[0].is_priority is True


@pytest.mark.django_db
def test_non_helper_cannot_moderate():
    author_acc = Account.objects.create_user(email="nh@ex.com", password="password123")
    story = publish_story(Actor(kind="account", account=author_acc), "Текст.")
    visitor = Actor(
        kind="anonymous", session=AnonymousSession.objects.create()
    )
    result = submit_moderated_cloud(visitor, story.id, "Текст на модерацию.")
    stranger = Account.objects.create_user(email="s@ex.com", password="password123")
    with pytest.raises(SupportError, match="Helper"):
        list_pending_queue(Actor(kind="account", account=stranger))
    with pytest.raises(SupportError, match="Helper"):
        approve_cloud(Actor(kind="account", account=stranger), result.cloud.id)


@pytest.mark.django_db
def test_free_text_too_long():
    author_acc = Account.objects.create_user(email="tl@ex.com", password="password123")
    story = publish_story(Actor(kind="account", account=author_acc), "Текст.")
    visitor = Actor(
        kind="anonymous", session=AnonymousSession.objects.create()
    )
    with pytest.raises(SupportError, match="Too long"):
        submit_moderated_cloud(visitor, story.id, "x" * 300)


@pytest.mark.django_db
def test_quiet_phrase_http(phrase):
    from django.test import Client

    author_acc = Account.objects.create_user(
        email="cloud-api@ex.com", password="password123"
    )
    story = publish_story(Actor(kind="account", account=author_acc), "история")
    visitor = Account.objects.create_user(
        email="cloud-vis@ex.com", password="password123"
    )
    client = Client()
    catalog = client.get("/api/v1/quiet-phrases")
    assert catalog.status_code == 200
    assert any(p["key"] == "i_am_here" for p in catalog.json())
    client.force_login(visitor)
    sent = client.post(
        f"/api/v1/stories/{story.id}/clouds",
        data={"phrase_key": "i_am_here"},
        content_type="application/json",
    )
    assert sent.status_code == 200
    assert sent.json()["ok"] is True
    owner = Client()
    owner.force_login(author_acc)
    clouds = owner.get(f"/api/v1/stories/{story.id}/clouds")
    assert clouds.status_code == 200
    assert clouds.json()[0]["body"]


@pytest.mark.django_db
def test_one_cloud_on_post_and_one_on_comment(phrase):
    from apps.stories.services import add_comment
    from apps.support.services import my_phrase_keys_for

    author_acc = Account.objects.create_user(email="th@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    post = publish_story(author, "пост")
    comment = add_comment(author, post.id, "ещё мысль")
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())

    first = send_quiet_phrase(visitor, post.id, "i_am_here")
    assert first.created is True
    with pytest.raises(SupportError, match="one cloud"):
        send_quiet_phrase(visitor, comment.id, "i_am_here")
    again = send_quiet_phrase(visitor, post.id, "i_am_here")
    assert again.created is False
    assert SupportCloud.objects.filter(from_session=visitor.session).count() == 1
    assert first.cloud.story_id == post.id
    assert first.cloud.thread_root_id == post.id

    keys = my_phrase_keys_for(visitor, [post.id, comment.id])
    assert keys[post.id] == "i_am_here"
    assert comment.id not in keys
    stranger = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    assert my_phrase_keys_for(stranger, [post.id]) == {}


@pytest.mark.django_db
def test_one_cloud_on_comment_blocks_root(phrase):
    from apps.stories.services import add_comment

    author = Actor(
        kind="account",
        account=Account.objects.create_user(email="th2@ex.com", password="password123"),
    )
    post = publish_story(author, "пост")
    comment = add_comment(author, post.id, "ещё мысль")
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    sent = send_quiet_phrase(visitor, comment.id, "i_am_here")
    assert sent.cloud.story_id == comment.id
    assert sent.cloud.thread_root_id == post.id
    with pytest.raises(SupportError, match="one cloud"):
        send_quiet_phrase(visitor, post.id, "i_am_here")


@pytest.mark.django_db
def test_cloud_unread_and_mark_read(phrase):
    from apps.notifications.models import Notification
    from apps.stories.services import add_comment
    from apps.support.services import (
        cloud_gestures_for_roots,
        cloud_unread_for_roots,
        mark_clouds_read,
    )

    author_acc = Account.objects.create_user(email="ur@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    post = publish_story(author, "пост")
    comment = add_comment(author, post.id, "коммент")
    visitor = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    other = Actor(kind="anonymous", session=AnonymousSession.objects.create())
    post.refresh_from_db()
    before = post.last_activity_at

    send_quiet_phrase(visitor, post.id, "i_am_here")
    send_quiet_phrase(other, comment.id, "i_am_here")
    post.refresh_from_db()
    assert post.last_activity_at == before

    unread = cloud_unread_for_roots(author, [post])
    assert unread[post.id] == 2
    assert cloud_unread_for_roots(visitor, [post]) == {}
    assert cloud_gestures_for_roots(author, [post])[post.id] == "i_am_here"
    assert cloud_gestures_for_roots(visitor, [post]) == {}

    notifs = list(
        Notification.objects.filter(
            recipient_account=author_acc, kind="support_cloud", is_read=False
        )
    )
    assert len(notifs) == 2
    assert notifs[0].payload.get("post_id") == str(post.id)

    mark_clouds_read(author, post.id)
    post.refresh_from_db()
    assert post.clouds_last_read_at is not None
    assert cloud_unread_for_roots(author, [post])[post.id] == 0
    assert (
        Notification.objects.filter(
            recipient_account=author_acc, kind="support_cloud", is_read=False
        ).count()
        == 0
    )


@pytest.mark.django_db
def test_mark_read_http_and_feed_privacy(phrase):
    from django.test import Client

    from apps.stories.services import add_comment

    author_acc = Account.objects.create_user(
        email="feed-auth@ex.com", password="password123"
    )
    author = Actor(kind="account", account=author_acc)
    post = publish_story(author, "приватный бейдж")
    add_comment(author, post.id, "внутри")
    visitor = Account.objects.create_user(
        email="feed-vis@ex.com", password="password123"
    )
    vis = Client()
    vis.force_login(visitor)
    vis.post(
        f"/api/v1/stories/{post.id}/clouds",
        data={"phrase_key": "i_am_here"},
        content_type="application/json",
    )

    owner = Client()
    owner.force_login(author_acc)
    feed = owner.get("/api/v1/stories")
    mine = next(i for i in feed.json()["items"] if i["id"] == str(post.id))
    assert mine["cloud_unread"] >= 1
    assert mine["cloud_gesture"] == "i_am_here"
    assert mine["received_clouds"] == []

    guest = Client()
    guest.force_login(visitor)
    other = next(
        i for i in guest.get("/api/v1/stories").json()["items"] if i["id"] == str(post.id)
    )
    assert other["cloud_unread"] == 0
    assert other["cloud_gesture"] == ""
    assert other["my_phrase_key"] == "i_am_here"
    assert other["received_clouds"] == []

    thread = guest.get(f"/api/v1/stories/{post.id}/thread").json()["items"]
    assert thread[0]["my_phrase_key"] == "i_am_here"
    assert thread[0]["received_clouds"] == []

    author_thread = owner.get(f"/api/v1/stories/{post.id}/thread").json()["items"]
    assert author_thread[0]["received_clouds"]
    assert author_thread[0]["received_clouds"][0]["phrase_key"] == "i_am_here"

    read = owner.post(f"/api/v1/stories/{post.id}/clouds/mark-read")
    assert read.status_code == 200
    after = next(
        i for i in owner.get("/api/v1/stories").json()["items"] if i["id"] == str(post.id)
    )
    assert after["cloud_unread"] == 0
    assert after["cloud_gesture"] == ""

    forbidden = vis.post(f"/api/v1/stories/{post.id}/clouds/mark-read")
    assert forbidden.status_code == 403


@pytest.mark.django_db
def test_cloud_decisions_are_audited():
    """Approve/reject must leave a ModerationAction row (B3 fix)."""
    author = Actor(
        kind="account",
        account=Account.objects.create_user(email="aud-a@ex.com", password="password123"),
    )
    story = publish_story(author, "История для аудита.")
    visitor = Actor(
        kind="anonymous", session=AnonymousSession.objects.create(pseudonym="aud")
    )
    helper = Actor(
        kind="account",
        account=Account.objects.create_user(
            email="aud-h@ex.com", password="password123", is_helper=True
        ),
    )

    first = submit_moderated_cloud(visitor, story.id, "Первое облако.")
    approve_cloud(helper, first.cloud.id)

    other_story = publish_story(author, "Вторая история.")
    second = submit_moderated_cloud(visitor, other_story.id, "Второе облако.")
    reject_cloud(helper, second.cloud.id)

    rows = ModerationAction.objects.filter(cloud__in=[first.cloud.id, second.cloud.id])
    assert rows.count() == 2
    assert set(rows.values_list("action", flat=True)) == {
        ModerationActionKind.CLOUD_APPROVED,
        ModerationActionKind.CLOUD_REJECTED,
    }
    assert all(row.actor_id == helper.account.id for row in rows)

