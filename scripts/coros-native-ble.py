#!/usr/bin/env python3
"""CorosLink's direct USB BLE worker. JSON commands use private stdio only.

The official app and emulator are not used at runtime. An existing bond is
supplied by Electron in memory, using the same physical controller identity.
An optional saved COROS account key signs a fresh SystemBind challenge on each
connection. CorosLink obtains that key through the normal COROS mobile login;
legacy imported credentials are also supported.
"""

import asyncio
import base64
import json
import logging
import os
import signal
import sys
import time
import traceback

from bumble.core import UUID, AdvertisingData
from bumble.device import Device, Peer
from bumble.hci import Address, OwnAddressType, HCI_Error
from bumble.keys import MemoryKeyStore, PairingKeys
from bumble.pairing import PairingConfig, PairingDelegate
from bumble.snoop import Snooper
from bumble.transport import open_transport
from coros_ble_auth import AccountAuth, AuthError, KeyMismatchError, MessageDecoder, OPCODE, bind_status, frame_message, refusal_message, reports_key_id
from coros_ble_route import send_route_block

CHANNELS = {
    "control": "6e400001-b5a3-f393-e0a9-77656c6f6f70",
    "bulk": "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    "auxiliary": "6e400001-b5a3-f393-e0a9-77757c7f7f70",
}
STANDARD_READS = {
    "deviceName": 0x2A00, "batteryPercent": 0x2A19,
    "modelNumber": 0x2A24, "serialNumber": 0x2A25,
    "firmwareRevision": 0x2A26, "hardwareRevision": 0x2A27,
    "softwareRevision": 0x2A28, "manufacturerName": 0x2A29,
}


class PacketCounter(Snooper):
    def __init__(self, state):
        self.state = state

    def snoop(self, packet, direction):
        field = "hostToAdapterPackets" if direction == self.Direction.HOST_TO_CONTROLLER else "adapterToHostPackets"
        self.state[field] = self.state.get(field, 0) + 1


