#!/usr/bin/env python3
"""Windows WinRT / Linux BlueZ GATT transport. BlueZ pairs natively while
connecting; Windows pairs only when the watch refuses an unpaired request.

JSON operations arrive only over Electron's private stdin. This worker never
receives account keys. Notifications and control replies stay in the parent pipe.
It supports the same operations as the macOS CoreBluetooth helper
(native/corebluetooth/main.swift), apart from the development-only OTA blocks.
"""
import asyncio
import base64
import json
import logging
import os
import re
import signal
import sys
import time
import traceback

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakBluetoothNotAvailableError, BleakError, BleakGATTProtocolError, BleakGATTProtocolErrorCode
from coros_ble_protocol import Decoder, ProtocolError, frames
from coros_ble_route import MUSIC_DELETE_FILE, ROUTE_FILE, WATCHFACE_FILE, send_file_block
from coros_ble_music import MusicDeleteReceiver, MusicPageReceiver, decode_watch_interaction

CHANNELS = {
    'control': '6e400001-b5a3-f393-e0a9-77656c6f6f70',
    'bulk': '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    'auxiliary': '6e400001-b5a3-f393-e0a9-77757c7f7f70',
}
READS = {'deviceNameValue': '2a00', 'batteryPercent': '2a19', 'modelNumber': '2a24',
         'serialNumber': '2a25', 'firmwareRevision': '2a26', 'hardwareRevision': '2a27',
         'softwareRevision': '2a28', 'manufacturerName': '2a29'}


def standard_uuid(short):
    return '0000' + short + '-0000-1000-8000-00805f9b34fb'


FILE_OPERATIONS = {'routeBlock': ROUTE_FILE, 'watchfaceBlock': WATCHFACE_FILE, 'musicDelete': MUSIC_DELETE_FILE}
# GATT errors a watch returns until the link is paired: insufficient
# authentication, authorization, encryption key size and encryption.
PAIRING_REQUIRED_CODES = {0x05, 0x08, 0x0c, 0x0f}
# What a connect was doing when it failed, for the error message.
STEPS = {'scan': 'scanning for the watch', 'connect': 'connecting to the watch',
         'pair': 'pairing with the watch', 'subscribe': 'turning on watch notifications'}
# bleak messages without device details, reported as they are.
FIXED_REASONS = {'Device does not support pairing': 'pairing not supported',
                 'device does not support GATT sessions': 'GATT sessions not supported',
                 'Failure trying to pair with device!': 'pairing request failed',
                 'Not connected': 'not connected'}


def pairing_required(error):
    """Whether the watch refused a GATT request until Windows pairs with it."""
    if isinstance(error, BleakGATTProtocolError):
        return error.args[0] in PAIRING_REQUIRED_CODES
    return isinstance(error, BleakError) and str(error).endswith(': Access Denied')


def failure_reason(error):
    """A short label for a Bluetooth stack failure. Only timeouts, GATT codes,
    WinRT status names and bleak's fixed messages are used: other bleak text can
    carry device addresses, so it is reported by exception class alone."""
    if isinstance(error, asyncio.TimeoutError):
        return 'timed out'
    if isinstance(error, BleakGATTProtocolError):
        try:
            return 'GATT ' + BleakGATTProtocolErrorCode(error.args[0]).name.lower().replace('_', ' ')
        except ValueError:
            return f'GATT error 0x{error.args[0]:02X}'
    if isinstance(error, BleakBluetoothNotAvailableError):
        return 'Bluetooth ' + error.reason.name.lower().replace('_', ' ')
    text = str(error)
    match = (re.search(r': (Unreachable|Access Denied|Unexpected status code 0x[0-9A-F]{2})$', text) or
             re.fullmatch(r'Could not pair with device: ([A-Z_]+)', text))
    if match:
        return match.group(1).replace('_', ' ').lower()
    return FIXED_REASONS.get(text, type(error).__name__)


