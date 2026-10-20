"""Read-only SyncData (0x7C) block reads for local activity sync.

Generalises the validated music-inventory reader (coros_ble_music.MusicPageReceiver) to
the sport-record file. One request reads and CRC-checks one block and returns it.
Nothing is ever acknowledged (the phone app's 0x7D moves the watch's sync pointer), so
there is no acknowledgement here. Only the files in READ_ONLY_SYNC_FILES can be
requested; nothing here can write or delete on the watch.
Mirrors electron/localSync/activityProtocol.ts and the CoreBluetooth helper; the
shared vectors live in scripts/fixtures/coros-sync-file-vectors.json.
"""
import binascii
import datetime
import time
from coros_ble_protocol import ProtocolError

SPORT_RECORD_FILE = 14
DAILY_DATA_FILE = 5
READ_ONLY_SYNC_FILES = frozenset({SPORT_RECORD_FILE, DAILY_DATA_FILE})
MAX_BLOCK_BYTES = 12_288
MAX_FILE_BYTES = 64 * 1024 * 1024
MOBILE_EPOCH = 1_388_534_400


def integer(value, size):
    return (value & ((1 << (8 * size)) - 1)).to_bytes(size, 'little')


def little(data, offset, size):
    return int.from_bytes(data[offset:offset + size], 'little')


def sync_frames(opcode, payload):
    """18-byte fragments with a trailing SUM, as the SyncData commands use on any write size."""
    logical = bytes(payload) + bytes([sum(payload) & 255])
    count = (len(logical) + 17) // 18
    return [bytes([opcode, count - index - 1]) + logical[offset:offset + 18]
            for index, offset in enumerate(range(0, len(logical), 18))]


def valid_request(file_index, offset, selector=0):
    return (isinstance(file_index, int) and not isinstance(file_index, bool) and file_index in READ_ONLY_SYNC_FILES and
            isinstance(offset, int) and not isinstance(offset, bool) and 0 <= offset < MAX_FILE_BYTES and
            isinstance(selector, int) and not isinstance(selector, bool) and 0 <= selector <= 0xffffffff)


def request_payload(file_index, offset, selector, now=None, utc_offset=None):
    seconds = int(now if now is not None else time.time()) - MOBILE_EPOCH
    offset_seconds = utc_offset if utc_offset is not None else \
        int(datetime.datetime.now().astimezone().utcoffset().total_seconds())
    zone = int(offset_seconds / 900)  # Fifteen-minute units, truncated toward zero.
    return (bytes([file_index]) + integer(offset, 4) + b'\0' + integer(seconds, 4) +
            bytes([zone & 255, 3]) + integer(0, 4) + integer(selector, 4))


class SyncResult:
    def __init__(self, frames=None, bulk=False, payload=None):
        self.frames = frames or []
        self.bulk = bulk
        self.payload = payload


class _ControlReply:
    """Reassembles one SUM-checked control reply for a single opcode."""

    def __init__(self, opcode, limit):
        self.opcode = opcode
        self.limit = limit
        self.remaining = None
        self.data = bytearray()

    def accept(self, data):
        if not data or data[0] != self.opcode:
            return None
        if len(data) < 3 or not (self.remaining is None or (self.remaining > 0 and data[1] == self.remaining - 1)):
            raise ProtocolError('Invalid watch sync frame.')
        self.remaining = data[1]
        self.data.extend(data[2:])
        if len(self.data) > self.limit:
            raise ProtocolError('Invalid watch sync frame.')
        if data[1] != 0:
            return None
        if sum(self.data[:-1]) & 255 != self.data[-1]:
            raise ProtocolError('Invalid watch sync checksum.')
        payload = bytes(self.data[:-1])
        self.data = bytearray()
        self.remaining = None
        return payload


class SyncBlockReceiver:
    """Header → bulk windows → one verified block. Returns [remaining u32][block]; never acknowledges."""

    def __init__(self, file_index, offset, selector=0, now=None, utc_offset=None):
        if not valid_request(file_index, offset, selector):
            raise ProtocolError('The watch sync request is invalid.')
        self.file_index = file_index
        self.offset = offset
        self.selector = selector
        self.now = now
        self.utc_offset = utc_offset
        self.control = _ControlReply(0x7c, 512)
        self.header = b''
        self.block = bytearray()
        self.sequence = 0
        self.stage = 'header'

    def request_frames(self):
        return sync_frames(0x7c, request_payload(self.file_index, self.offset, self.selector, self.now, self.utc_offset))

    def window_request(self):
        # Window requests use the bulk channel and have no SUM byte.
        return SyncResult(frames=[bytes([0x7c, 0, self.file_index])], bulk=True)

    def accept(self, data, control):
        data = bytes(data)
        if control:
            payload = self.control.accept(data)
            if payload is None:
                return SyncResult()
            if not (self.stage == 'header' and len(payload) >= 19 and payload[12] == 0 and
                    payload[15] == self.file_index and payload[16] == 3):
                raise ProtocolError('Invalid watch sync header.')
            size, remaining = little(payload, 4, 2), little(payload, 6, 4)
            if not (0 < size <= MAX_BLOCK_BYTES and size <= remaining <= MAX_FILE_BYTES and
                    self.offset + remaining <= MAX_FILE_BYTES and payload[13] >= 20 and payload[14] > 0):
                raise ProtocolError('Invalid watch sync header.')
            self.header = payload
            self.block = bytearray()
            self.sequence = 0
            self.stage = 'bulk'
            return self.window_request()
        if len(data) < 3 or data[0] != 0x7c or data[2] != self.file_index:
            return SyncResult()
        size = little(self.header, 4, 2) if self.header else 0
        if not (self.stage == 'bulk' and len(data) > 3 and data[1] == self.sequence and
                len(data) <= self.header[13] and len(self.block) + len(data) - 3 <= size):
            raise ProtocolError('Invalid watch sync data.')
        self.block.extend(data[3:])
        self.sequence += 1
        if len(self.block) == size:
            if binascii.crc_hqx(bytes(self.block), 0xffff) != little(self.header, 10, 2):
                raise ProtocolError('Invalid watch sync checksum.')
            self.stage = 'done'
            return SyncResult(payload=integer(little(self.header, 6, 4), 4) + bytes(self.block))
        if self.sequence == self.header[14]:
            self.sequence = 0
            return self.window_request()
        return SyncResult()