class NativeSession:
    def __init__(self):
        self.transport = None
        self.device = None
        self.connection = None
        self.peer = None
        self.battery = None
        self.new_bond = None
        self.control_queue = None
        self.step = "opening the USB adapter"
        self.state = {"phase": "idle", "connected": False, "encrypted": False,
                      "systemBind": "unavailable", "channels": []}

    def notification(self, channel, value):
        channel["notifications"] += 1
        channel["receivedBytes"] += len(value)
        channel["lastNotificationAt"] = int(time.time() * 1000)
        if channel["name"] == "control" and self.control_queue is not None:
            if not self.control_queue.full():
                self.control_queue.put_nowait(bytes(value))
        # Payloads and pairing keys never cross the renderer IPC boundary.

    def disconnected(self, reason):
        self.state.update(phase="disconnected", connected=False, encrypted=False)
        self.state.pop("authenticatedAt", None)
        if self.state["systemBind"] != "unavailable":
            self.state["systemBind"] = "not_authenticated"
        for channel in self.state["channels"]:
            channel["subscribed"] = False

    async def connect(self, bond, transport_spec, fresh_pair=False, auth=None):
        if self.connection and self.state["connected"]:
            return self.state
        # A remote watch disconnect leaves the USB transport open. Release it
        # before another connect so two libusb contexts cannot own this dongle.
        if self.transport is not None or self.connection is not None:
            await self.close()
        self.state.update(phase="connecting", connected=False, encrypted=False)
        self.state["systemBind"] = "not_authenticated" if auth else "unavailable"
        self.state.pop("authenticationError", None)
        self.step = "opening the USB adapter"
        self.transport = await open_transport(transport_spec)
        await self.transport.__aenter__()
        self.device = Device.with_hci("CorosLink", Address("C2:43:4F:52:4F:53"),
                                      self.transport.source, self.transport.sink)
        self.state.update(hostToAdapterPackets=0, adapterToHostPackets=0)
        self.device.host.snooper = PacketCounter(self.state)
        self.step = "starting the Bluetooth controller"
        await self.device.power_on()
        if str(self.device.public_address).split("/")[0].upper() != bond["adapterAddress"]:
            raise RuntimeError("The connected adapter does not match this watch's saved bond.")
        address = Address(bond["watchAddress"], bond["addressType"])
        # PACE Pro can advertise a new public address after a disconnect.
        # Locate this watch by its exact name, including its unique suffix.
        self.step = "finding the watch"
        discovered = asyncio.get_running_loop().create_future()

        def advertisement(report):
            name = report.data.get(AdvertisingData.COMPLETE_LOCAL_NAME) or ""
            if name == bond["deviceName"] and not discovered.done():
                discovered.set_result(report.address)

        self.device.on("advertisement", advertisement)
        await self.device.start_scanning(filter_duplicates=False)
        try:
            address = await asyncio.wait_for(discovered, 8)
        finally:
            await self.device.stop_scanning()
            self.device.remove_listener("advertisement", advertisement)
        store = MemoryKeyStore()
        if not fresh_pair:
            await store.update(str(address), PairingKeys.from_dict(bond["keys"]))
        self.device.keystore = store
        self.device.pairing_config_factory = lambda connection: PairingConfig(
            sc=True, mitm=False, bonding=True,
            delegate=PairingDelegate(io_capability=PairingDelegate.NO_OUTPUT_NO_INPUT),
            identity_address_type=PairingConfig.AddressType.PUBLIC,
        )
        self.step = "finding the watch"
        self.connection = await self.device.connect_le(
            address, own_address_type=OwnAddressType.PUBLIC, timeout=25)
        self.connection.on("disconnection", self.disconnected)
        self.step = "encrypting the watch connection"
        if fresh_pair:
            self.step = "pairing with the watch; confirm on the watch if prompted"
            await asyncio.wait_for(self.connection.pair(), 30)
            saved_keys = await store.get_all()
            if len(saved_keys) != 1:
                raise RuntimeError("The watch did not provide a persistent BLE bond.")
            peer_address, keys = saved_keys[0]
            self.new_bond = {"deviceName": bond["deviceName"], "adapterAddress": bond["adapterAddress"],
                             "watchAddress": peer_address.split("/")[0], "addressType": int(keys.address_type or 0),
                             "keys": keys.to_dict()}
            # Save the new bond before optional GATT reads, even if one fails.
            # This event travels only through the worker's private parent pipe.
            emit({"bondUpdate": self.new_bond})
            self.new_bond = None
        else:
            await asyncio.wait_for(self.connection.encrypt(), 15)
        if not self.connection.is_encrypted:
            raise RuntimeError("The watch did not establish an encrypted BLE link.")
        self.peer = Peer(self.connection)
        self.step = "reading watch information"
        mtu = await self.peer.request_mtu(247)
        await self.peer.discover_services()
        for service in self.peer.services:
            await self.peer.discover_characteristics(service=service)
        self.state.update(deviceName=bond["deviceName"], watchAddress=str(address).split("/")[0],
                          adapterAddress=bond["adapterAddress"], mtu=mtu, channels=[])
        for name, value in STANDARD_READS.items():
            matches = self.peer.get_characteristics_by_uuid(UUID(value))
            if not matches:
                continue
            try:
                data = await matches[0].read_value()
                if name == "batteryPercent":
                    self.battery = matches[0]
                    if len(data) == 1 and data[0] <= 100:
                        self.state[name] = data[0]
                else:
                    self.state[name] = data.decode("utf-8", errors="replace").rstrip("\0").strip()
            except Exception:
                # Optional standard values must not prevent a live connection.
                continue
        for name, service_uuid in CHANNELS.items():
            self.step = "subscribing to COROS notifications"
            notify = self.peer.get_characteristics_by_uuid(UUID(service_uuid.replace("0001", "0003", 1)))
            write = self.peer.get_characteristics_by_uuid(UUID(service_uuid.replace("0001", "0002", 1)))
            if not notify or not write:
                continue
            channel = {"name": name, "serviceUuid": service_uuid,
                       "notifyHandle": notify[0].handle, "writeHandle": write[0].handle,
                       "notifications": 0, "receivedBytes": 0, "subscribed": False}
            self.state["channels"].append(channel)
            await self.peer.subscribe(notify[0], lambda value, ch=channel: self.notification(ch, value))
            channel["subscribed"] = True
        self.state.update(phase="connected", connected=True, encrypted=True,
                          updatedAt=int(time.time() * 1000))
        if auth:
            await self.authenticate(auth, bond["deviceName"])
        return await self.status()

    async def control_exchange(self, payload, maximum, opcode=OPCODE):
        matches = self.peer.get_characteristics_by_uuid(UUID(CHANNELS["control"].replace("0001", "0002", 1)))
        if not matches:
            raise AuthError("The COROS control channel is unavailable.")
        self.control_queue = asyncio.Queue(maxsize=64)
        decoder = MessageDecoder(opcode)
        try:
            for frame in frame_message(opcode, payload, maximum):
                await matches[0].write_value(frame, with_response=False)
                self.state['controlWrites'] = self.state.get('controlWrites', 0) + 1
            async with asyncio.timeout(10):
                while True:
                    response = decoder.accept(await self.control_queue.get())
                    if response is not None:
                        return response
        finally:
            self.control_queue = None

    async def route_block(self, header, block):
        if not self.state['connected'] or self.peer is None:
            raise AuthError('The watch is disconnected.')
        control = self.peer.get_characteristics_by_uuid(UUID(CHANNELS['control'].replace('0001', '0002', 1)))
        bulk = self.peer.get_characteristics_by_uuid(UUID(CHANNELS['bulk'].replace('0001', '0002', 1)))
        if not control or not bulk:
            raise AuthError('The COROS route transfer channel is unavailable.')
        self.control_queue = asyncio.Queue(maxsize=64)
        try:
            async def write_control(value):
                await control[0].write_value(value, with_response=False)
                self.state['controlWrites'] = self.state.get('controlWrites', 0) + 1
            async def write_bulk(value):
                await bulk[0].write_value(value, with_response=False)
            await send_route_block(header, block, self.control_queue, write_control, write_bulk, min(240, self.state['mtu'] - 3))
        finally:
            self.control_queue = None

    async def authenticate(self, credential, device_name):
        self.state["systemBind"] = "authenticating"
        # What this attempt learned about the saved key: "ok", "mismatch" or "rejected". No key material.
        self.state.pop("keyCheck", None)
        try:
            account = AccountAuth(credential, device_name, reports_key_id(self.state.get("modelNumber"), device_name))
            base = account.initial_payload()
            challenge = bind_status(await self.control_exchange(base, 20))
            payload = account.authenticated_payload(base, challenge)
            response = bind_status(await self.control_exchange(payload, min(240, self.state["mtu"] - 3)))
            if response["status"] != 1:
                if response["status"] == 5 and response["reason"] == 4:
                    self.state["keyCheck"] = "rejected"
                raise AuthError(refusal_message(response))
            if not self.state["connected"] or not self.connection.is_encrypted:
                raise AuthError("The watch disconnected during COROS authentication.")
            self.state.update(systemBind="authenticated", authenticatedAt=int(time.time() * 1000), keyCheck="ok")
        except Exception as error:
            if isinstance(error, KeyMismatchError):
                self.state["keyCheck"] = "mismatch"
            self.state.update(systemBind="failed", authenticationError=str(error) if isinstance(error, AuthError)
                              else "COROS authentication did not complete. Keep the watch nearby and reconnect.")

    async def status(self):
        if self.connection and self.state["connected"]:
            try:
                rssi = await self.connection.get_rssi()
                if rssi != 127:
                    self.state["rssiDbm"] = rssi
            except Exception:
                self.state.pop("rssiDbm", None)
        return self.state

    async def refresh(self):
        if self.state["connected"] and self.battery:
            data = await self.battery.read_value()
            if len(data) == 1 and data[0] <= 100:
                self.state["batteryPercent"] = data[0]
            self.state["updatedAt"] = int(time.time() * 1000)
        return self.state

    async def close(self):
        connection, self.connection = self.connection, None
        transport, self.transport = self.transport, None
        if connection:
            try:
                await asyncio.wait_for(connection.disconnect(), 5)
            except Exception:
                pass
        if transport:
            try:
                await transport.__aexit__(None, None, None)
            except Exception:
                pass
        self.peer = None
        self.battery = None
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