def failure_message(step, reason, windows):
    where = f' while {STEPS[step]}' if step in STEPS else ''
    if not windows:
        hint = ('Check that Bluetooth is on, the watch is awake, and any OS pairing prompt is confirmed. '
                'On Linux, BlueZ and a pairing agent must be running.')
    elif step == 'pair':
        hint = ('Confirm any Windows pairing prompt. If pairing keeps failing, remove the watch under '
                'Settings → Bluetooth & devices and try again.')
    elif step in ('connect', 'subscribe'):
        hint = ('Keep the watch awake and nearby. If it is listed under Settings → Bluetooth & devices '
                'from an earlier attempt, remove it there and try again.')
    else:
        hint = 'Check that Bluetooth is on and the watch is awake.'
    return f'System Bluetooth failed{where} ({reason}). {hint}'


class SystemSession:
    def __init__(self):
        # BlueZ pairs while connecting. Windows connects unpaired, like the macOS
        # helper, and pairs only when the watch asks for it (see connect).
        self.pair_on_connect = sys.platform != 'win32'
        self.step = None
        self.client = None
        self.queue = None
        # Music inventory reads listen on control and bulk: (is_control, bytes).
        self.music_queue = None
        self.interaction_sequence = 0
        self.write = None
        self.state = {'phase': 'idle', 'backend': 'system', 'connected': False,
                      'encrypted': False, 'pairingManagedByOS': True,
                      'transport': 'winrt' if sys.platform == 'win32' else 'bluez',
                      'systemBind': 'unavailable', 'channels': []}

    def disconnected(self, _client):
        self.state.update(phase='disconnected', connected=False, encrypted=False, systemBind='not_authenticated')
        self.state.pop('rssiDbm', None)
        self.state.pop('watchEvents', None)
        for channel in self.state['channels']:
            channel['subscribed'] = False
        if self.queue is not None and not self.queue.full():
            self.queue.put_nowait(None)
        if self.music_queue is not None and not self.music_queue.full():
            self.music_queue.put_nowait(None)

    async def discover(self, name=None):
        results = {}
        found = asyncio.get_running_loop().create_future()

        def report(device, advertisement):
            label = advertisement.local_name or device.name or ''
            if not label.startswith('COROS'):
                return
            results[device.address] = (device, label, advertisement.rssi)
            if name == label and not found.done():
                found.set_result(results[device.address])

        async with BleakScanner(report):
            if name is None:
                await asyncio.sleep(8)
            else:
                try:
                    return await asyncio.wait_for(found, 15)
                except asyncio.TimeoutError:
                    raise ProtocolError('The watch was not found. Open System → Pair Phone and keep it nearby.') from None
        return [{'deviceId': device.address, 'deviceName': label, 'rssiDbm': rssi}
                for device, label, rssi in sorted(results.values(), key=lambda row: row[1])]

    async def scan(self):
        self.state['phase'] = 'scanning'
        self.step = 'scan'
        self.state['discoveredDevices'] = await self.discover()
        self.step = None
        self.state['phase'] = 'idle'
        return self.state

    async def connect(self, name):
        if self.client:
            await self.close()
        if not isinstance(name, str) or not name.startswith('COROS'):
            raise ProtocolError('Find and select your COROS watch before connecting.')
        self.state.update(phase='connecting', systemBind='unavailable')
        self.step = 'scan'
        device, label, rssi = await self.discover(name)
        # The COROS channels work without an OS bond (the macOS helper never
        # bonds), and a watch can refuse a bond it was not asked for, so Windows
        # pairs only when a GATT request is refused below. No automatic unpair or
        # replacement of keys: reconnecting preserves any OS-managed bond.
        self.step = 'connect'
        self.client = BleakClient(device, disconnected_callback=self.disconnected, pair=self.pair_on_connect, timeout=60)
        await asyncio.wait_for(self.client.connect(), 75)
        self.write = self.client.services.get_characteristic(CHANNELS['control'].replace('0001', '0002', 1))
        if self.write is None:
            raise ProtocolError('This watch does not expose the supported COROS control channel.')
        self.state.update(deviceName=label, deviceId=device.address, rssiDbm=rssi, channels=[])
        try:
            await self.prepare()
        except Exception as error:
            if self.pair_on_connect or not pairing_required(error):
                raise
            self.step = 'pair'
            await asyncio.wait_for(self.client.pair(), 60)
            await self.prepare()
        if not self.client.is_connected:
            raise ProtocolError('The watch disconnected during setup.')
        self.step = None
        self.state.update(phase='connected', connected=True, maximumWriteBytes=self.write.max_write_without_response_size)
        return self.state

    async def prepare(self):
        """Device information and channel notifications. Repeated after pairing,
        so channels that are already subscribed are left as they are."""
        self.step = 'subscribe'
        for label, uuid in READS.items():
            char = self.client.services.get_characteristic(standard_uuid(uuid))
            if char is None or 'read' not in char.properties:
                continue
            try:
                data = await asyncio.wait_for(self.client.read_gatt_char(char), 15)
                if label == 'batteryPercent':
                    if len(data) == 1 and data[0] <= 100:
                        self.state[label] = data[0]
                else:
                    self.state[label] = data.decode('utf-8', errors='replace').rstrip('\0').strip()
            except Exception:
                continue
        for label, uuid in CHANNELS.items():
            notify = self.client.services.get_characteristic(uuid.replace('0001', '0003', 1))
            write = self.client.services.get_characteristic(uuid.replace('0001', '0002', 1))
            if notify is None or write is None:
                continue
            channel = next((item for item in self.state['channels'] if item['name'] == label), None)
            if channel is None:
                channel = {'name': label, 'serviceUuid': uuid, 'notifications': 0, 'receivedBytes': 0, 'subscribed': False}
                self.state['channels'].append(channel)
            if channel['subscribed']:
                continue
            await asyncio.wait_for(self.client.start_notify(notify, lambda sender, data, ch=channel: self.notification(ch, data)), 30)
            channel['subscribed'] = True

    def notification(self, channel, data):
        channel['notifications'] += 1
        channel['receivedBytes'] += len(data)
        channel['lastNotificationAt'] = int(time.time() * 1000)
        if channel['name'] in ('control', 'bulk') and self.music_queue is not None and not self.music_queue.full():
            self.music_queue.put_nowait((channel['name'] == 'control', bytes(data)))
        if channel['name'] != 'control':
            return
        event = decode_watch_interaction(data)
        if event is not None:
            self.interaction_sequence += 1
            event.update(id=self.interaction_sequence, receivedAt=int(time.time() * 1000))
            self.state['watchEvents'] = (self.state.get('watchEvents') or [])[-11:] + [event]
        if self.queue is not None and not self.queue.full():
            self.queue.put_nowait(bytes(data))

    async def exchange(self, payload, maximum, opcode=0xa5):
        if not self.client or not self.client.is_connected or self.write is None:
            raise ProtocolError('The watch is disconnected.')
        self.queue = asyncio.Queue(maxsize=64)
        decoder = Decoder(opcode)
        try:
            for frame in frames(opcode, payload, min(maximum, self.write.max_write_without_response_size, 255)):
                await self.client.write_gatt_char(self.write, frame, response=False)
                self.state['controlWrites'] = self.state.get('controlWrites', 0) + 1
            async def receive():
                while True:
                    value = await self.queue.get()
                    if value is None:
                        raise ProtocolError('The watch disconnected during COROS authentication.')
                    result = decoder.accept(value)
                    if result is not None:
                        return result
            return await asyncio.wait_for(receive(), 15)
        finally:
            self.queue = None

    async def status(self):
        if self.client and not self.client.is_connected:
            self.disconnected(self.client)
        # Bleak has no portable live RSSI API. Do not present a stale scan RSSI
        # as a live reading or infer an MTU from BlueZ's fixed mtu_size value.
        self.state.pop('rssiDbm', None)
        return self.state

    def connected_channels(self):
        if not self.client or not self.client.is_connected or self.write is None:
            raise ProtocolError('The watch is disconnected.')
        bulk = self.client.services.get_characteristic(CHANNELS['bulk'].replace('0001', '0002', 1))
        if bulk is None:
            raise ProtocolError('The COROS file transfer channel is unavailable.')
        return bulk

    async def write_control(self, value):
        await self.client.write_gatt_char(self.write, value, response=False)
        self.state['controlWrites'] = self.state.get('controlWrites', 0) + 1

    async def file_block(self, header, block, file_index):
        """One SFT block: routes (0x14), watch faces (8) and music deletes (93). Returns the
        storage reply for a music delete, which completes only after both acknowledgements."""
        bulk = self.connected_channels()
        self.queue = asyncio.Queue(maxsize=64)
        deletion = MusicDeleteReceiver() if file_index == MUSIC_DELETE_FILE else None
        try:
            async def data(value):
                await self.client.write_gatt_char(bulk, value, response=False)

            def other(value):
                if deletion is not None and value[0] == 0xc1:
                    deletion.accept_storage(value)
            await send_file_block(header, block, self.queue, self.write_control, data,
                                  min(self.write.max_write_without_response_size, bulk.max_write_without_response_size, 240),
                                  file_index, other)
            if deletion is None:
                return None
            deletion.file_acknowledged = True

            async def storage():
                while deletion.result is None:
                    value = await self.queue.get()
                    if value is None:
                        raise ProtocolError('The watch disconnected during music deletion.')
                    other(value)
                return deletion.result
            try:
                return await asyncio.wait_for(storage(), 20)
            except asyncio.TimeoutError:
                raise ProtocolError('The watch did not confirm music deletion.') from None
        finally:
            self.queue = None

    async def route_block(self, header, block):
        await self.file_block(header, block, ROUTE_FILE)

    async def send_notification(self, encoded):
        """CorosLink's notification fragments (0x79), already built in Electron; checked like the macOS helper."""
        if not self.client or not self.client.is_connected or self.write is None:
            raise ProtocolError('The notification request is invalid or the watch is disconnected.')
        if not isinstance(encoded, list) or not 0 < len(encoded) <= 256:
            raise ProtocolError('The notification request is invalid or the watch is disconnected.')
        maximum = min(self.write.max_write_without_response_size, 255)
        values, sequence = [], None
        for index, text in enumerate(encoded):
            frame = base64.b64decode(text, validate=True)
            if (not 4 <= len(frame) <= maximum or frame[0] != 0x79 or frame[1] != len(encoded) - index - 1 or
                    (frame[2] & 0x80) != (0x80 if index == 0 else 0)):
                raise ProtocolError('Invalid notification fragment sequence.')
            if index == 0:
                sequence = frame[2] & 0x7f
            if frame[2] & 0x7f != sequence:
                raise ProtocolError('Invalid notification message sequence.')
            values.append(frame)
        for frame in values:
            await self.write_control(frame)
            await asyncio.sleep(0.003)

    async def music_inventory_page(self, page):
        """Read-only music metadata (storage category 0, SFT file 93), one page."""
        if not isinstance(page, int) or not 0 <= page < 256:
            raise ProtocolError('The music inventory request is invalid or the watch is disconnected.')
        bulk = self.connected_channels()
        receiver = MusicPageReceiver(page)
        self.music_queue = asyncio.Queue(maxsize=512)
        try:
            for frame in receiver.request_frames():
                await self.write_control(frame)

            async def receive():
                while True:
                    item = await self.music_queue.get()
                    if item is None:
                        raise ProtocolError('The watch disconnected while reading its music.')
                    result = receiver.accept(item[1], item[0])
                    if result.payload is not None:
                        return result.payload
                    for frame in result.frames:
                        if result.bulk:
                            await self.client.write_gatt_char(bulk, frame, response=False)
                        else:
                            await self.write_control(frame)
            try:
                return await asyncio.wait_for(receive(), 30)
            except asyncio.TimeoutError:
                raise ProtocolError('The watch did not return its music inventory.') from None
        finally:
            self.music_queue = None

    async def refresh(self):
        if self.client and self.client.is_connected:
            data = await self.client.read_gatt_char(standard_uuid('2a19'))
            if len(data) == 1 and data[0] <= 100:
                self.state['batteryPercent'] = data[0]
        return await self.status()

    async def close(self):
        client, self.client = self.client, None
        if client:
            try:
                await asyncio.wait_for(client.disconnect(), 5)
            except Exception:
                pass
        self.write = None
        self.disconnected(None)


