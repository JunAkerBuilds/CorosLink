#!/usr/bin/env python3
"""Synthetic keys and fresh nonces only; no personal capture fixtures."""
import asyncio
import base64
import importlib.util
from pathlib import Path
import struct
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
from coros_ble_auth import (AccountAuth, AuthError, KEY_MISMATCH, KEY_REJECTED, KEY_UPDATE, KeyMismatchError, MessageDecoder, OTHER_ACCOUNT,
                            bind_status, crc16_ccitt_false, crc32_mpeg2, frame_message, refusal_message, reports_key_id, watch_key_id)

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("native_ble", ROOT / "coros-native-ble.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class AuthenticationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        # Account 1 has the public CRC vector 93 67 a5 32, independently
        # checked by the TypeScript SystemBind tests.
        profile = bytes.fromhex("019367a53200000000f0012b0700000080")
        cls.credential = {"version": 1, "deviceName": "COROS PACE Pro TEST",
                          "accountUserId": "1", "bindProfile": base64.b64encode(profile).decode(),
                          "privateKeyDer": base64.b64encode(cls.key.private_bytes(
                              Encoding.DER, PrivateFormat.TraditionalOpenSSL, NoEncryption())).decode()}

    def test_fresh_challenges_and_signature_layout(self):
        account = AccountAuth(self.credential, self.credential["deviceName"])
        base = account.initial_payload(0x12345678)
        self.assertEqual(base[5:9], b"\x78\x56\x34\x12")
        signatures = []
        for nonce in [b"1234", b"5678"]:
            challenge = {"status": 5, "keyExists": True, "authType": 0, "needRandom": True, "nonce": nonce}
            payload = account.authenticated_payload(base, challenge)
            self.assertEqual(len(payload), 293)
            self.assertEqual(payload[-12:], b"\x01" + bytes(7) + nonce)
            signature = payload[25:281]
            self.key.public_key().verify(signature, nonce + b"\x01" + bytes(7), padding.PKCS1v15(), hashes.SHA256())
            signatures.append(signature)
            frames = frame_message(0xA5, payload, 240)
            self.assertEqual([len(frame) for frame in frames], [240, 58])
            self.assertEqual([frame[1] for frame in frames], [1, 0])
        self.assertNotEqual(*signatures, "a new watch nonce produces a new signature")

    def test_profile_and_challenge_validation(self):
        self.assertEqual(crc32_mpeg2(b"123456789"), 0x0376E6E7)
        for changes in [{"accountUserId": "2"}, {"accountUserId": str(1 << 64)},
                        {"privateKeyDer": "bad-key"}, {"version": 2}, {"deviceName": "other watch"}]:
            with self.assertRaises(AuthError):
                AccountAuth({**self.credential, **changes}, self.credential["deviceName"])
        account = AccountAuth(self.credential, self.credential["deviceName"])
        challenge = {"status": 5, "keyExists": True, "authType": 0, "needRandom": True, "nonce": b"1234"}
        for changes in [{"keyExists": False}, {"authType": 1}, {"needRandom": False}, {"status": 1}]:
            with self.assertRaises(AuthError):
                account.authenticated_payload(account.initial_payload(), {**challenge, **changes})

    def test_watch_key_checksum_is_compared_before_signing(self):
        # CRC-16/CCITT-FALSE over [u16 n length][u16 e length][n][e], as the watch reports it.
        self.assertEqual(crc16_ccitt_false(b"123456789"), 0x29B1)
        numbers = self.key.public_key().public_numbers()
        blob = struct.pack("<HH", 256, 3) + numbers.n.to_bytes(256, "big") + b"\x01\x00\x01"
        account = AccountAuth(self.credential, self.credential["deviceName"])
        self.assertEqual(account.key_id, crc16_ccitt_false(blob))
        self.assertEqual(watch_key_id(numbers), account.key_id)
        challenge = {"status": 5, "keyExists": True, "authType": 0, "needRandom": True, "nonce": b"1234"}
        for key_id in [account.key_id, 0]:
            self.assertEqual(len(account.authenticated_payload(account.initial_payload(), {**challenge, "keyId": key_id})), 293)
        with self.assertRaises(KeyMismatchError) as caught:
            account.authenticated_payload(account.initial_payload(), {**challenge, "keyId": account.key_id ^ 1})
        self.assertEqual(str(caught.exception), KEY_MISMATCH)
        with self.assertRaises(AuthError) as caught:
            account.authenticated_payload(account.initial_payload(), {**challenge, "status": 2})
        self.assertEqual(str(caught.exception), OTHER_ACCOUNT)
        reply = bytearray(17); reply[0] = 0x35; reply[7:9] = b"\x1a\x3f"; reply[10] = 4
        self.assertEqual(bind_status(bytes(reply))["keyId"], 0x3F1A)
        self.assertEqual(refusal_message(bind_status(bytes(reply))), KEY_REJECTED)

    def test_pace_4_reporting_no_key_is_not_signed(self):
        # The PACE 4 always reports its key's checksum, so 0000 there means it holds no key; other watches keep signing on 0000.
        self.assertTrue(reports_key_id("COROS W336", "COROS PACE 4 81D0"))
        self.assertTrue(reports_key_id("W336-3.2008.0", ""))
        self.assertTrue(reports_key_id("", "COROS PACE 4 81D0"))
        self.assertTrue(reports_key_id(None, "COROS PACE 4"))
        for model, name in [("COROS W332", "COROS PACE Pro TEST"), ("COROS W337", "COROS PACE 4 81D0"), ("", "COROS PACE 4 Pro 81D0"),
                            ("", "COROS APEX 4 81D0"), (None, None), ("COROS W541", "COROS PACE 4 81D0")]:
            self.assertFalse(reports_key_id(model, name), (model, name))
        challenge = {"status": 5, "keyExists": True, "authType": 0, "needRandom": True, "nonce": b"1234", "keyId": 0}
        pace_4 = AccountAuth(self.credential, self.credential["deviceName"], key_id_reported=True)
        with self.assertRaises(AuthError) as caught:
            pace_4.authenticated_payload(pace_4.initial_payload(), challenge)
        self.assertEqual(str(caught.exception), KEY_UPDATE)
        self.assertNotIsInstance(caught.exception, KeyMismatchError)
        self.assertEqual(len(pace_4.authenticated_payload(pace_4.initial_payload(), {**challenge, "keyId": pace_4.key_id})), 293)
        other = AccountAuth(self.credential, self.credential["deviceName"])
        self.assertEqual(len(other.authenticated_payload(other.initial_payload(), challenge)), 293)

    async def test_live_pace_4_session_with_no_key_sends_nothing_signed(self):
        for model, signed in [("COROS W336", False), ("COROS W332", True)]:
            session = native.NativeSession()
            session.connection = type("Connection", (), {"is_encrypted": True})()
            session.state.update(connected=True, encrypted=True, mtu=247, modelNumber=model)
            calls = []

            async def exchange(payload, maximum):
                calls.append(payload)
                reply = bytearray(17)
                if len(calls) == 1:
                    reply[0] = 0x35;reply[9] = 5;reply[11:15] = b"new!"
                else:
                    reply[0] = 0x31
                return bytes(reply)

            session.control_exchange = exchange
            await session.authenticate(self.credential, self.credential["deviceName"])
            self.assertEqual(len(calls), 2 if signed else 1, model)
            self.assertEqual(session.state["systemBind"], "authenticated" if signed else "failed")
            if not signed:
                self.assertEqual(session.state["authenticationError"], KEY_UPDATE)
                self.assertIsNone(session.state.get("keyCheck"), "no key is not a different key")

    def test_incomplete_out_of_order_and_bad_checksum(self):
        frames = frame_message(0xA5, bytes(range(40)))
        decoder = MessageDecoder(0xA5)
        self.assertIsNone(decoder.accept(b"\x42\x00\x00"))
        self.assertIsNone(decoder.accept(frames[0]))
        with self.assertRaises(AuthError):
            decoder.accept(frames[-1])
        corrupt = bytearray(frame_message(0xA5, b"123")[0]);corrupt[-1] ^= 1
        with self.assertRaises(AuthError):
            MessageDecoder(0xA5).accept(corrupt)
        with self.assertRaises(AuthError):
            bind_status(bytes(16))

    async def test_live_session_acceptance_rejection_and_disconnect(self):
        for accepted in [True, False]:
            session = native.NativeSession()
            session.connection = type("Connection", (), {"is_encrypted": True})()
            session.state.update(connected=True, encrypted=True, mtu=247)
            calls = []

            async def exchange(payload, maximum):
                calls.append(payload)
                reply = bytearray(17)
                if len(calls) == 1:
                    reply[0] = 0x35;reply[9] = 5;reply[11:15] = b"new!"
                else:
                    self.assertEqual(maximum, 240)
                    self.key.public_key().verify(payload[25:281], b"new!\x01" + bytes(7), padding.PKCS1v15(), hashes.SHA256())
                    reply[0] = 0x31 if accepted else 0x35
                return bytes(reply)

            session.control_exchange = exchange
            await session.authenticate(self.credential, self.credential["deviceName"])
            self.assertEqual(session.state["systemBind"], "authenticated" if accepted else "failed")
            self.assertEqual(session.state.get("keyCheck"), "ok" if accepted else None)
            self.assertTrue(session.state["connected"], "an auth rejection retains the working BLE connection")
            self.assertEqual(len(calls), 2)
            self.assertNotIn(self.credential["privateKeyDer"], str(session.state))
            session.disconnected(None)
            self.assertEqual(session.state["systemBind"], "not_authenticated")
            self.assertNotIn("authenticatedAt", session.state)

    async def test_live_session_key_mismatch_and_rejection(self):
        account = AccountAuth(self.credential, self.credential["deviceName"])
        for case in ["mismatch", "rejected"]:
            session = native.NativeSession()
            session.connection = type("Connection", (), {"is_encrypted": True})()
            session.state.update(connected=True, encrypted=True, mtu=247)
            calls = []

            async def exchange(payload, maximum):
                calls.append(payload)
                reply = bytearray(17)
                if len(calls) == 1:
                    reply[0] = 0x35;reply[9] = 5;reply[11:15] = b"new!"
                    reply[7:9] = struct.pack("<H", account.key_id ^ 0x55 if case == "mismatch" else account.key_id)
                else:
                    reply[0] = 0x35;reply[10] = 4
                return bytes(reply)

            session.control_exchange = exchange
            await session.authenticate(self.credential, self.credential["deviceName"])
            self.assertEqual(session.state["systemBind"], "failed")
            self.assertEqual(session.state["keyCheck"], case)
            if case == "mismatch":
                self.assertEqual(len(calls), 1, "a different key on the watch is never signed for")
                self.assertEqual(session.state["authenticationError"], KEY_MISMATCH)
            else:
                self.assertEqual(session.state["authenticationError"], KEY_REJECTED)
            self.assertNotIn(self.credential["privateKeyDer"], str(session.state))

    async def test_cleanup_failure_and_safe_pairing_error(self):
        class BrokenTransport:
            async def __aexit__(self, *args):
                raise RuntimeError("private exception contents must not escape")

        session = native.NativeSession()
        session.transport = BrokenTransport()
        session.state.update(connected=True, encrypted=True, systemBind="authenticated")
        await session.close()
        self.assertIsNone(session.transport)
        self.assertFalse(session.state["connected"])
        await session.close()  # Closing an already closed session is harmless.
        message = native.operation_error("encrypting the watch connection", native.HCI_Error(6))
        self.assertIn("Pair with CorosLink", message)
        self.assertNotIn("private", message)

    async def test_remote_disconnect_releases_old_transport_before_reopen(self):
        events = []

        class OldTransport:
            async def __aexit__(self, *args):
                events.append("released")

        async def opening(_spec):
            events.append("opening")
            raise RuntimeError("stop before accessing real hardware")

        session = native.NativeSession()
        session.transport = OldTransport()
        session.disconnected(None)
        with patch.object(native, "open_transport", opening):
            with self.assertRaises(RuntimeError):
                await session.connect({}, "test transport")
        self.assertEqual(events, ["released", "opening"])


if __name__ == "__main__":
    unittest.main()