def operation_error(step, error):
    if isinstance(error, HCI_Error):
        code = error.error_code
        if step == "encrypting the watch connection" and code in (0x05, 0x06):
            return "The watch rejected the saved Bluetooth pairing. Open System → Pair Phone on the watch, then choose Pair with CorosLink."
        return f"BLE operation failed while {step}: HCI error 0x{code:02X}"
    return "BLE operation failed while " + step + ": " + type(error).__name__


async def main():
    # Avoid framework debug logging, which can contain security material.
    logging.disable(logging.CRITICAL)
    os.umask(0o077)
    # A closed app or canceled connection releases its BLE link and USB handle.
    task = asyncio.current_task()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
    session = NativeSession()
    emit({"ready": True})
    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            request_id = None
            operation = ""
            started = time.monotonic()
            try:
                request = json.loads(line)
                request_id = request.get("id")
                operation = request["operation"]
                if operation == "connect":
                    result = await session.connect(request["bond"], request.get("transport", "usb:0b05:17cb!"), request.get("pair", False), request.get("auth"))
                elif operation == "status":
                    result = await session.status()
                elif operation == "refresh":
                    result = await session.refresh()
                elif operation == "exchange":
                    session.step = "exchanging a COROS control command"
                    payload = base64.b64decode(request['payload'], validate=True)
                    response_payload = await session.control_exchange(payload, min(request['maximumWriteBytes'], session.state['mtu'] - 3), request['opcode'])
                    emit({'id': request_id, 'result': session.state, 'payload': base64.b64encode(response_payload).decode()})
                    continue
                elif operation == "routeBlock":
                    session.step = "transferring a route"
                    await session.route_block(base64.b64decode(request['header'], validate=True), base64.b64decode(request['block'], validate=True))
                    result = session.state
                elif operation == "disconnect":
                    await session.close()
                    result = session.state
                else:
                    raise ValueError("Unsupported BLE operation.")
                response = {"id": request_id, "result": result}
                if session.new_bond:
                    response["bond"] = session.new_bond
                    session.new_bond = None
                emit(response)
            except Exception as error:
                # Never serialize framework exceptions that may include keys.
                # Report the cause before USB teardown can mask it.
                emit({"id": request_id, "error": operation_error(session.step, error),
                      "detail": failure_detail(error, operation, started, step=session.step)})
                await session.close()
                session.state.update(phase="failed", error=type(error).__name__)
    finally:
        await session.close()


if __name__ == "__main__":
    asyncio.run(main())
