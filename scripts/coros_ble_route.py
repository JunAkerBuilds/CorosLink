"""Bounded SFT file blocks (routes, watch faces, music deletes); no credentials or UI-visible raw GATT API.

Mirrors the CoreBluetooth helper's `validFileBlock` and file acknowledgements, so Windows and
Linux send the same bytes as macOS.
"""
import asyncio
import binascii
from coros_ble_protocol import ProtocolError

ROUTE_FILE, WATCHFACE_FILE, MUSIC_DELETE_FILE = 0x14, 8, 93
NAMES = {ROUTE_FILE: 'route', WATCHFACE_FILE: 'watch face', MUSIC_DELETE_FILE: 'music delete'}


def little(data, offset, size):
    return int.from_bytes(data[offset:offset + size], 'little')


def validate_file_block(header, block, file_index):
    # Imported lazily: the music module imports this one for `little`.
    from coros_ble_music import valid_music_delete_file
    limit = 0x320000 if file_index == WATCHFACE_FILE else 2_000_000
    if (file_index not in NAMES or len(header) != 21 or header[:3] != bytes([0x78, 0, file_index]) or
            not 0 < len(block) <= 4096 or little(header, 7, 2) != len(block) or
            little(header, 9, 4) < len(block) or little(header, 9, 4) > limit or
            little(header, 3, 4) + little(header, 9, 4) > limit or
            (file_index == WATCHFACE_FILE and header[16] >= 10) or
            (file_index == MUSIC_DELETE_FILE and (header[16] != 0 or little(header, 3, 4) != 0 or
                                                  little(header, 9, 4) != len(block) or not valid_music_delete_file(block))) or
            header[17:20] != b'\x00\x00\x03' or
            sum(header[2:20]) & 255 != header[20] or sum(block) & 255 != header[15] or
            binascii.crc_hqx(block, 0xffff) != little(header, 13, 2)):
        raise ProtocolError('Invalid COROS ' + NAMES.get(file_index, 'file') + ' block.')


def validate_block(header, block):
    validate_file_block(header, block, ROUTE_FILE)


async def send_file_block(header, block, queue, write_control, write_bulk, maximum, file_index, on_frame=None):
    """Sends one block: the header on control, data frames on bulk, then waits for the watch's acknowledgement.
    Other control frames (such as music storage replies) go to `on_frame`."""
    validate_file_block(header, block, file_index)
    name = NAMES[file_index]
    if maximum < 21:
        raise ProtocolError('Bluetooth packet size is too small for ' + name + ' sync. Reconnect the watch to negotiate a larger MTU.')

    def done(value):
        return value[2] == 1 and (value[6] == 1 if len(value) == 9 else value[4] == file_index)

    async def answer(stage):
        while True:
            value = await queue.get()
            if value is None:
                raise ProtocolError('The watch disconnected during ' + name + ' sync.')
            if not value or value[0] != 0x78:
                if value and on_frame is not None:
                    on_frame(value)
                continue
            if len(value) not in (6, 9) or value[1] != 0 or sum(value[2:-1]) & 255 != value[-1]:
                raise ProtocolError('Invalid COROS ' + name + ' acknowledgement.')
            if stage == 'ready':
                if done(value):
                    return None  # Watch verified a block retained from an interrupted transfer.
                if len(value) != 9 or value[2] not in (0, 1) or value[6] != 1 or value[4] < 20:
                    raise ProtocolError('The watch rejected the ' + name + ' block header.')
                return min(maximum, value[4], 240)
            if not done(value):
                raise ProtocolError('The watch rejected the ' + name + ' data block.')
            return None

    await write_control(header)
    size = await asyncio.wait_for(answer('ready'), 15)
    if size is None:
        return
    payload_size = size - 3
    if payload_size < 17 or (len(block) + payload_size - 1) // payload_size > 256:
        raise ProtocolError('The ' + name + ' block exceeds the negotiated packet limit.')
    for sequence, offset in enumerate(range(0, len(block), payload_size)):
        await write_bulk(bytes([0x78, sequence, file_index]) + block[offset:offset + payload_size])
        # Bound queues on adapters without an exposed native flow-control callback.
        await asyncio.sleep(0.003)
    await asyncio.wait_for(answer('complete'), 20)


async def send_route_block(header, block, queue, write_control, write_bulk, maximum):
    await send_file_block(header, block, queue, write_control, write_bulk, maximum, ROUTE_FILE)
