"""PACE Pro SystemBind challenge signing; credentials stay in private memory.

The verified RSA mode signs nonce[4] + account ID[8], both little endian,
using RSA-2048 PKCS#1 v1.5 with SHA-256. No captured signature is reused.
"""

import base64
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


def bind_status(payload):
    if len(payload) != 17:
        raise AuthError("Unexpected COROS SystemBind response.")
    return {"status": payload[0] & 7, "keyExists": bool(payload[9] & 1),
            "authType": (payload[9] >> 1) & 1, "needRandom": bool(payload[9] & 4),
            "nonce": payload[11:15]}


class AccountAuth:
    def __init__(self, credential, device_name):
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
        except Exception:
            raise AuthError("The saved COROS account key or watch profile is invalid.") from None

    def initial_payload(self, utc_seconds=None):
        base = bytearray(self.profile)
        struct.pack_into("<I", base, 5, int(time.time()) if utc_seconds is None else utc_seconds)
        return bytes(base)

    def authenticated_payload(self, base, challenge):
        if (challenge["status"] != 5 or not challenge["keyExists"] or
                challenge["authType"] != 0 or not challenge["needRandom"]):
            raise AuthError("The watch needs a COROS account key update. Reconnect with the official COROS app, then sign in to CorosLink again.")
        nonce = challenge["nonce"]
        if len(nonce) != 4:
            raise AuthError("Invalid COROS authentication challenge.")
        signature = self.key.sign(nonce + self.user, padding.PKCS1v15(), hashes.SHA256())
        return base + AUTH_METADATA + signature + self.user + nonce
