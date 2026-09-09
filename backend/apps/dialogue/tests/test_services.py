from __future__ import annotations

import pytest

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.dialogue.models import (
    DialogueRequestStatus,
    DialogueSource,
    DialogueStatus,
    MessageKind,
)
from apps.dialogue.services import (
    DialogueError,
    accept_request,
    create_request,
    decline_request,
    list_messages,
    send_message,
    send_voice_message,
    start_author_outreach,
    translate_message,
)
from apps.empathy.services import (
    hearer_ref_for_empathy,
    list_hearers_for_author,
    offer_empathy,
    set_outreach_consent,
)
from apps.empathy.models import SilentEmpathy
from apps.identity.models import Account, AnonymousSession
from apps.identity.services import Actor
from apps.stories.services import publish_story


@pytest.mark.django_db
def test_dialogue_request_accept_message():
    author_acc = Account.objects.create_user(email="author@ex.com", password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Мне нужно, чтобы меня услышали.", topic="loneliness")

    peer_sess = AnonymousSession.objects.create(pseudonym="слушатель")
    peer = Actor(kind="anonymous", session=peer_sess)

    from apps.dialogue.tests.helpers import create_reviewed_request

    req = create_reviewed_request(peer, story, intent="listen", note="я рядом")
    assert req.status == DialogueRequestStatus.PENDING

    dialogue = accept_request(author, req.id)
    assert dialogue.status == DialogueStatus.OPEN
    assert dialogue.source == DialogueSource.REQUEST
    # Accept locks only DialogueRequest (of=self): nullable from_* joins
    # cannot take FOR UPDATE on Postgres.

    msgs = list_messages(author, dialogue.id)
    assert len(msgs) >= 1
    assert "rules" in msgs[0].body

    send_message(author, dialogue.id, "Спасибо, что написал.")
    send_message(peer, dialogue.id, "Я просто здесь.")
    assert len(list_messages(peer, dialogue.id)) >= 3
    from apps.notifications.models import Notification

    assert (
        Notification.objects.filter(
            kind="message", recipient_account=author_acc
        ).count()
        == 0
    )


@pytest.mark.django_db
def test_dialogue_request_once_per_user_per_story():
    author = Actor(
        kind="account",
        account=Account.objects.create_user(
            email="once-a@ex.com", password="password123"
        ),
    )
    story = publish_story(author, "Один разговор на историю.", topic="loneliness")

    peer = Actor(
        kind="account",
        account=Account.objects.create_user(
            email="once-p@ex.com", password="password123"
        ),
    )
    req = create_request(peer, story.id, intent="listen")

    # While pending…
    with pytest.raises(DialogueError, match="Request already sent"):
        create_request(peer, story.id, intent="share")

    # …after the author accepted it…
    accept_request(author, req.id)
    with pytest.raises(DialogueError, match="Request already sent"):
        create_request(peer, story.id, intent="share")

    # …and after a decline: one request per user per thread, period.
    other = Actor(
        kind="anonymous",
        session=AnonymousSession.objects.create(pseudonym="второй"),
    )
    req2 = create_request(other, story.id, intent="listen")
    decline_request(author, req2.id)
    with pytest.raises(DialogueError, match="Request already sent"):
        create_request(other, story.id, intent="mutual")


@pytest.mark.django_db
def test_author_outreach_one():
    author_acc = Account.objects.create_user(
        email="out-auth@ex.com", password="password123"
    )
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Мне тихо, но хочется тепла.")

    peer_sess = AnonymousSession.objects.create(pseudonym="hearer")
    peer = Actor(kind="anonymous", session=peer_sess)
    offer_empathy(peer, story.id)

    hearers = list_hearers_for_author(author, story.id)
    ref = hearers[0].hearer_ref

    result = start_author_outreach(
        author, story.id, mode="one", hearer_refs=[ref], intent="listen"
    )
    assert result.created_count == 1
    d = result.dialogues[0]
    assert d.source == DialogueSource.AUTHOR_OUTREACH
    assert d.peer_session_id == peer_sess.id

    msgs = list_messages(peer, d.id)
    bodies = " ".join(m.body for m in msgs)
    assert "rules" in bodies
    assert "I hear you" in bodies or "wrote to you" in bodies

    # Reuse open dialogue
    again = start_author_outreach(
        author, story.id, mode="one", hearer_refs=[ref]
    )
    assert again.created_count == 0
    assert again.reused_count == 1
    assert again.dialogues[0].id == d.id


@pytest.mark.django_db
def test_author_outreach_random_and_opt_out():
    author_acc = Account.objects.create_user(
        email="rand-auth@ex.com", password="password123"
    )
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "История.")

    p1 = Actor(
        kind="anonymous", session=AnonymousSession.objects.create(pseudonym="a")
    )
    p2 = Actor(
        kind="anonymous", session=AnonymousSession.objects.create(pseudonym="b")
    )
    offer_empathy(p1, story.id)
    offer_empathy(p2, story.id)
    set_outreach_consent(p2, story.id, opt_in=False)

    result = start_author_outreach(author, story.id, mode="random")
    assert result.created_count == 1
    # only p1 is eligible
    assert result.dialogues[0].peer_session_id == p1.session.id

    # opt-out peer cannot be targeted
    row = SilentEmpathy.objects.get(story=story, from_session=p2.session)
    ref = hearer_ref_for_empathy(row)
    with pytest.raises(DialogueError, match="disabled outreach"):
        start_author_outreach(author, story.id, mode="one", hearer_refs=[ref])


