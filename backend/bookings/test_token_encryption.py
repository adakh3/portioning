"""Mailbox-token key rotation (REL-487).

The crypto itself (Fernet + MultiFernet, PBKDF2-600k for passphrases) was never
in question. What was missing is that nothing stopped production from running on
the SECRET_KEY-derived fallback — which couples the JWT/OAuth-state signing key
to the key protecting every caterer's live Gmail/Outlook refresh token.

The settings guard that now forbids that in production is tested in
`portioning/test_settings_guards.py`, alongside the other boot guards. What is
tested here is the migration it forces you into: adopting a dedicated key on an
environment whose tokens were written under the old one.
"""
from cryptography.fernet import Fernet, InvalidToken
from django.test import SimpleTestCase, override_settings

from bookings.services import encryption


class KeyRotationTests(SimpleTestCase):
    """Adopting a dedicated key must not strand tokens written under the old one."""

    def setUp(self):
        # _build is lru_cached on (primary, fallbacks, is_secret_key), so each
        # override must start from a clean cache or it reads a stale MultiFernet.
        encryption._build.cache_clear()
        self.addCleanup(encryption._build.cache_clear)

    SECRET = 'the-old-django-secret-key-value'

    def test_tokens_written_on_the_fallback_still_decrypt_after_the_key_is_set(self):
        """The exact migration REL-487 asks an operator to perform.

        This failed before `_fallback_fernets`: SECRET_KEY is SHA-256-derived as
        the primary but was PBKDF2-stretched as a fallback, so the same string
        produced two different keys and prod's live mailbox tokens would have
        become unreadable the moment the dedicated key was set.
        """
        with override_settings(SECRET_KEY=self.SECRET, TOKEN_ENCRYPTION_KEY='',
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            ciphertext = encryption.encrypt('ya29.a-real-refresh-token')
        encryption._build.cache_clear()

        new_key = Fernet.generate_key().decode()
        with override_settings(SECRET_KEY=self.SECRET, TOKEN_ENCRYPTION_KEY=new_key,
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=self.SECRET):
            self.assertEqual(
                encryption.decrypt(ciphertext), 'ya29.a-real-refresh-token',
            )

    def test_new_writes_go_out_under_the_dedicated_key_not_the_fallback(self):
        """Otherwise the migration never actually moves off SECRET_KEY."""
        new_key = Fernet.generate_key().decode()
        with override_settings(SECRET_KEY=self.SECRET, TOKEN_ENCRYPTION_KEY=new_key,
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=self.SECRET):
            ciphertext = encryption.encrypt('written-after-the-migration')
        encryption._build.cache_clear()

        # Readable under the dedicated key alone, with no fallbacks configured.
        with override_settings(SECRET_KEY='a-completely-different-secret',
                               TOKEN_ENCRYPTION_KEY=new_key,
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            self.assertEqual(
                encryption.decrypt(ciphertext), 'written-after-the-migration',
            )

    def test_setting_the_key_without_fallbacks_strands_old_ciphertext(self):
        """The failure the error message warns about, pinned so it stays true."""
        with override_settings(SECRET_KEY=self.SECRET, TOKEN_ENCRYPTION_KEY='',
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            ciphertext = encryption.encrypt('ya29.a-real-refresh-token')
        encryption._build.cache_clear()

        with override_settings(SECRET_KEY=self.SECRET,
                               TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(),
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            with self.assertRaises(InvalidToken):
                encryption.decrypt(ciphertext)

    def test_a_leaked_secret_key_no_longer_reads_mailbox_tokens(self):
        """The whole point: the two keys must fail independently."""
        new_key = Fernet.generate_key().decode()
        with override_settings(SECRET_KEY=self.SECRET, TOKEN_ENCRYPTION_KEY=new_key,
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            ciphertext = encryption.encrypt('ya29.a-real-refresh-token')
        encryption._build.cache_clear()

        # An attacker holding SECRET_KEY, but not TOKEN_ENCRYPTION_KEY.
        with override_settings(SECRET_KEY=self.SECRET, TOKEN_ENCRYPTION_KEY='',
                               TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            with self.assertRaises(InvalidToken):
                encryption.decrypt(ciphertext)