def failure_detail(error, operation, started, **extra):
    """Where a request failed, for the app's diagnostics report. Frames are
    file:line function only and the cause chain is exception class names:
    framework messages can carry keys and addresses, so they are never sent."""
    def site(exception):
        return [f"{os.path.basename(frame.filename)}:{frame.lineno} {frame.name}"
                for frame in traceback.extract_tb(exception.__traceback__)]
    # Outer frames first, then each cause's, so the root failure ends the list.
    frames, chain, cause = site(error), [], error.__cause__ or error.__context__
    while cause is not None and len(chain) < 4:
        chain.append(type(cause).__name__)
        frames += site(cause)
        cause = cause.__cause__ or cause.__context__
    frames = frames[-12:]
    detail = {'operation': operation, 'exception': type(error).__name__, 'frames': frames,
              'elapsedMs': int((time.monotonic() - started) * 1000), **extra}
    if chain:
        detail['causes'] = chain
    return detail


def emit(value):
    print(json.dumps(value), flush=True)


async def main():
    logging.disable(logging.CRITICAL)
    os.umask(0o077)
    session = SystemSession()
    task = asyncio.current_task()
    if sys.platform != 'win32':
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
    emit({'ready': True})
    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.buffer.readline, 32769)
            if not line:
                break
            if len(line) > 32768:
                break
            request_id = None
            operation = ''
            started = time.monotonic()
            session.step = None
            try:
                request = json.loads(line)
                request_id = request.get('id')
                operation = request['operation']
                extra = {}
                if operation == 'scan':
                    result = await session.scan()
                elif operation == 'connect':
                    result = await session.connect(request.get('deviceName'))
                elif operation == 'status':
                    result = await session.status()
                elif operation == 'refresh':
                    result = await session.refresh()
                elif operation == 'exchange':
                    data = base64.b64decode(request['payload'], validate=True)
                    response = await session.exchange(data, request['maximumWriteBytes'], request.get('opcode', 0xa5))
                    result = session.state
                    extra['payload'] = base64.b64encode(response).decode()
                elif operation in FILE_OPERATIONS:
                    reply = await session.file_block(base64.b64decode(request['header'], validate=True),
                                                     base64.b64decode(request['block'], validate=True),
                                                     FILE_OPERATIONS[operation])
                    result = session.state
                    if reply is not None:
                        extra['payload'] = base64.b64encode(reply).decode()
                elif operation == 'sendNotification':
                    await session.send_notification(request.get('frames'))
                    result = session.state
                elif operation == 'musicInventoryPage':
                    payload = await session.music_inventory_page(request.get('page'))
                    result = session.state
                    extra['payload'] = base64.b64encode(payload).decode()
                elif operation == 'disconnect':
                    await session.close()
                    result = session.state
                else:
                    raise ProtocolError('Unsupported Bluetooth operation.')
                result['updatedAt'] = int(time.time() * 1000)
                emit({'id': request_id, 'result': result, **extra})
            except Exception as error:
                reason = failure_reason(error)
                message = str(error) if isinstance(error, ProtocolError) else (
                    failure_message(session.step, reason, session.state['transport'] == 'winrt'))
                extra = {'step': session.step} if session.step else {}
                if reason != type(error).__name__:
                    extra['reason'] = reason
                emit({'id': request_id, 'error': message, 'detail': failure_detail(error, operation, started, **extra)})
                if operation == 'connect':
                    await session.close()
    finally:
        await session.close()


if __name__ == '__main__':
    asyncio.run(main())
