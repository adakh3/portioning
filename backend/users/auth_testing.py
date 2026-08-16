"""Test helpers for the authentication endpoints.

Deliberately NOT named `test_*.py`, so the test runner treats it as a library
rather than a module to collect tests from.

Both brute-force defences keep state the database rollback between tests does
not touch — DRF throttle history lives in the cache, and django-axes counts in
its own table. Any test class that logs in more than a couple of times has to
reset them, or it inherits the previous test's attempts and starts getting 429s
that have nothing to do with what it is asserting.
"""
from unittest.mock import patch

from axes.models import AccessAttempt
from django.core.cache import cache
from django.test import TestCase
from rest_framework.throttling import SimpleRateThrottle


def throttle_rates(**rates):
    """Set DRF throttle rates for a test. A rate of None disables that scope.

    `override_settings(REST_FRAMEWORK=...)` does NOT work for this:
    `SimpleRateThrottle.THROTTLE_RATES` is a class attribute bound to
    `api_settings.DEFAULT_THROTTLE_RATES` at import time, so the override
    updates api_settings while every throttle goes on reading the original
    dict. Patch the class attribute instead.
    """
    return patch.dict(SimpleRateThrottle.THROTTLE_RATES, rates)


class AuthEndpointTestCase(TestCase):
    """Base for tests that hit /api/auth/ repeatedly.

    Clears both counters before each test. Subclasses that are not *about* rate
    limiting should also apply `throttle_rates(login=None)`; see
    `NoLoginThrottleTestCase`.
    """

    def setUp(self):
        super().setUp()
        cache.clear()
        AccessAttempt.objects.all().delete()
        self.addCleanup(cache.clear)


class NoLoginThrottleTestCase(AuthEndpointTestCase):
    """As above, with the per-address login ceiling lifted.

    For tests that sign in several times to set up a scenario and would
    otherwise trip a limit they are not trying to exercise.
    """

    def setUp(self):
        super().setUp()
        rates = throttle_rates(login=None, token_refresh=None, anon=None)
        rates.start()
        self.addCleanup(rates.stop)
