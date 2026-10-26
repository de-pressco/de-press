"""Therapy contour tests (ADR 0022): statuses only, no money handling."""

from __future__ import annotations

import pytest
from django.test import Client

from apps.dialogue.models import Dialogue, DialogueSource, DialogueStatus
from apps.identity.models import AnonymousSession
from apps.identity.services import Actor
from apps.therapy.models import (
    TherapySession,
    TherapySessionStatus,
    TherapistProfile,
)
from apps.therapy.services import (
    TherapyError,
    claim_invite,
    client_label,
    complete_session,
    confirm_payment,
    create_session,
    decline_session,
    mark_i_paid,
    new_invite_token,
)

SOL_ADDR = "4Nd1mBQtrMJVYDfZUqTbGhFt9Ym7EFdkcpMtmN43mh9x"  # valid base58 shape


def make_profile(email="ther@ex.com", token=None, **kw) -> TherapistProfile:
    from django.contrib.auth import get_user_model

    Account = get_user_model()
    account = Account.objects.create_user(email=email, password="password123")
    profile = TherapistProfile.objects.create(
        account=account,
        invite_token=token or new_invite_token(),
        pseudonym=kw.pop("pseudonym", "Д-р Тихий"),
        approach=kw.pop("approach", "CBT, мягкий темп"),
        languages=kw.pop("languages", "ru,en"),
        rate_sol=kw.pop("rate_sol", 0.05),
        solana_address=kw.pop("solana_address", SOL_ADDR),
        is_active=kw.pop("is_active", True),
        **kw,
    )
    return profile


def anon_actor() -> Actor:
    return Actor(kind="anonymous", session=AnonymousSession.objects.create(pseudonym="клиент"))


@pytest.mark.django_db
def test_invite_claim_flow():
    token = new_invite_token()
    unclaimed = TherapistProfile.objects.create(
        pseudonym="Инвайт", invite_token=token
    )
    from django.contrib.auth import get_user_model

    Account = get_user_model()
    account = Account.objects.create_user(email="claim@ex.com", password="password123")
    claimed = claim_invite(Actor(kind="account", account=account), token)
    assert claimed.pk == unclaimed.pk
    assert claimed.is_active is True
    assert claimed.account_id == account.id
    with pytest.raises(TherapyError):
        claim_invite(Actor(kind="account", account=account), token)
    with pytest.raises(TherapyError):
        claim_invite(anon_actor(), token)
    with pytest.raises(TherapyError):
        claim_invite(Actor(kind="account", account=account), "nope")


@pytest.mark.django_db
def test_create_session_validations():
    profile = make_profile()
    client = anon_actor()

    st = create_session(client, str(profile.id), note="хочется поговорить")
    assert st.status == TherapySessionStatus.AWAITING_PAYMENT
    assert float(st.price_sol) == float(profile.rate_sol)
    assert st.client_session_id is not None

    with pytest.raises(TherapyError):  # one open session per client+therapist
        create_session(client, str(profile.id))

    with pytest.raises(TherapyError):  # unknown therapist
        create_session(client, "00000000-0000-0000-0000-000000000001")

    inactive = make_profile(email="off@ex.com", is_active=False)
    with pytest.raises(TherapyError):
        create_session(anon_actor(), str(inactive.id))

    noaddr = make_profile(email="noaddr@ex.com", solana_address="")
    with pytest.raises(TherapyError):
        create_session(anon_actor(), str(noaddr.id))

    with pytest.raises(TherapyError):  # therapist cannot book themselves
        create_session(
            Actor(kind="account", account=profile.account), str(profile.id)
        )


@pytest.mark.django_db
def test_full_status_flow_and_dialogue():
    profile = make_profile()
    st = create_session(anon_actor(), str(profile.id))
    sid = str(st.id)

    therapist = Actor(kind="account", account=profile.account)
    client = Actor(kind="anonymous", session=st.client_session)

    with pytest.raises(TherapyError):  # therapist cannot mark i-paid
        mark_i_paid(therapist, sid)
    with pytest.raises(TherapyError):  # not paid yet
        confirm_payment(therapist, sid)

    st = mark_i_paid(client, sid)
    assert st.status == TherapySessionStatus.PAYMENT_CLAIMED

    with pytest.raises(TherapyError):  # not the therapist
        confirm_payment(Actor(kind="anonymous", session=st.client_session), sid)

    st = confirm_payment(therapist, sid)
    assert st.status == TherapySessionStatus.PAID
    assert st.dialogue is not None
    assert st.dialogue.status == DialogueStatus.OPEN
    assert st.dialogue.source == DialogueSource.THERAPY
    assert st.dialogue.author_account_id == profile.account_id
    assert st.dialogue.peer_session_id == st.client_session_id

    # Idempotent re-confirm keeps the same dialogue
    again = confirm_payment(therapist, sid)
    assert again.dialogue_id == st.dialogue_id

    st = complete_session(therapist, sid)
    assert st.status == TherapySessionStatus.DONE
    with pytest.raises(TherapyError):
        complete_session(therapist, sid)


@pytest.mark.django_db
def test_decline_from_awaiting():
    profile = make_profile()
    st = create_session(anon_actor(), str(profile.id))
    st = decline_session(
        Actor(kind="account", account=profile.account), str(st.id)
    )
    assert st.status == TherapySessionStatus.DECLINED
    with pytest.raises(TherapyError):
        decline_session(
            Actor(kind="account", account=profile.account), str(st.id)
        )


@pytest.mark.django_db
def test_client_label_pseudonymous():
    profile = make_profile()
    st = create_session(anon_actor(), str(profile.id))
    assert client_label(st) == "клиент"  # the visitor pseudonym, never an email
