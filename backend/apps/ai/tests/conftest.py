"""Pin the offline AI contract: the suite must not depend on ambient API keys."""

from __future__ import annotations

import pytest
from django.test import override_settings


@pytest.fixture(autouse=True)
def _no_ai_key():
    with override_settings(AI_API_KEY=""):
        yield
