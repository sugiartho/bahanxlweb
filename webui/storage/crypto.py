"""AES-256-GCM encryption for sensitive storage blobs at rest."""
from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes

_MAGIC = b"ENC1"
_NONCE_SIZE = 12
_TAG_SIZE = 16


def _decode_key(raw: str) -> bytes:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("empty key")
    try:
        if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
            return bytes.fromhex(raw)
        decoded = base64.b64decode(raw, validate=True)
        if len(decoded) == 32:
            return decoded
    except Exception:
        pass
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return digest


def resolve_encryption_key(explicit: Optional[str] = None, *, session_secret: Optional[bytes] = None) -> bytes:
    """Return a 32-byte AES key from env/explicit value or session secret fallback."""
    env_key = explicit if explicit is not None else os.getenv("STORAGE_ENCRYPTION_KEY", "")
    if env_key.strip():
        return _decode_key(env_key)
    if session_secret:
        return hashlib.sha256(session_secret).digest()
    raise ValueError(
        "STORAGE_ENCRYPTION_KEY is required for encrypted storage "
        "(or provide session_secret for dev fallback)"
    )


def encrypt_bytes(plaintext: bytes, key: bytes) -> bytes:
    if len(key) != 32:
        raise ValueError("AES-256-GCM requires a 32-byte key")
    nonce = get_random_bytes(_NONCE_SIZE)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext)
    return _MAGIC + nonce + tag + ciphertext


def decrypt_bytes(data: bytes, key: bytes) -> bytes:
    if not data.startswith(_MAGIC):
        return data
    if len(key) != 32:
        raise ValueError("AES-256-GCM requires a 32-byte key")
    offset = len(_MAGIC)
    nonce = data[offset : offset + _NONCE_SIZE]
    tag = data[offset + _NONCE_SIZE : offset + _NONCE_SIZE + _TAG_SIZE]
    ciphertext = data[offset + _NONCE_SIZE + _TAG_SIZE :]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    return cipher.decrypt_and_verify(ciphertext, tag)


def encrypt_text(plaintext: str, key: bytes) -> bytes:
    return encrypt_bytes(plaintext.encode("utf-8"), key)


def decrypt_text(data: bytes, key: bytes) -> str:
    return decrypt_bytes(data, key).decode("utf-8")


def is_encrypted(data: bytes) -> bool:
    return data.startswith(_MAGIC)