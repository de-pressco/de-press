from __future__ import annotations

import pytest
from django.test import Client

from apps.identity.models import Account
from apps.identity.services import Actor, DutyError, set_helper_duty


@pytest.mark.django_db
def test_default_helper_is_off_duty():
    acc = Account.objects.create_user(
        email="duty-def@ex.com", password="password123", is_helper=True
    )
    assert acc.is_on_duty is False


@pytest.mark.django_db
def test_set_helper_duty_toggles():
    acc = Account.objects.create_user(
        email="duty-tog@ex.com", password="password123", is_helper=True
    )
    actor = Actor(kind="account", account=acc)
    set_helper_duty(actor, True)
    acc.refresh_from_db()
    assert acc.is_on_duty is True
    set_helper_duty(actor, False)
    acc.refresh_from_db()
    assert acc.is_on_duty is False


@pytest.mark.django_db
def test_non_helper_cannot_go_on_duty():
    acc = Account.objects.create_user(
        email="duty-plain@ex.com", password="password123"
    )
    with pytest.raises(DutyError):
        set_helper_duty(Actor(kind="account", account=acc), True)


@pytest.mark.django_db
def test_staff_account_is_a_helper_by_invariant():
    """Owner rule 2026-10-27: the moderator IS a Helper, so staff can never be
    a half-role (it used to get 403 from duty while /console/ let it in)."""
    staff = Account.objects.create_user(
        email="duty-staff@ex.com", password="password123", is_staff=True
    )
    assert staff.is_helper is True
    staff.refresh_from_db()
    assert staff.is_helper is True


@pytest.mark.django_db
def test_staff_update_fields_never_drops_the_helper_flag():
    acc = Account.objects.create_user(
        email="duty-staff-upd@ex.com", password="password123", is_staff=True
    )
    acc.is_helper = False  # stale admin form payload
    acc.is_active = False
    acc.save(update_fields=["is_active"])
    acc.refresh_from_db()
    assert acc.is_helper is True
    assert acc.is_active is False


@pytest.mark.django_db
def test_plain_account_stays_non_helper():
    plain = Account.objects.create_user(
        email="duty-plain2@ex.com", password="password123"
    )
    assert plain.is_helper is False


@pytest.mark.django_db
def test_created_superuser_is_a_helper():
    """`createsuperuser` goes through the same invariant."""
    su = Account.objects.create_superuser(
        email="duty-su@ex.com", password="password123"
    )
    assert su.is_staff is True
    assert su.is_helper is True


@pytest.mark.django_db
def test_staff_can_go_on_duty():
    staff = Account.objects.create_user(
        email="duty-staff-on@ex.com", password="password123", is_staff=True
    )
    set_helper_duty(Actor(kind="account", account=staff), True)
    staff.refresh_from_db()
    assert staff.is_on_duty is True


@pytest.mark.django_db
def test_staff_goes_on_duty_over_http():
    """The console shift card uses these exact endpoints (moderator = Helper)."""
    staff = Account.objects.create_user(
        email="duty-staff-http@ex.com", password="password123", is_staff=True
    )
    client = Client()
    client.force_login(staff)

    me = client.get("/api/v1/me").json()
    assert me["is_helper"] is True
    assert me["is_on_duty"] is False

    on = client.post(
        "/api/v1/me/helper-duty",
        data={"on": True},
        content_type="application/json",
    )
    assert on.status_code == 200
    assert on.json()["is_on_duty"] is True
    assert client.get("/api/v1/me").json()["is_on_duty"] is True


@pytest.mark.django_db
def test_http_helper_duty_and_me():
    helper = Account.objects.create_user(
        email="duty-http@ex.com", password="password123", is_helper=True
    )
    client = Client()
    client.force_login(helper)
    me = client.get("/api/v1/me").json()
    assert me["is_helper"] is True
    assert me["is_on_duty"] is False

    on = client.post(
        "/api/v1/me/helper-duty",
        data={"on": True},
        content_type="application/json",
    )
    assert on.status_code == 200
    assert on.json()["is_on_duty"] is True
    assert client.get("/api/v1/me").json()["is_on_duty"] is True

    off = client.post(
        "/api/v1/me/helper-duty",
        data={"on": False},
        content_type="application/json",
    )
    assert off.status_code == 200
    assert off.json()["is_on_duty"] is False


@pytest.mark.django_db
def test_http_duty_forbidden_for_non_helper_and_anon():
    plain = Account.objects.create_user(
        email="duty-noh@ex.com", password="password123"
    )
    client = Client()
    client.force_login(plain)
    res = client.post(
        "/api/v1/me/helper-duty",
        data={"on": True},
        content_type="application/json",
    )
    assert res.status_code == 403

    anon = Client()
    res_anon = anon.post(
        "/api/v1/me/helper-duty",
        data={"on": True},
        content_type="application/json",
    )
    assert res_anon.status_code == 403
