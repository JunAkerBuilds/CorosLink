"""Read-only SyncData block reads (local activity sync) on the Windows/Linux worker, against
shared golden vectors and a fake watch. Run from scripts/: python3 test-coros-ble-activity.py"""
import asyncio, binascii, importlib.util, json, sys, unittest
from pathlib import Path
from types import SimpleNamespace
from coros_ble_protocol import ProtocolError
import coros_ble_activity
from coros_ble_activity import DAILY_DATA_FILE, SPORT_RECORD_FILE, SyncBlockReceiver, request_payload, sync_frames

sys.modules.setdefault('bleak', SimpleNamespace(BleakClient=object, BleakScanner=object))
spec = importlib.util.spec_from_file_location('system_ble', Path(__file__).with_name('coros-system-ble.py'))
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)

VECTORS = json.loads((Path(__file__).parent / 'fixtures' / 'coros-sync-file-vectors.json').read_text())


class GoldenVectorTests(unittest.TestCase):
    def test_request_frames_match_typescript(self):
        for vector in VECTORS['requests']:
            payload = request_payload(vector['fileIndex'], vector['offset'], vector['selector'],
                                      vector['now'], vector['utcOffsetSeconds'])
            self.assertEqual(payload.hex(), vector['payload'])
            receiver = SyncBlockReceiver(vector['fileIndex'], vector['offset'], vector['selector'],
                                         vector['now'], vector['utcOffsetSeconds'])
            self.assertEqual([frame.hex() for frame in receiver.request_frames()], vector['frames'])

    def test_no_acknowledgement_anywhere(self):
        # Acknowledging (0x7D) moves the watch's sync pointer; neither worker can send one.
        for name in ('SyncAckReceiver', 'ack_payload', 'ACKNOWLEDGEABLE_SYNC_FILES'):
            self.assertFalse(hasattr(coros_ble_activity, name), name)
        self.assertFalse(hasattr(worker.SystemSession, 'sync_file_ack'))
        self.assertNotIn('syncFileAck', worker.CAPTURE_OPERATIONS)
        source = Path(__file__).with_name('coros-system-ble.py').read_text()
        self.assertNotIn('syncFileAck', source)
        self.assertIn("raise ProtocolError('Unsupported Bluetooth operation.')", source)
        self.assertNotIn('acks', VECTORS)

    def test_block_scenario(self):
        vector = VECTORS['block']
        receiver = SyncBlockReceiver(vector['fileIndex'], vector['offset'], 0, 0, 0)
        windows = 0
        payload = None
        for frame in vector['headerFrames']:
            result = receiver.accept(bytes.fromhex(frame), True)
            if result.frames:
                self.assertTrue(result.bulk)
                self.assertEqual(result.frames[0].hex(), vector['windowRequest'])
                windows += 1
        for frame in vector['bulkFrames']:
            result = receiver.accept(bytes.fromhex(frame), False)
            if result.frames:
                windows += 1
            if result.payload is not None:
                payload = result.payload
        self.assertEqual(windows, vector['expectedWindowRequests'])
        self.assertEqual(payload.hex(), vector['expectedPayload'])

    def test_only_read_only_files(self):
        for file_index in (93, 8, 0x14, -1, True):
            with self.assertRaises(ProtocolError):
                SyncBlockReceiver(file_index, 0)
        SyncBlockReceiver(DAILY_DATA_FILE, 0)  # the daily file can be read
        with self.assertRaises(ProtocolError):
            SyncBlockReceiver(SPORT_RECORD_FILE, -1)
        with self.assertRaises(ProtocolError):
            SyncBlockReceiver(SPORT_RECORD_FILE, 64 * 1024 * 1024)

    def test_rejects_corrupt_or_oversized_data(self):
        vector = VECTORS['block']
        header_frames = [bytes.fromhex(frame) for frame in vector['headerFrames']]
        bulk = [bytes.fromhex(frame) for frame in vector['bulkFrames']]

        def fresh():
            receiver = SyncBlockReceiver(SPORT_RECORD_FILE, 0, 0, 0, 0)
            for frame in header_frames:
                receiver.accept(frame, True)
            return receiver

        corrupt = bytearray(bulk[2]); corrupt[-1] ^= 1
        receiver = fresh(); receiver.accept(bulk[0], False); receiver.accept(bulk[1], False)
        with self.assertRaises(ProtocolError):
            receiver.accept(bytes(corrupt), False)
        receiver = fresh()
        with self.assertRaises(ProtocolError):  # out of sequence
            receiver.accept(bulk[1], False)
        # A header announcing an oversized block or a different file is refused.
        payload = bytearray(19); payload[4:6] = (12_289).to_bytes(2, 'little'); payload[6:10] = (20_000).to_bytes(4, 'little')
        payload[13] = 20; payload[14] = 1; payload[15] = SPORT_RECORD_FILE; payload[16] = 3
        with self.assertRaises(ProtocolError):
            for frame in sync_frames(0x7c, bytes(payload)):
                SyncBlockReceiver(SPORT_RECORD_FILE, 0).accept(frame, True)
        payload[4:6] = (10).to_bytes(2, 'little'); payload[15] = 93
        receiver = SyncBlockReceiver(SPORT_RECORD_FILE, 0)
        with self.assertRaises(ProtocolError):
            for frame in sync_frames(0x7c, bytes(payload)):
                receiver.accept(frame, True)


