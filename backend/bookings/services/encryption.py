import base64
import binascii
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, MultiFernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from django.conf import settings

logger = logging.getLogger(__name__)

# Only reached when someone supplies a passphrase instead of a generated key.
# A passphrase is guessable, so it gets a real KDF; the cost is paid once
# because the Fernet instance is cached.
PBKDF2_ITERATIONS = 600_000
PBKDF2_SALT = b'portioning.token-encryption.v1'


def _derive_from_secret_key(material: str) -> bytes:
    """Key from Django's SECRET_KEY, which is already high-entropy random."""
    return base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest())


def _derive_from_passphrase(material: str) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32,
        salt=PBKDF2_SALT, iterations=PBKDF2_ITERATIONS,
    )
    return base64.urlsafe_b64encode(kdf.derive(material.encode()))


def _fernet_for(material: str, *, is_secret_key: bool) -> Fernet:
    """Accept a generated Fernet key as-is; derive one from anything else."""
    try:
        return Fernet(material.encode())
    except (ValueError, binascii.Error):
        pass

    if is_secret_key:
        return Fernet(_derive_from_secret_key(material))

    logger.warning(
        'TOKEN_ENCRYPTION_KEY is not a generated Fernet key, so it is being '
        'stretched as a passphrase. Prefer '
        'Fernet.generate_key() — and note that changing this value by even a '
        'character makes every stored token unreadable.'
    )
    return Fernet(_derive_from_passphrase(material))


@lru_cache(maxsize=8)
def _build(primary: str, fallbacks: tuple, primary_is_secret_key: bool) -> MultiFernet:
    keys = [_fernet_for(primary, is_secret_key=primary_is_secret_key)]
    # Old keys decrypt but never encrypt, which is what makes a rotation
    # possible without asking every caterer to reconnect their mailbox.
    keys += [_fernet_for(key, is_secret_key=False) for key in fallbacks]
    return MultiFernet(keys)


def _get_fernet() -> MultiFernet:
    """Encrypt under TOKEN_ENCRYPTION_KEY when set, else under SECRET_KEY.

    When a dedicated key is configured it is used *alone* — SECRET_KEY is
    deliberately not kept as a silent second decryption key, or compromising
    the value that also signs JWTs would hand over every caterer's mailbox
    credentials for good. To move existing ciphertext onto a new key (including
    off SECRET_KEY), list the old one in TOKEN_ENCRYPTION_KEY_FALLBACKS: it
    keeps decrypting while every write goes out under the new key.
    """
    dedicated = (getattr(settings, 'TOKEN_ENCRYPTION_KEY', '') or '').strip()
    raw_fallbacks = getattr(settings, 'TOKEN_ENCRYPTION_KEY_FALLBACKS', '') or ''
    fallbacks = tuple(key.strip() for key in raw_fallbacks.split(',') if key.strip())

    if dedicated:
        return _build(dedicated, fallbacks, False)
    return _build(settings.SECRET_KEY, fallbacks, True)


def encrypt(plaintext: str) -> str:
    """Encrypt a string and return the base64-encoded ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext and return the plaintext.

    Raises ``cryptography.fernet.InvalidToken`` if no configured key can read
    it — which is what a key change without a fallback looks like.
    """
    return _get_fernet().decrypt(ciphertext.encode()).decode()
