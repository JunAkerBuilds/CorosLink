"""Read-only music metadata pages and the music delete reply, ported from the CoreBluetooth helper.

Storage category 0, SFT file 93. The page receiver cannot request an audio file, upload a
file, or delete a track; deletes go through the bounded file-93 block in coros_ble_route.
"""
import binascii
import datetime
import time
from coros_ble_protocol import ProtocolError
from coros_ble_route import little

MUSIC_FILE = 93
# Mobile's epoch is 2014-01-01.
MOBILE_EPOCH = 1_388_534_400


def integer(value, size):
    return (value & ((1 << (8 * size)) - 1)).to_bytes(size, 'little')


def crc16(data):
    return binascii.crc_hqx(bytes(data), 0xffff)


def music_frames(opcode, payload):
    """18-byte fragments with a trailing SUM, as the music commands use on any write size."""
    logical = bytes(payload) + bytes([sum(payload) & 255])
    count = (len(logical) + 17) // 18
    return [bytes([opcode, count - index - 1]) + logical[offset:offset + 18]
            for index, offset in enumerate(range(0, len(logical), 18))]


class MusicPageResult:
    def __init__(self, frames=None, bulk=False, payload=None):
        self.frames = frames or []
        self.bulk = bulk
        self.payload = payload


class MusicPageReceiver:
    def __init__(self, page, now=None, utc_offset=None):
        self.page = page
        self.now = now
        self.utc_offset = utc_offset
        self.file = bytearray()
        self.block = bytearray()
        self.header = b''
        self.control = bytearray()
        self.control_remaining = None
        self.sequence = 0
        self.stage = 'header'
        self.total = None

    def request_frames(self):
        seconds = int(self.now if self.now is not None else time.time()) - MOBILE_EPOCH
        offset = self.utc_offset if self.utc_offset is not None else \
            int(datetime.datetime.now().astimezone().utcoffset().total_seconds())
        zone = int(offset / 900)  # Fifteen-minute units, truncated like Swift's Int division.
        payload = (bytes([MUSIC_FILE]) + integer(len(self.file), 4) + b'\0' + integer(seconds, 4) +
                   bytes([zone & 255, 3]) + integer(0, 4) + integer(self.page, 4))
        return music_frames(0x7c, payload)

    def accept(self, data, control):
        data = bytes(data)
        if control:
            opcode = 0x7d if self.stage == 'ack' else 0x7c
            if not data or data[0] != opcode:
                return MusicPageResult()
            if len(data) < 3 or not (self.control_remaining is None or
                                     (self.control_remaining > 0 and data[1] == self.control_remaining - 1)):
                raise ProtocolError('Invalid music inventory frame.')
            self.control_remaining = data[1]
            self.control.extend(data[2:])
            if len(self.control) > 512:
                raise ProtocolError('Invalid music inventory frame.')
            if data[1] != 0:
                return MusicPageResult()
            if sum(self.control[:-1]) & 255 != self.control[-1]:
                raise ProtocolError('Invalid music inventory checksum.')
            payload = bytes(self.control[:-1])
            self.control = bytearray()
            self.control_remaining = None
            if self.stage == 'ack':
                if payload != bytes([1, MUSIC_FILE]):
                    raise ProtocolError('Invalid music inventory acknowledgement.')
                if len(self.file) == self.total:
                    return MusicPageResult(payload=bytes(self.file))
                self.stage = 'header'
                return MusicPageResult(frames=self.request_frames())
            if not (self.stage == 'header' and len(payload) >= 19 and payload[12] == 0 and
                    payload[15] == MUSIC_FILE and payload[16] == 3):
                raise ProtocolError('Invalid music inventory header.')
            size, remaining = little(payload, 4, 2), little(payload, 6, 4)
            if not (0 < size <= 12_288 and size <= remaining and remaining <= 262_144 and
                    payload[13] >= 20 and payload[14] > 0):
                raise ProtocolError('Invalid music inventory header.')
            if self.total is not None:
                if len(self.file) + remaining != self.total:
                    raise ProtocolError('Invalid music inventory length.')
            else:
                self.total = remaining
            self.header = payload
            self.block = bytearray()
            self.sequence = 0
            self.stage = 'bulk'
            # Window requests use the bulk channel and have no SUM byte.
            return MusicPageResult(frames=[bytes([0x7c, 0, MUSIC_FILE])], bulk=True)
        if len(data) < 3 or data[0] != 0x7c or data[2] != MUSIC_FILE:
            return MusicPageResult()
        if not (self.stage == 'bulk' and len(data) > 3 and data[1] == self.sequence and
                len(data) <= self.header[13] and len(self.block) + len(data) - 3 <= little(self.header, 4, 2)):
            raise ProtocolError('Invalid music inventory data.')
        self.block.extend(data[3:])
        self.sequence += 1
        if len(self.block) == little(self.header, 4, 2):
            if crc16(self.block) != little(self.header, 10, 2):
                raise ProtocolError('Invalid music inventory checksum.')
            # The success bit acknowledges metadata; category 0 at +12 releases its temporary
            # listing cache. It does not delete stored music.
            ack = integer(len(self.file), 4) + bytes([1, MUSIC_FILE]) + bytes(10)
            self.file.extend(self.block)
            self.stage = 'ack'
            return MusicPageResult(frames=music_frames(0x7d, ack))
        if self.sequence == self.header[14]:
            self.sequence = 0
            return MusicPageResult(frames=[bytes([0x7c, 0, MUSIC_FILE])], bulk=True)
        return MusicPageResult()


