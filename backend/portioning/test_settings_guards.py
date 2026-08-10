"""The deploy-time guards in settings.py (REL-476).

A public URL left at its localhost default is invisible in production: the app
is healthy, sends report success, and the client receives a link only the
sender's machine can open. These tests pin the rule that stops it booting.
"""

import os
import subprocess
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from portioning.settings import _require_public_url

BACKEND_DIR = Path(__file__).resolve().parent.parent


class PublicUrlRuleTests(SimpleTestCase):
    """The rule itself, independent of how settings.py happens to call it."""

    def test_a_real_public_url_passes_and_is_returned_unchanged(self):
        for url in (
            'https://catering.relogue.com',
            'https://catering.relogue.com/',
            'http://staging.example.co.uk:8080',
        ):
            with self.subTest(url=url):
                self.assertEqual(_require_public_url('X', url, debug=False), url)

    def test_localhost_is_refused_in_production(self):
        for url in (
            'http://localhost:3000',
            'https://localhost',
            'http://127.0.0.1:8000',
            'http://0.0.0.0:8000',
            'http://[::1]:3000',
        ):
            with self.subTest(url=url):
                with self.assertRaises(ImproperlyConfigured) as caught:
                    _require_public_url('FRONTEND_BASE_URL', url, debug=False)
                # The message has to name the setting, or whoever is paged at
                # 2am has to go reading settings.py to find out which one.
                self.assertIn('FRONTEND_BASE_URL', str(caught.exception))

    def test_an_unset_or_empty_value_is_refused(self):
        # `if not set` would let the empty string through; the guard checks the
        # value, not its presence.
        for url in ('', '   ', None):
            with self.subTest(url=url):
                with self.assertRaises(ImproperlyConfigured):
                    _require_public_url('FRONTEND_BASE_URL', url, debug=False)

    def test_a_url_without_a_scheme_is_refused(self):
        # 'catering.relogue.com/b/<token>' in an email is a relative link, which
        # resolves against whatever page the client happens to be on.
        for url in ('catering.relogue.com', '//catering.relogue.com', 'ftp://x.com'):
            with self.subTest(url=url):
                with self.assertRaises(ImproperlyConfigured):
                    _require_public_url('FRONTEND_BASE_URL', url, debug=False)

    def test_debug_keeps_every_local_default(self):
        # Dev and the test runner must be completely untouched by this.
        for url in ('http://localhost:3000', '', None, 'nonsense'):
            with self.subTest(url=url):
                self.assertEqual(_require_public_url('X', url, debug=True), url)


class RefusesToBootTests(SimpleTestCase):
    """The rule is only worth anything if it actually stops the process.

    Run in a subprocess: asserting this in-process would mean reloading the
    settings module, which every other test in the suite is holding a reference
    into.
    """

    def _check(self, **overrides):
        env = {
            **os.environ,
            'SECRET_KEY': 'guard-test-key',
            'ALLOWED_HOSTS': 'catering.example.com',
            'DEBUG': 'False',
            'FRONTEND_BASE_URL': 'https://catering.example.com',
            'OAUTH_REDIRECT_BASE': 'https://catering.example.com',
            **overrides,
        }
        return subprocess.run(
            [sys.executable, 'manage.py', 'check'],
            cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=120,
        )

    def test_a_correctly_configured_production_env_boots(self):
        # Guards against the opposite failure: a check so strict nothing starts.
        result = self._check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_a_localhost_frontend_url_stops_the_boot(self):
        result = self._check(FRONTEND_BASE_URL='http://localhost:3000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FRONTEND_BASE_URL', result.stderr)

    def test_a_localhost_oauth_redirect_base_stops_the_boot(self):
        result = self._check(OAUTH_REDIRECT_BASE='http://localhost:8000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('OAUTH_REDIRECT_BASE', result.stderr)

    def test_the_same_env_with_debug_on_boots_fine(self):
        result = self._check(DEBUG='True', FRONTEND_BASE_URL='http://localhost:3000')
        self.assertEqual(result.returncode, 0, result.stderr)
