"""PACE Pro SystemBind challenge signing; credentials stay in private memory.

The verified RSA mode signs nonce[4] + account ID[8], both little endian,
using RSA-2048 PKCS#1 v1.5 with SHA-256. No captured signature is reused.
"""

import base64
import re
import struct
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import load_der_private_key

OPCODE = 0xA5
AUTH_METADATA = bytes([0, 1, 0x10, 1, 0, 0x11, 0, 0x0C])


class AuthError(Exception):
    """Only static, credential-free messages may be returned to the UI."""


def crc32_mpeg2(data):
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte << 24
        for _ in range(8):
            crc = ((crc << 1) ^ (0x04C11DB7 if crc & 0x80000000 else 0)) & 0xFFFFFFFF
    return crc


def frame_message(opcode, payload, maximum=20):
    if not 3 <= maximum <= 255:
        raise AuthError("Invalid COROS control frame size.")
    logical = payload + bytes([sum(payload) & 255])
    size = maximum - 2
    count = max(1, (len(logical) + size - 1) // size)
    if count > 256:
        raise AuthError("COROS control message is too large.")
    return [bytes([opcode, count - index - 1]) + logical[offset:offset + size]
            for index, offset in enumerate(range(0, len(logical), size))]


class MessageDecoder:
    def __init__(self, opcode):
        self.opcode = opcode
        self.remaining = None
        self.payload = bytearray()

    def accept(self, frame):
        if not frame or frame[0] != self.opcode:
            return None
        if len(frame) < 3 or (self.remaining is not None and frame[1] != self.remaining - 1):
            raise AuthError("Invalid COROS response frame sequence.")
        self.remaining = frame[1]
        self.payload.extend(frame[2:])
        if len(self.payload) > 4096:
            raise AuthError("COROS response is too large.")
        if self.remaining:
            return None
        if (sum(self.payload[:-1]) & 255) != self.payload[-1]:
            raise AuthError("COROS response checksum failed.")
        return bytes(self.payload[:-1])


KEY_UPDATE = "The watch needs a COROS account key update. Reconnect with the official COROS app, then sign in to CorosLink again."
KEY_MISMATCH = ("Your watch has a different COROS key than the one CorosLink saved. Sign in to COROS again here. "
                "If that doesn't fix it, connect the watch to the COROS app once, then reconnect.")
OTHER_ACCOUNT = "This watch is paired to a different COROS account. Sign in to CorosLink with that account, then reconnect."
TIMED_OUT = "The watch's sign-in request timed out. Reconnect to try again."
KEY_REJECTED = ("The watch didn't accept CorosLink's key and cleared its own. Connect the watch to the COROS app once, "
                "then sign in to COROS here again and reconnect.")
REJECTED = "The watch rejected COROS authentication. Sign in with the account paired to this watch, then reconnect."


class KeyMismatchError(AuthError):
    """The watch stores a different account key; nothing was signed."""


def crc16_ccitt_false(data):
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ (0x1021 if crc & 0x8000 else 0)) & 0xFFFF
    return crc


def watch_key_id(public_numbers):
    """The checksum the watch reports (challenge bytes 7-8) for its stored public key."""
    modulus = public_numbers.n.to_bytes((public_numbers.n.bit_length() + 7) // 8, "big")
    exponent = public_numbers.e.to_bytes((public_numbers.e.bit_length() + 7) // 8, "big")
    return crc16_ccitt_false(struct.pack("<HH", len(modulus), len(exponent)) + modulus + exponent)


def reports_key_id(model_number, device_name):
    """Whether the watch always reports its stored key's checksum (checked on the PACE 4, W336),
    by model number, else by advertised name, as electron/watchfaceTargets.ts recognizes it."""
    model = (model_number or "").strip().upper()
    if re.search(r"\b(W\d{3}|B\d{2}S?)\b", model):
        return re.search(r"\bW336\b", model) is not None
    name = re.sub(r"\s+[0-9A-F]{4,8}$", "", (device_name or "").strip(), flags=re.IGNORECASE).upper()
    return name == "COROS PACE 4"


def bind_status(payload):
    if len(payload) != 17:
        raise AuthError("Unexpected COROS SystemBind response.")
    return {"status": payload[0] & 7, "keyExists": bool(payload[9] & 1),
            "authType": (payload[9] >> 1) & 1, "needRandom": bool(payload[9] & 4),
            "keyId": int.from_bytes(payload[7:9], "little"), "reason": payload[10],
            "nonce": payload[11:15]}


def refusal_message(response):
    """The user-facing message for a final SystemBind reply that isn't a success."""
    if response["status"] == 2 or response.get("reason") == 3:
        return OTHER_ACCOUNT
    return {1: TIMED_OUT, 9: TIMED_OUT, 4: KEY_REJECTED, 11: KEY_UPDATE}.get(response.get("reason"), REJECTED)


class AccountAuth:
    def __init__(self, credential, device_name, key_id_reported=False):
        # On a watch that always reports its key's checksum, 0000 means it holds no key.
        self.key_id_reported = key_id_reported
        try:
            if credential["version"] != 1 or credential["deviceName"] != device_name:
                raise ValueError()
            text = credential["accountUserId"]
            if not isinstance(text, str) or not text.isascii() or not text.isdecimal():
                raise ValueError()
            self.user = int(text).to_bytes(8, "little")
            self.profile = base64.b64decode(credential["bindProfile"], validate=True)
            if len(self.profile) != 17 or self.profile[0] != 1 or self.profile[16] != 0x80:
                raise ValueError()
            if self.profile[1:5] != struct.pack("<I", crc32_mpeg2(self.user)):
                raise ValueError()
            encoded = credential["privateKeyDer"]
            if not isinstance(encoded, str) or len(encoded) > 10_000:
                raise ValueError()
            self.key = load_der_private_key(base64.b64decode(encoded, validate=True), None)
            if not isinstance(self.key, rsa.RSAPrivateKey) or self.key.key_size != 2048:
                raise ValueError()
            self.key_id = watch_key_id(self.key.public_key().public_numbers())
        except Exception:
            raise AuthError("The saved COROS account key or watch profile is invalid.") from None

    def initial_payload(self, utc_seconds=None):
        base = bytearray(self.profile)
        struct.pack_into("<I", base, 5, int(time.time()) if utc_seconds is None else utc_seconds)
        return bytes(base)

    def authenticated_payload(self, base, challenge):
        """The watch erases its stored key when a signature fails against it, so a
        challenge naming a different key is refused unsigned."""
        if challenge["status"] == 2:
            raise AuthError(OTHER_ACCOUNT)
        if (challenge["status"] != 5 or not challenge["keyExists"] or
                challenge["authType"] != 0 or not challenge["needRandom"]):
            raise AuthError(KEY_UPDATE)
        # 0 means the watch didn't report a checksum, except on a watch that always reports one: it holds no key.
        if challenge.get("keyId", 0) == 0 and self.key_id_reported:
            raise AuthError(KEY_UPDATE)
        if challenge.get("keyId", 0) not in (0, self.key_id):
            raise KeyMismatchError(KEY_MISMATCH)
        nonce = challenge["nonce"]
        if len(nonce) != 4:
            raise AuthError("Invalid COROS authentication challenge.")
        signature = self.key.sign(nonce + self.user, padding.PKCS1v15(), hashes.SHA256())
        return base + AUTH_METADATA + signature + self.user + nonce
