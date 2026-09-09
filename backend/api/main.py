"""Ninja API composition."""

from __future__ import annotations

from ninja import NinjaAPI

from api.v1 import (
    ai,
    bot,
    bugs,
    dialogue,
    empathy,
    fund,
    health,
    help as help_api,
    helper_invite,
    i18n,
    identity,
    moderation,
    notifications,
    profile,
    rtc,
    stories,
    support,
    therapy,
)

api = NinjaAPI(
    title="de-press API",
    version="1.0.0",
    urls_namespace="api",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

api.add_router("/v1", health.router)
api.add_router("/v1", identity.router)
api.add_router("/v1", bugs.router)
api.add_router("/v1", fund.router)
api.add_router("/v1", stories.router)
api.add_router("/v1", empathy.router)
api.add_router("/v1", support.router)
api.add_router("/v1", moderation.router)
api.add_router("/v1", dialogue.router)
api.add_router("/v1", help_api.router)
api.add_router("/v1", helper_invite.router)
api.add_router("/v1", notifications.router)
api.add_router("/v1", profile.router)
api.add_router("/v1", ai.router)
api.add_router("/v1", i18n.router)
api.add_router("/v1", rtc.router)
api.add_router("/v1", therapy.router)
api.add_router("/v1", bot.router)
