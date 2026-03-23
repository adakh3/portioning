import base64
import hashlib

from cryptography.fernet import Fernet
from django.conf import settings


def _get_fernet() -> Fernet:
    """Derive a Fernet key from Django's SECRET_KEY."""
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt(plaintext: str) -> str:
    """Encrypt a string and return the base64-encoded ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext and return the plaintext."""
    return _get_fernet().decrypt(ciphertext.encode()).decode()
