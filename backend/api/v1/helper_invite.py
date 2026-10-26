from __future__ import annotations

from ninja import Router, Schema
from ninja.errors import HttpError

from apps.identity.invites import (
    InviteError,
    accept_helper_invite,
    create_helper_invite,
    get_helper_invite,
    list_my_invites,
    revoke_helper_invite,
)
from apps.identity.services import require_actor

router = Router(tags=["helper-invite"])


class CreateInviteIn(Schema):
    org: str = ""
    ttl_hours: int = 168


class InviteOut(Schema):
    token: str
    org: str
    expires_at: str
    used: bool


class AcceptIn(Schema):
    pledge: bool = False


class AcceptOut(Schema):
    ok: bool
    is_helper: bool
    helper_org: str
    message: str


class RevokeOut(Schema):
    ok: bool


def _invite_out(inv) -> InviteOut:
    return InviteOut(
        token=inv.token,
        org=inv.org,
        expires_at=inv.expires_at.isoformat(),
        used=inv.used_at is not None,
    )


@router.post("/helper-invites", response=InviteOut)
def post_invite(request, payload: CreateInviteIn):
    actor = require_actor(request)
    try:
        inv = create_helper_invite(
            actor, org=payload.org, ttl_hours=payload.ttl_hours
        )
    except InviteError as exc:
        msg = str(exc)
        code = 403 if "Helper" in msg or "staff" in msg else 400
        raise HttpError(code, msg) from exc
    return _invite_out(inv)


@router.get("/helper-invites", response=list[InviteOut])
def list_invites(request):
    actor = require_actor(request)
    try:
        rows = list_my_invites(actor)
    except InviteError as exc:
        raise HttpError(403, str(exc)) from exc
    return [_invite_out(inv) for inv in rows]


@router.get("/helper-invites/{token}", response=InviteOut)
def get_invite(request, token: str):
    try:
        inv = get_helper_invite(token)
    except InviteError as exc:
        raise HttpError(404, str(exc)) from exc
    return _invite_out(inv)


@router.delete("/helper-invites/{token}", response=RevokeOut)
def delete_invite(request, token: str):
    actor = require_actor(request)
    try:
        revoke_helper_invite(actor, token)
    except InviteError as exc:
        msg = str(exc)
        code = 404 if "not found" in msg.lower() else (403 if "Only" in msg else 400)
        raise HttpError(code, msg) from exc
    return RevokeOut(ok=True)


@router.post("/helper-invites/{token}/accept", response=AcceptOut)
def post_accept(request, token: str, payload: AcceptIn):
    actor = require_actor(request)
    try:
        acc = accept_helper_invite(actor, token, pledge=payload.pledge)
    except InviteError as exc:
        msg = str(exc)
        code = 404 if "not found" in msg.lower() else 400
        raise HttpError(code, msg) from exc
    return AcceptOut(
        ok=True,
        is_helper=True,
        helper_org=acc.helper_org or "",
        message="You are a Helper now. Not a doctor and not an emergency service.",
    )
