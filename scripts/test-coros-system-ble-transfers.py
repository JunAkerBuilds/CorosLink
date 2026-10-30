"""Watch faces, music, notifications and watch events on the Windows/Linux worker, against a fake watch."""
import asyncio, binascii, importlib.util, sys, unittest
from unittest import mock
from pathlib import Path
from types import SimpleNamespace
from coros_ble_protocol import ProtocolError
from coros_ble_music import MusicPageReceiver, music_frames, valid_music_delete_file, decode_usb_access, decode_watch_interaction
from coros_ble_route import send_file_block, validate_file_block, WATCHFACE_FILE, MUSIC_DELETE_FILE

sys.modules.setdefault('bleak', SimpleNamespace(BleakClient=object, BleakScanner=object))
sys.modules.setdefault('bleak.exc', SimpleNamespace(BleakError=Exception, BleakGATTProtocolError=Exception,
                                                  BleakBluetoothNotAvailableError=Exception, BleakGATTProtocolErrorCode=int))
spec = importlib.util.spec_from_file_location('system_ble', Path(__file__).with_name('coros-system-ble.py'))
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)

# From electron/corosBleMusicProtocol.ts: encodeMusicDeleteFile / encodeMusicDeleteHeader for
# {name: "Song.mp3", watchPath: "/emmc2:/Music/Song.mp3", watchId: 7, sizeBytes: 12345}.
DELETE_FILE = bytes.fromhex('4846005d0000000041000000d4d96a2a4853000000000000c4172c0000002500000025000000010000000a46210000000a1f080110b9601a162f656d6d63323a2f4d757369632f536f6e672e6d70332007')
DELETE_HEADER = bytes.fromhex('78005d00000000510051000000586fee00000003b7')


def header(block, file_index, slot=0, offset=0, remaining=None):
    h = bytearray(21); h[0] = 0x78; h[2] = file_index; h[3:7] = offset.to_bytes(4, 'little')
    h[7:9] = len(block).to_bytes(2, 'little'); h[9:13] = (remaining or len(block)).to_bytes(4, 'little')
    h[13:15] = binascii.crc_hqx(block, 0xffff).to_bytes(2, 'little'); h[15] = sum(block) & 255; h[16] = slot
    h[19] = 3; h[20] = sum(h[2:20]) & 255
    return bytes(h)


def ack(body):
    return b'\x78\x00' + body + bytes([sum(body) & 255])


class FakeWatch:
    """Answers the worker's control and bulk writes like a COROS watch."""
    def __init__(self, session, music=b'', page=250, packet=100, window=2):
        self.session = session; self.control_writes = []; self.bulk_writes = []
        self.music = music; self.page = page; self.packet = packet; self.window = window
        self.sent = 0; self.pending = b''; self.position = 0; self.file_bytes = 0; self.file_index = None
        self.control_char = SimpleNamespace(max_write_without_response_size=244)
        self.bulk_char = SimpleNamespace(max_write_without_response_size=244)
        self.is_connected = True
        self.services = SimpleNamespace(get_characteristic=lambda uuid: self.bulk_char if 'e50e24dcca9e' in uuid else self.control_char)
        self.channels = {name: {'name': name, 'notifications': 0, 'receivedBytes': 0} for name in ('control', 'bulk')}

    def reply(self, channel, value):
        self.session.notification(self.channels[channel], value)

    async def write_gatt_char(self, char, value, response):
        assert response is False
        value = bytes(value)
        if char is self.control_char:
            self.control_writes.append(value)
            if value[0] == 0x78:  # File header: ready for frames of up to 120 bytes.
                self.file_index = value[2]; self.file_bytes = int.from_bytes(value[7:9], 'little'); self.received = 0
                self.reply('control', ack(bytes([0, 0, 120, 26, 1, 3])))
            elif value[0] == 0x7c and value[1] == 0:  # Music page request: describe the next block.
                block = self.music[self.sent:self.sent + self.page]
                payload = bytearray(19)
                payload[4:6] = len(block).to_bytes(2, 'little'); payload[6:10] = (len(self.music) - self.sent).to_bytes(4, 'little')
                payload[10:12] = binascii.crc_hqx(block, 0xffff).to_bytes(2, 'little')
                payload[13] = self.packet; payload[14] = self.window; payload[15] = 93; payload[16] = 3
                self.pending = block; self.position = 0
                for frame in music_frames(0x7c, payload): self.reply('control', frame)
            elif value[0] == 0x7d and value[1] == 0:  # Block acknowledged.
                self.sent += len(self.pending)
                for frame in music_frames(0x7d, bytes([1, 93])): self.reply('control', frame)
        else:
            self.bulk_writes.append(value)
            if value == bytes([0x7c, 0, 93]):  # Window request: up to `window` data frames.
                for sequence in range(self.window):
                    chunk = self.pending[self.position:self.position + self.packet - 3]
                    if not chunk: break
                    self.position += len(chunk)
                    self.reply('bulk', bytes([0x7c, sequence, 93]) + chunk)
            elif value[0] == 0x78:
                assert value[2] == self.file_index
                self.received += len(value) - 3
                if self.received == self.file_bytes:
                    self.reply('control', ack(bytes([1, 0, self.file_index])))
                    if self.file_index == MUSIC_DELETE_FILE:
                        storage = bytes([1, 1, 0, 9]); self.reply('control', bytes([0xc1, 0]) + storage + bytes([sum(storage) & 255]))


