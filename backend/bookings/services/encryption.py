import base64
import binascii
import hashlib

from cryptography.fernet import Fernet, MultiFernet
from django.conf import settings


def _derive_key(material: str) -> bytes:
    """Turn any string into a valid 32-byte urlsafe-base64 Fernet key."""
    return base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest())


def _key_from(material: str) -> bytes:
    """Use the value as-is if it already is a Fernet key, else derive one.

    Lets `TOKEN_ENCRYPTION_KEY` be either a proper `Fernet.generate_key()`
    value or an arbitrary passphrase, without the caller having to know.
    """
    try:
        Fernet(material.encode())
    except (ValueError, binascii.Error):
        return _derive_key(material)
    return material.encode()


def _get_fernet() -> MultiFernet:
    """Encrypt with TOKEN_ENCRYPTION_KEY when set, else with SECRET_KEY.

    Both keys are always accepted for *decryption*, so setting a dedicated
    TOKEN_ENCRYPTION_KEY on an existing deployment doesn't strand ciphertext
    written under the old SECRET_KEY-derived key — and rotating SECRET_KEY
    stops being an event that forces every caterer to re-authorise their
    mailbox. MultiFernet encrypts with the first key and decrypts with any.
    """
    keys = []
    dedicated = getattr(settings, 'TOKEN_ENCRYPTION_KEY', '')
    if dedicated:
        keys.append(Fernet(_key_from(dedicated)))
    keys.append(Fernet(_derive_key(settings.SECRET_KEY)))
    return MultiFernet(keys)


def encrypt(plaintext: str) -> str:
    """Encrypt a string and return the base64-encoded ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext and return the plaintext."""
    return _get_fernet().decrypt(ciphertext.encode()).decode()