@pytest.mark.django_db
def test_author_outreach_many():
    author_acc = Account.objects.create_user(
        email="many-auth@ex.com", password="password123"
    )
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "История many.")

    refs = []
    for i in range(3):
        peer = Actor(
            kind="anonymous",
            session=AnonymousSession.objects.create(pseudonym=f"h{i}"),
        )
        offer_empathy(peer, story.id)
        refs.append(list_hearers_for_author(author, story.id)[0].hearer_ref)

    # re-fetch all refs after all offers
    refs = [h.hearer_ref for h in list_hearers_for_author(author, story.id)]
    result = start_author_outreach(
        author, story.id, mode="many", hearer_refs=refs
    )
    assert result.created_count == 3
    assert len(result.dialogues) == 3


@pytest.mark.django_db
def test_non_author_cannot_outreach():
    author_acc = Account.objects.create_user(
        email="own@ex.com", password="password123"
    )
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Текст.")
    peer = Actor(
        kind="anonymous", session=AnonymousSession.objects.create(pseudonym="x")
    )
    offer_empathy(peer, story.id)
    with pytest.raises(DialogueError, match="author"):
        start_author_outreach(peer, story.id, mode="random")


@pytest.mark.django_db
def test_voice_message_and_translate(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    settings.TRANSLATOR_BASE_URL = ""
    settings.AI_API_KEY = ""
    author_acc = Account.objects.create_user(
        email="voice-a@ex.com", password="password123"
    )
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Нужно услышать.")
    peer_sess = AnonymousSession.objects.create(pseudonym="слушатель")
    peer = Actor(kind="anonymous", session=peer_sess)
    from apps.dialogue.tests.helpers import create_reviewed_request

    req = create_reviewed_request(peer, story, intent="listen")
    dialogue = accept_request(author, req.id)

    audio = SimpleUploadedFile(
        "note.webm",
        b"\x1a\x45\xdf\xa3fake-webm-bytes",
        content_type="audio/webm",
    )
    msg = send_voice_message(
        author,
        dialogue.id,
        uploaded_file=audio,
        duration_ms=1500,
        source_lang="ru",
    )
    assert msg.kind == MessageKind.VOICE
    assert msg.audio
    assert msg.transcript == ""  # voice transcription is removed
    assert msg.body == "[voice note]"

    with pytest.raises(DialogueError, match="Nothing to translate"):
        translate_message(peer, msg.id, target_lang="en")

    text = send_message(peer, dialogue.id, "Я рядом.", source_lang="ru")
    with pytest.raises(DialogueError, match="unavailable"):
        translate_message(author, text.id, target_lang="en")


def _open_pair(email: str):
    author_acc = Account.objects.create_user(email=email, password="password123")
    author = Actor(kind="account", account=author_acc)
    story = publish_story(author, "Монолог для кружочка.")
    peer_sess = AnonymousSession.objects.create(pseudonym="p")
    peer = Actor(kind="anonymous", session=peer_sess)
    from apps.dialogue.tests.helpers import create_reviewed_request

    dialogue = accept_request(
        author, create_reviewed_request(peer, story, intent="listen").id
    )
    return author, peer, dialogue


@pytest.mark.django_db
def test_translate_does_not_cache_offline_stub(settings):
    settings.TRANSLATOR_BASE_URL = ""
    settings.AI_API_KEY = ""
    author, peer, dialogue = _open_pair("stub-cache@ex.com")
    text = send_message(peer, dialogue.id, "How do you do?", source_lang="en")
    with pytest.raises(DialogueError, match="unavailable"):
        translate_message(author, text.id, target_lang="ru")
    text.refresh_from_db()
    assert not (text.translations or {}).get("ru")


@pytest.mark.django_db
def test_translate_replaces_offline_stub(monkeypatch):
    author, peer, dialogue = _open_pair("stub-replace@ex.com")
    text = send_message(peer, dialogue.id, "How do you do?", source_lang="en")
    text.translations = {"ru": "[офлайн ru] How do you do?"}
    text.save(update_fields=["translations"])

    class _Live:
        def translate(self, t, *, target_lang, source_lang=""):
            return "Как дела?"

    monkeypatch.setattr("apps.dialogue.speech.get_translator", lambda: _Live())
    out = translate_message(author, text.id, target_lang="ru")
    assert out.translations["ru"] == "Как дела?"


@pytest.mark.django_db
def test_message_kind_circle_and_display_text(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    from apps.dialogue.models import Message, MessageKind

    author, _peer, dialogue = _open_pair("c-m@ex.com")
    msg = Message(dialogue=dialogue, kind=MessageKind.CIRCLE, body="[кружочек]", ephemeral=True)
    msg.save()
    msg.video.save("c.webm", SimpleUploadedFile("c.webm", b"abcd", content_type="video/webm"), save=True)
    assert MessageKind.CIRCLE == "circle"
    assert msg.ephemeral is True
    assert msg.display_text == "[кружочек]"
    msg.video.delete(save=False)
    msg.video = None
    assert "delet" in msg.display_text.lower()


@pytest.mark.django_db
def test_send_circle_message_ok(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    from apps.dialogue.services import send_circle_message

    author, _peer, dialogue = _open_pair("circ-ok@ex.com")
    video = SimpleUploadedFile(
        "circle.webm",
        b"\x1a\x45\xdf\xa3fake-webm-bytes",
        content_type="video/webm",
    )
    msg = send_circle_message(
        author, dialogue.id, uploaded_file=video, duration_ms=2500, source_lang="ru"
    )
    assert msg.kind == MessageKind.CIRCLE
    assert msg.ephemeral is True
    assert msg.video
    assert msg.duration_ms == 2500
    assert msg.transcript == ""


@pytest.mark.django_db
def test_send_circle_rejects_too_large_and_too_long(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    from apps.dialogue.services import (
        CIRCLE_MAX_BYTES,
        DialogueError,
        send_circle_message,
    )

    author, _peer, dialogue = _open_pair("circ-lim@ex.com")
    big = SimpleUploadedFile(
        "c.webm", b"x" * (CIRCLE_MAX_BYTES + 1), content_type="video/webm"
    )
    with pytest.raises(DialogueError, match="too large"):
        send_circle_message(author, dialogue.id, uploaded_file=big, duration_ms=1000)
    small = SimpleUploadedFile("c.webm", b"xxxx", content_type="video/webm")
    with pytest.raises(DialogueError, match="too long"):
        send_circle_message(
            author, dialogue.id, uploaded_file=small, duration_ms=61_000
        )


@pytest.mark.django_db
def test_close_dialogue_deletes_circle_video_keeps_voice(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    from pathlib import Path

    from apps.dialogue.services import close_dialogue, send_circle_message

    author, _peer, dialogue = _open_pair("purge@ex.com")
    from apps.identity.models import VoiceRetention

    author.account.voice_retention = VoiceRetention.KEEP
    author.account.save(update_fields=["voice_retention"])
    circle = send_circle_message(
        author,
        dialogue.id,
        uploaded_file=SimpleUploadedFile("c.webm", b"cccc", content_type="video/webm"),
        duration_ms=800,
    )
    voice = send_voice_message(
        author,
        dialogue.id,
        uploaded_file=SimpleUploadedFile("n.webm", b"vvvv", content_type="audio/webm"),
        duration_ms=800,
    )
    circle_path = Path(circle.video.path)
    voice_path = Path(voice.audio.path)
    assert circle_path.exists()
    close_dialogue(author, dialogue.id)
    circle.refresh_from_db()
    voice.refresh_from_db()
    assert not circle_path.exists()
    assert not circle.video
    assert voice_path.exists()
    assert voice.kind == MessageKind.VOICE


@pytest.mark.django_db
def test_dialogue_peer_label_and_last_preview():
    from apps.dialogue.services import dialogue_last_preview, dialogue_peer_label

    author, peer, dialogue = _open_pair("preview@ex.com")
    send_message(peer, dialogue.id, "Я просто рядом с тобой.")
    assert dialogue_peer_label(dialogue, author) == "p"
    assert "рядом" in dialogue_last_preview(dialogue)


@pytest.mark.django_db
def test_reopen_only_closer_and_delete_hides_for_me():
    from apps.dialogue.services import (
        close_dialogue,
        delete_dialogue_for_me,
        list_my_dialogues,
        reopen_dialogue,
    )

    author, peer, dialogue = _open_pair("reopen@ex.com")
    close_dialogue(author, dialogue.id)
    with pytest.raises(DialogueError, match="who closed it"):
        reopen_dialogue(peer, dialogue.id)
    opened = reopen_dialogue(author, dialogue.id)
    assert opened.status == DialogueStatus.OPEN

    delete_dialogue_for_me(author, dialogue.id)
    mine = list_my_dialogues(author)
    theirs = list_my_dialogues(peer)
    assert all(d.id != dialogue.id for d in mine)
    assert any(d.id == dialogue.id for d in theirs)


@pytest.mark.django_db
def test_delete_blocks_reopen_and_reuse():
    from apps.dialogue.services import (
        close_dialogue,
        delete_dialogue_for_me,
        dialogue_flags,
        reopen_dialogue,
        send_message,
    )

    author, peer, dialogue = _open_pair("tombstone@ex.com")
    close_dialogue(peer, dialogue.id)
    dialogue.refresh_from_db()
    assert dialogue_flags(dialogue, peer)["can_reopen"] is True
    delete_dialogue_for_me(author, dialogue.id)
    dialogue.refresh_from_db()
    assert dialogue_flags(dialogue, peer)["can_reopen"] is False
    with pytest.raises(DialogueError, match="deleted"):
        reopen_dialogue(peer, dialogue.id)
    with pytest.raises(DialogueError):
        send_message(peer, dialogue.id, "ещё раз")


@pytest.mark.django_db
def test_reply_edit_delete_hide_pin_forward():
    from apps.dialogue.models import MessageHide
    from apps.dialogue.realtime import serialize_message
    from apps.dialogue.services import (
        delete_message_for_everyone,
        edit_message,
        forward_message,
        hide_message_for_me,
        list_messages,
        pin_message,
        unpin_message,
    )

    author, peer, d1 = _open_pair("acts-a@ex.com")
    author2, peer2, d2 = _open_pair("acts-b@ex.com")
    # reuse author as participant of d2? simpler: second dialogue between same pair
    # d2 is a different pair; forward needs author in target. Use outreach-like: just
    # send in d1 and create second dialogue for author+peer via another story.
    from apps.stories.services import publish_story
    from apps.dialogue.services import accept_request
    from apps.dialogue.tests.helpers import create_reviewed_request

    story2 = publish_story(author, "Вторая мысль.")
    d2 = accept_request(
        author, create_reviewed_request(peer, story2, intent="listen").id
    )

    original = send_message(author, d1.id, "Привет, это оригинал.")
    reply = send_message(peer, d1.id, "Ответ тебе.", reply_to_id=original.id)
    payload = serialize_message(reply, viewer=peer)
    assert payload["reply_to"]["id"] == str(original.id)

    edited = edit_message(author, original.id, "Привет, правка.")
    assert "правка" in edited.body
    assert edited.edited_at
    with pytest.raises(DialogueError):
        edit_message(peer, original.id, "хак")

    pin_message(author, original.id)
    d1.refresh_from_db()
    assert d1.pinned_message_id == original.id
    unpin_message(author, d1.id)
    d1.refresh_from_db()
    assert d1.pinned_message_id is None

    forwarded = forward_message(author, original.id, d2.id)
    assert forwarded.forwarded is True
    assert forwarded.dialogue_id == d2.id

    hide_message_for_me(peer, original.id)
    peer_list = list_messages(peer, d1.id)
    author_list = list_messages(author, d1.id)
    assert all(m.id != original.id for m in peer_list)
    assert any(m.id == original.id for m in author_list)

    other = send_message(author, d1.id, "Скоро удалю.")
    delete_message_for_everyone(author, other.id)
    stub = [m for m in list_messages(peer, d1.id) if m.id == other.id][0]
    assert stub.deleted_at
    assert "deleted" in stub.display_text


@pytest.mark.django_db
def test_peer_can_delete_others_message_for_everyone():
    from apps.dialogue.services import delete_message_for_everyone

    author, peer, dialogue = _open_pair("del-peer@ex.com")
    msg = send_message(author, dialogue.id, "Это можно стереть у обоих.")
    delete_message_for_everyone(peer, msg.id)
    for who in (author, peer):
        stub = [m for m in list_messages(who, dialogue.id) if m.id == msg.id][0]
        assert stub.deleted_at
        assert "deleted" in stub.display_text


@pytest.mark.django_db
def test_delete_dialogue_for_everyone_hides_both_and_wipes():
    from apps.dialogue.models import Message
    from apps.dialogue.services import (
        delete_dialogue_for_everyone,
        list_my_dialogues,
    )
    from apps.notifications.models import Notification

    author, peer, dialogue = _open_pair("del-all@ex.com")
    live = send_message(author, dialogue.id, "Сотрём весь чат.")
    delete_dialogue_for_everyone(author, dialogue.id)

    assert all(d.id != dialogue.id for d in list_my_dialogues(author))
    assert all(d.id != dialogue.id for d in list_my_dialogues(peer))
    with pytest.raises(DialogueError):
        list_messages(peer, dialogue.id)
    live.refresh_from_db()
    assert live.deleted_at
    assert live.body == ""
    assert Notification.objects.filter(
        kind="dialogue_deleted",
        recipient_session=peer.session,
        payload__dialogue_id=str(dialogue.id),
    ).exists()
    assert Message.objects.filter(pk=live.pk).exists()


@pytest.mark.django_db
def test_block_and_unblock_anonymous_peer():
    from apps.moderation.blocks import (
        block_peer_in_dialogue,
        has_blocked,
        unblock_peer_in_dialogue,
    )

    author, peer, dialogue = _open_pair("block-anon@ex.com")
    result = block_peer_in_dialogue(author, dialogue.id)
    assert result.created is True
    assert has_blocked(author, peer) is True
    removed = unblock_peer_in_dialogue(author, dialogue.id)
    assert removed >= 1
    assert has_blocked(author, peer) is False


@pytest.mark.django_db
def test_close_purges_voice_only_for_delete_on_close_sender(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    from pathlib import Path

    from apps.dialogue.services import close_dialogue
    from apps.identity.models import VoiceRetention

    author, peer, dialogue = _open_pair("vr-purge@ex.com")
    author.account.voice_retention = VoiceRetention.DELETE_ON_CLOSE
    author.account.save(update_fields=["voice_retention"])
    peer.session.voice_retention = VoiceRetention.KEEP
    peer.session.save(update_fields=["voice_retention"])

    gone = send_voice_message(
        author,
        dialogue.id,
        uploaded_file=SimpleUploadedFile("a.webm", b"aaaa", content_type="audio/webm"),
        duration_ms=800,
    )
    kept = send_voice_message(
        peer,
        dialogue.id,
        uploaded_file=SimpleUploadedFile("b.webm", b"bbbb", content_type="audio/webm"),
        duration_ms=800,
    )
    gone_path = Path(gone.audio.path)
    kept_path = Path(kept.audio.path)
    close_dialogue(author, dialogue.id)
    gone.refresh_from_db()
    kept.refresh_from_db()
    assert not gone_path.exists()
    assert not gone.audio
    assert kept_path.exists()
    assert kept.audio


@pytest.mark.django_db
def test_chat_list_prefs_and_clear_history():
    from apps.dialogue.services import (
        clear_history,
        list_my_dialogues,
        mark_dialogue_read,
        mark_dialogue_unread,
        mute_dialogue,
        pin_chat,
        unread_count_for,
        unmute_dialogue,
        unpin_chat,
    )
    from apps.notifications.models import Notification

    author, peer, d = _open_pair("prefs@ex.com")
    send_message(peer, d.id, "привет")
    assert unread_count_for(d, author) >= 1

    pin_chat(author, d.id)
    mute_dialogue(author, d.id)
    mark_dialogue_unread(author, d.id)
    d.refresh_from_db()
    mine = list_my_dialogues(author)
    assert mine[0].id == d.id
    assert unread_count_for(d, author) >= 1

    mark_dialogue_read(author, d.id)
    d.refresh_from_db()
    assert unread_count_for(d, author) == 0

    before = Notification.objects.filter(
        kind="message", recipient_account=author.account
    ).count()
    send_message(peer, d.id, "после mute")
    after = Notification.objects.filter(
        kind="message", recipient_account=author.account
    ).count()
    assert after == before

    unmute_dialogue(author, d.id)
    unpin_chat(author, d.id)

    clear_history(author, d.id, scope="me")
    assert list_messages(author, d.id) == []
    assert len(list_messages(peer, d.id)) >= 1

    send_message(peer, d.id, "ещё")
    clear_history(author, d.id, scope="everyone")
    assert list_messages(author, d.id) == []
    assert list_messages(peer, d.id) == []