class MusicDeleteReceiver:
    """A music delete completes only after both the SFT transfer and storage command C1."""

    def __init__(self):
        self.file_acknowledged = False
        self.storage = None
        self.bytes = bytearray()
        self.remaining = None

    @property
    def result(self):
        return self.storage if self.file_acknowledged else None

    def accept_storage(self, frame):
        frame = bytes(frame)
        if not (len(frame) >= 3 and frame[0] == 0xc1 and self.storage is None and
                (self.remaining is None or (self.remaining > 0 and frame[1] == self.remaining - 1))):
            raise ProtocolError('The watch returned an invalid music delete response.')
        self.remaining = frame[1]
        self.bytes.extend(frame[2:])
        if len(self.bytes) > 5:
            raise ProtocolError('The watch returned an invalid music delete response.')
        if frame[1] == 0:
            if not (len(self.bytes) == 5 and self.bytes[0] == 1 and self.bytes[1] == 1 and self.bytes[2] == 0 and
                    sum(self.bytes[:-1]) & 255 == self.bytes[-1]):
                raise ProtocolError('The watch returned an invalid music delete response.')
            self.storage = bytes(self.bytes[:-1])


def valid_music_delete_file(file):
    """Exactly one local MP3 row, category 0, at most 512 bytes."""
    file = bytes(file)
    if not 48 <= len(file) <= 512:
        return False
    proto = file[48:]
    if not (file[0:4] == bytes([0x48, 0x46, 0, MUSIC_FILE]) and little(file, 8, 4) == len(file) - 16 and
            crc16(file[0:14]) == little(file, 14, 2) and crc16(file[16:]) == little(file, 12, 2) and
            file[16:24] == bytes([0x48, 0x53, 0, 0, 0, 0, 0, 0]) and little(file, 26, 2) == 44 and
            little(file, 30, 4) == len(file) - 44 and little(file, 34, 4) == len(file) - 44 and
            little(file, 38, 4) == 1 and crc16(file[16:42]) == little(file, 42, 2) and
            little(file, 44, 4) == len(proto) and crc16(proto) == little(file, 24, 2)):
        return False
    offset = 0

    def varint():
        nonlocal offset
        value = 0
        for index in range(5):
            if offset >= len(proto):
                return None
            byte = proto[offset]
            offset += 1
            value |= (byte & 127) << (index * 7)
            if byte & 128 == 0:
                return value if value <= 0xffffffff else None
        return None

    if varint() != 10:
        return False
    size = varint()
    if size is None or size != len(proto) - offset:
        return False
    fields = set()
    while offset < len(proto):
        key = varint()
        if key not in (8, 16, 26, 32) or key in fields:
            return False
        fields.add(key)
        if key == 26:
            count = varint()
            if count is None or not 0 < count <= 259 or count > len(proto) - offset:
                return False
            try:
                path = proto[offset:offset + count].decode('utf-8')
            except UnicodeDecodeError:
                return False
            prefix = '/emmc2:/Music/'
            if not path.startswith(prefix):
                return False
            name = path[len(prefix):]
            if not name.lower().endswith('.mp3') or '/' in name or '\\' in name or any(ord(c) < 32 for c in name):
                return False
            offset += count
        else:
            value = varint()
            if value is None or (key == 8 and value != 1):
                return False
    return len(fields) == 4


def decode_watch_interaction(data):
    """Only the bounded unsolicited events traced in the W332 firmware; nothing else enters UI state."""
    data = bytes(data)
    if len(data) < 4 or data[1] != 0 or sum(data[2:-1]) & 255 != data[-1]:
        return None
    if data[0] == 0xc5 and len(data) == 5 and 1 <= data[2] <= 7:
        return {'kind': 'media-control', 'action': data[2], 'value': data[3]}
    if data[0] == 2 and len(data) == 4 and data[2] == 2:
        return {'kind': 'call-rejected'}
    return None