class FakeSportWatch:
    """Serves file 14 in blocks; counts acknowledgements and never deletes anything."""

    def __init__(self, session, content, block=4096, packet=180, window=4):
        self.session = session; self.content = content; self.block = block; self.packet = packet; self.window = window
        self.pending = b''; self.position = 0; self.acks = []; self.requests = []
        self.control_char = SimpleNamespace(max_write_without_response_size=244)
        self.bulk_char = SimpleNamespace(max_write_without_response_size=244)
        self.is_connected = True
        self.services = SimpleNamespace(get_characteristic=lambda uuid: self.bulk_char if 'e50e24dcca9e' in uuid else self.control_char)
        self.channels = {name: {'name': name, 'notifications': 0, 'receivedBytes': 0} for name in ('control', 'bulk')}
        self.control_buffer = bytearray()

    def reply(self, channel, value):
        self.session.notification(self.channels[channel], value)

    async def write_gatt_char(self, char, value, response):
        value = bytes(value)
        if char is self.control_char:
            self.control_buffer.extend(value[2:])
            if value[1] != 0:
                return
            logical, self.control_buffer = bytes(self.control_buffer[:-1]), bytearray()
            if value[0] == 0x7c:
                offset = int.from_bytes(logical[1:5], 'little')
                self.requests.append(offset)
                self.pending = self.content[offset:offset + self.block]; self.position = 0
                header = bytearray(19)
                header[4:6] = len(self.pending).to_bytes(2, 'little')
                header[6:10] = (len(self.content) - offset).to_bytes(4, 'little')
                header[10:12] = binascii.crc_hqx(self.pending, 0xffff).to_bytes(2, 'little')
                header[13] = self.packet; header[14] = self.window; header[15] = SPORT_RECORD_FILE; header[16] = 3
                for frame in sync_frames(0x7c, bytes(header)):
                    self.reply('control', frame)
            elif value[0] == 0x7d:
                self.acks.append(int.from_bytes(logical[0:4], 'little'))
                for frame in sync_frames(0x7d, bytes([1, SPORT_RECORD_FILE])):
                    self.reply('control', frame)
        elif value == bytes([0x7c, 0, SPORT_RECORD_FILE]):
            for sequence in range(self.window):
                chunk = self.pending[self.position:self.position + self.packet - 3]
                if not chunk:
                    break
                self.position += len(chunk)
                self.reply('bulk', bytes([0x7c, sequence, SPORT_RECORD_FILE]) + chunk)


def session_with(content, **options):
    session = worker.SystemSession()
    watch = FakeSportWatch(session, content, **options)
    session.client = watch; session.write = watch.control_char
    session.state.update(connected=True, channels=list(watch.channels.values()))
    return session, watch


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_reads_every_block_without_acknowledging(self):
        content = bytes((index * 13 + 5) & 255 for index in range(10_000))
        session, watch = session_with(content)
        received = bytearray()
        offset = 0
        while offset < len(content):
            payload = await session.sync_file_block(SPORT_RECORD_FILE, offset, 0)
            remaining = int.from_bytes(payload[:4], 'little')
            self.assertEqual(remaining, len(content) - offset)
            received.extend(payload[4:])
            offset += len(payload) - 4
        self.assertEqual(bytes(received), content)
        self.assertEqual(watch.acks, [], 'the watch never sees a 0x7D')
        self.assertEqual(watch.requests, [0, 4096, 8192])

    async def test_resumes_from_an_offset(self):
        content = bytes(range(256)) * 40
        session, watch = session_with(content)
        payload = await session.sync_file_block(SPORT_RECORD_FILE, 8192, 0)
        self.assertEqual(payload[4:], content[8192:])
        self.assertEqual(watch.requests, [8192])

    async def test_refuses_other_files_before_writing(self):
        session, watch = session_with(b'x' * 100)
        with self.assertRaises(ProtocolError):
            await session.sync_file_block(93, 0, 0)
        self.assertEqual(watch.requests, [])

    async def test_capture_records_every_frame_both_ways(self):
        content = bytes(range(200))
        session, watch = session_with(content, block=4096, packet=60, window=2)
        session.start_capture(True)
        payload = await session.sync_file_block(SPORT_RECORD_FILE, 0, 0)
        frames = session.capture
        self.assertEqual(payload[4:], content)
        kinds = [(frame['d'], frame['c']) for frame in frames]
        self.assertEqual(kinds[0], ('tx', 'control'))  # the request
        self.assertIn(('rx', 'control'), kinds)       # the header
        self.assertIn(('tx', 'bulk'), kinds)          # window requests
        received = b''.join(bytes.fromhex(frame['x'])[3:] for frame in frames if frame['d'] == 'rx' and frame['c'] == 'bulk')
        self.assertEqual(received, content)
        self.assertTrue(all(isinstance(frame['t'], int) for frame in frames))
        session.start_capture(False)
        await session.sync_file_block(SPORT_RECORD_FILE, 0, 0)
        self.assertIsNone(session.capture, 'nothing is recorded unless asked')

    async def test_capture_is_bounded(self):
        session, watch = session_with(b'z' * 12_000, block=12_000, packet=200, window=255)
        session.start_capture(True)
        for offset in range(0, 12_000 * 6, 12_000):
            watch.content = b'z' * (12_000 * 6)
            await session.sync_file_block(SPORT_RECORD_FILE, offset, 0)
        self.assertLessEqual(sum(len(frame['x']) for frame in session.capture), 120_000 + 2 * 255)

    async def test_disconnect_fails_the_read(self):
        session, watch = session_with(b'y' * 5000)
        watch.reply = lambda channel, value: session.disconnected(None)
        with self.assertRaises(ProtocolError):
            await session.sync_file_block(SPORT_RECORD_FILE, 0, 0)


if __name__ == '__main__':
    unittest.main()