def session_with(watch_args=None):
    session = worker.SystemSession()
    watch = FakeWatch(session, **(watch_args or {}))
    session.client = watch; session.write = watch.control_char
    session.state.update(connected=True, channels=list(watch.channels.values()))
    return session, watch


class TransferTests(unittest.IsolatedAsyncioTestCase):
    async def test_watchface_block_uses_file_eight(self):
        session, watch = session_with()
        block = bytes(range(256)) * 4
        self.assertIsNone(await session.file_block(header(block, WATCHFACE_FILE, slot=4), block, WATCHFACE_FILE))
        self.assertEqual(b''.join(v[3:] for v in watch.bulk_writes), block)
        self.assertTrue(all(v[2] == WATCHFACE_FILE for v in watch.bulk_writes))
        self.assertTrue(all(len(v) <= 120 for v in watch.bulk_writes))
        # Ten slots at most, and a header for another file is refused before anything is written.
        with self.assertRaises(ProtocolError): validate_file_block(header(block, WATCHFACE_FILE, slot=10), block, WATCHFACE_FILE)
        with self.assertRaises(ProtocolError): await session.file_block(header(block, 0x14), block, WATCHFACE_FILE)

    async def test_music_delete_waits_for_storage_reply(self):
        self.assertTrue(valid_music_delete_file(DELETE_FILE))
        self.assertFalse(valid_music_delete_file(DELETE_FILE[:-1] + b'\x08'))
        validate_file_block(DELETE_HEADER, DELETE_FILE, MUSIC_DELETE_FILE)
        session, watch = session_with()
        self.assertEqual(await session.file_block(DELETE_HEADER, DELETE_FILE, MUSIC_DELETE_FILE), bytes([1, 1, 0, 9]))

    async def test_music_inventory_reads_every_block(self):
        music = bytes((i * 7) & 255 for i in range(620))
        session, watch = session_with({'music': music})
        self.assertEqual(await session.music_inventory_page(0), music)
        self.assertIsNone(session.music_queue)
        with self.assertRaises(ProtocolError): await session.music_inventory_page(256)

    def test_music_request_frames(self):
        frames = MusicPageReceiver(3, now=1_388_534_400 + 100, utc_offset=-18000).request_frames()
        payload = b''.join(f[2:] for f in frames)[:-1]
        self.assertEqual(payload[0], 93); self.assertEqual(int.from_bytes(payload[6:10], 'little'), 100)
        self.assertEqual(payload[10], (-20) & 255); self.assertEqual(payload[11], 3)
        self.assertEqual(int.from_bytes(payload[16:20], 'little'), 3)

    async def test_notification_fragments(self):
        session, watch = session_with()
        frames = [bytes([0x79, 1, 0x85]) + b'hello', bytes([0x79, 0, 0x05]) + b'world']
        import base64
        await session.send_notification([base64.b64encode(f).decode() for f in frames])
        self.assertEqual(watch.control_writes, frames)
        with self.assertRaisesRegex(ProtocolError, 'sequence'):
            await session.send_notification([base64.b64encode(bytes([0x79, 0, 0x05]) + b'x').decode()])

    def test_watch_events(self):
        session, watch = session_with()
        body = bytes([3, 1]); session.notification(watch.channels['control'], bytes([0xc5, 0]) + body + bytes([sum(body) & 255]))
        self.assertEqual(session.state['watchEvents'][0]['kind'], 'media-control')
        self.assertIsNone(decode_watch_interaction(b'\xc5\x00\x09\x01\x0a'))
        session.disconnected(None); self.assertNotIn('watchEvents', session.state)

    def test_usb_access_events(self):
        session, watch = session_with()
        emitted = []
        with mock.patch.object(worker, 'emit', emitted.append):
            session.notification(watch.channels['control'], bytes([0x0d, 0, 0x11, 1, 0, 0x12]))
            session.notification(watch.channels['control'], bytes([0x0d, 0, 0x11, 1, 1, 0x13]))
            session.notification(watch.channels['control'], bytes([0x0d, 0, 0x11, 1, 0, 0x13]))
        self.assertEqual(emitted, [{'event': 'usb-access-request'}, {'event': 'usb-access-closed'}])
        self.assertNotIn('watchEvents', session.state)
        self.assertIsNone(decode_usb_access(b'\x0d\x00\x11\x01\x02\x14'))


if __name__ == '__main__': unittest.main()
