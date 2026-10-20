import Foundation
import CoreBluetooth

// The helper transports GATT data only. Account keys remain in Electron's main
// process, which signs a new SystemBind challenge over this private stdio pipe.
let channels: [(String, String)] = [
    ("control", "6e400001-b5a3-f393-e0a9-77656c6f6f70"),
    ("bulk", "6e400001-b5a3-f393-e0a9-e50e24dcca9e"),
    ("auxiliary", "6e400001-b5a3-f393-e0a9-77757c7f7f70")
]
let standardReads: [(String, String)] = [
    ("deviceNameValue", "2A00"), ("batteryPercent", "2A19"),
    ("modelNumber", "2A24"), ("serialNumber", "2A25"),
    ("firmwareRevision", "2A26"), ("hardwareRevision", "2A27"),
    ("softwareRevision", "2A28"), ("manufacturerName", "2A29")
]

func emit(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}

final class BluetoothWorker: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager?
    var peripheral: CBPeripheral?
    var characteristics: [String: CBCharacteristic] = [:]
    var discovered: [String: [String: Any]] = [:]
    var state: [String: Any] = ["phase": "idle", "connected": false, "encrypted": false,
        "pairingManagedByOS": true, "systemBind": "unavailable", "backend": "system", "transport": "corebluetooth", "channels": []]
    var requests: [[String: Any]] = []
    var current: [String: Any]?
    var timer: DispatchWorkItem?
    var discoveryPending = 0
    var subscriptions: [CBCharacteristic] = []
    var reads: [(String, CBCharacteristic)] = []
    var reading: (String, CBCharacteristic)?
    var writeFrames: [Data] = []
    var responseBytes = Data()
    var responseRemaining: UInt8?
    var expectedOpcode: UInt8 = 0xA5
    var writeTarget: CBCharacteristic?
    var routeBlock = Data()
    var routeStage = ""
    var interactionSequence = 0
    var musicReceiver: CorosMusicPageReceiver?
    var syncReceiver: CorosSyncBlockReceiver?
    // Developer capture of local-sync frames (never authentication), bounded under Electron's 256 KB line limit.
    var capture: [[String: Any]]?
    var captureChars = 0
    var musicDeleteReceiver: CorosMusicDeleteReceiver?
    var operationStarted = Date()
    var deadlineSite: (line: Int, function: String)?
    // A connect with a remembered identity ("pinnedId") goes to that peripheral only. A same-named
    // peripheral with another identity is never connected to; it is reported if the remembered one
    // doesn't show up (its identifier travels outside `detail`, which reaches diagnostics).
    var otherIdentity: String?
    var pinnedSeen = false
    var pinnedIdentity: UUID? { (current?["pinnedId"] as? String).flatMap { UUID(uuidString: $0) } }

    var operation: String { current?["operation"] as? String ?? "" }
    var connecting: Bool { operation == "connect" }

    func enqueue(_ request: [String: Any]) {
        guard requests.count < 32, request["id"] is Int else { return }
        requests.append(request)
        pump()
    }

    func pump() {
        guard current == nil, !requests.isEmpty else { return }
        current = requests.removeFirst()
        operationStarted = Date()
        capture = current?["capture"] as? Bool == true && ["syncFileBlock", "exchange"].contains(operation) ? [] : nil
        captureChars = 0
        switch operation {
        case "scan", "connect":
            otherIdentity = nil; pinnedSeen = false
            if operation == "connect", peripheral?.state == .connected {
                finish(); return
            }
            state["phase"] = operation == "connect" ? "connecting" : "scanning"
            if central == nil {
                central = CBCentralManager(delegate: self, queue: .main,
                    options: [CBCentralManagerOptionShowPowerAlertKey: true])
                deadline(60, "Bluetooth permission or startup did not complete. Check System Settings → Privacy & Security → Bluetooth.")
            } else {
                beginWhenPoweredOn()
            }
        case "status":
            if peripheral?.state == .connected {
                deadline(2, nil)
                peripheral?.readRSSI()
            } else { finish() }
        case "refresh":
            if let battery = characteristics["2A19"], peripheral?.state == .connected {
                reading = ("batteryPercent", battery)
                deadline(45, "Battery read did not complete. Keep the watch awake and confirm any macOS pairing prompt.")
                peripheral?.readValue(for: battery)
            } else { finish() }
        case "exchange":
            guard peripheral?.state == .connected,
                  let text = current?["payload"] as? String,
                  let data = Data(base64Encoded: text), data.count <= 4096,
                  let number = current?["maximumWriteBytes"] as? Int else {
                fail("The COROS control request is invalid or the watch is disconnected."); return
            }
            let maximum = min(number, peripheral!.maximumWriteValueLength(for: .withoutResponse), 255)
            guard maximum >= 3, let write = controlWrite(), write.properties.contains(.writeWithoutResponse) else {
                fail("The COROS control write channel is unavailable."); return
            }
            expectedOpcode = UInt8(current?["opcode"] as? Int ?? 0xA5)
            responseBytes = Data(); responseRemaining = nil
            var logical = data
            logical.append(data.reduce(UInt8(0)) { $0 &+ $1 })
            let size = maximum - 2
            let count = (logical.count + size - 1) / size
            guard count <= 256 else { fail("COROS control request is too large."); return }
            writeFrames = stride(from: 0, to: logical.count, by: size).enumerated().map { index, offset in
                Data([expectedOpcode, UInt8(count - index - 1)]) + logical.subdata(in: offset..<min(offset + size, logical.count))
            }
            deadline(15, "The watch did not answer the COROS control request.")
            flushWrites()
        case "musicInventoryPage":
            guard let p = peripheral, p.state == .connected,
                  let page = current?["page"] as? Int, (0..<256).contains(page),
                  controlWrite() != nil,
                  characteristics[channels[1].1.replacingOccurrences(of: "0001", with: "0002")] != nil else {
                fail("The music inventory request is invalid or the watch is disconnected."); return
            }
            musicReceiver = CorosMusicPageReceiver(page: page)
            responseBytes = Data(); responseRemaining = nil
            writeTarget = controlWrite()
            writeFrames = musicReceiver!.requestFrames()
            deadline(30, "The watch did not return its music inventory.")
            flushWrites()
        case "syncFileBlock":
            // Read-only local activity sync: one CRC-checked block, returned unacknowledged.
            guard let p = peripheral, p.state == .connected,
                  let fileIndex = current?["fileIndex"] as? Int, let offset = current?["offset"] as? Int,
                  let receiver = CorosSyncBlockReceiver(fileIndex: fileIndex, offset: offset, selector: current?["selector"] as? Int ?? 0),
                  controlWrite() != nil,
                  characteristics[channels[1].1.replacingOccurrences(of: "0001", with: "0002")] != nil else {
                fail("The watch sync request is invalid or the watch is disconnected."); return
            }
            syncReceiver = receiver
            writeTarget = controlWrite()
            writeFrames = receiver.requestFrames()
            deadline(30, "The watch did not send the requested records.")
            flushWrites()
        case "sendNotification":
            guard let p = peripheral, p.state == .connected,
                  let encoded = current?["frames"] as? [String], !encoded.isEmpty, encoded.count <= 256,
                  let write = controlWrite(), write.properties.contains(.writeWithoutResponse) else {
                fail("The notification request is invalid or the watch is disconnected."); return
            }
            let maximum = min(p.maximumWriteValueLength(for: .withoutResponse), 255)
            var values: [Data] = []
            var sequence: UInt8?
            for (index, text) in encoded.enumerated() {
                guard let frame = Data(base64Encoded: text), frame.count >= 4, frame.count <= maximum,
                      frame[0] == 0x79, frame[1] == UInt8(encoded.count - index - 1),
                      (frame[2] & 0x80) == (index == 0 ? 0x80 : 0) else {
                    fail("Invalid notification fragment sequence."); return
                }
                if index == 0 { sequence = frame[2] & 0x7f }
                guard (frame[2] & 0x7f) == sequence else {
                    fail("Invalid notification message sequence."); return
                }
                values.append(frame)
            }
            writeTarget = write; writeFrames = values
            deadline(5, "Bluetooth did not finish sending the notification.")
            flushWrites()
        case "routeBlock", "watchfaceBlock", "musicDelete", "officialOtaBlock", "lightMapOtaBlock", "dataFileBlock":
            let ota = operation == "officialOtaBlock" || operation == "lightMapOtaBlock"
            // Files the phone app pushes: a workout (41) or weather (80); nothing else.
            let dataFile = UInt8(exactly: current?["fileId"] as? Int ?? 255) ?? 255
            let fileIndex: UInt8 = ota ? (UInt8(exactly: current?["fileId"] as? Int ?? 255) ?? 255)
                : operation == "dataFileBlock" ? (pushedDataFiles.contains(dataFile) ? dataFile : 255)
                : operation == "musicDelete" ? 93 : operation == "watchfaceBlock" ? 8 : 0x14
            guard peripheral?.state == .connected, let headerText = current?["header"] as? String,
                  let blockText = current?["block"] as? String, let header = Data(base64Encoded: headerText),
                  let block = Data(base64Encoded: blockText), validFileBlock(header, block, fileIndex),
                  (operation != "officialOtaBlock" || validOfficialOtaBlock(header, block, fileIndex)),
                  (operation != "lightMapOtaBlock" || validLightMapOtaBlock(header, block, fileIndex)),
                  let control = controlWrite(), control.properties.contains(.writeWithoutResponse),
                  let bulk = characteristics[channels[1].1.replacingOccurrences(of: "0001", with: "0002")],
                  bulk.properties.contains(.writeWithoutResponse) else {
                fail("The COROS file request is invalid or its transfer channel is unavailable."); return
            }
            guard peripheral!.maximumWriteValueLength(for: .withoutResponse) >= 21 else {
                fail("Bluetooth packet size is too small for file sync. Reconnect the watch."); return
            }
            routeBlock = block; routeStage = "ready"; writeTarget = control; writeFrames = [header]
            if operation == "musicDelete" { musicDeleteReceiver = CorosMusicDeleteReceiver() }
            deadline(15, "The watch did not accept the file transfer header.")
            flushWrites()
        case "disconnect":
            central?.stopScan()
            if let p = peripheral, p.state != .disconnected {
                deadline(4, nil)
                central?.cancelPeripheralConnection(p)
            } else { clearConnection(); finish() }
        default: fail("Unsupported Bluetooth operation.")
        }
    }

    func deadline(_ seconds: Double, _ message: String?, line: Int = #line, function: String = #function) {
        timer?.cancel()
        deadlineSite = (line, function)
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.current != nil else { return }
            if self.operation == "scan" {
                self.central?.stopScan()
                self.state["discoveredDevices"] = self.discovered.values.sorted {
                    ($0["deviceName"] as? String ?? "") < ($1["deviceName"] as? String ?? "")
                }
                self.state["phase"] = "idle"
                self.finish()
            } else if self.operation == "disconnect" {
                self.clearConnection(); self.finish()
            } else if let message = message {
                let site = self.deadlineSite
                self.fail(message, timedOut: true, line: site?.line ?? #line, function: site?.function ?? #function)
            } else { self.finish() }
        }
        timer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func record(_ direction: String, _ channel: String, _ data: Data) {
        guard capture != nil, captureChars < 120_000 else { return }
        let hex = data.map { String(format: "%02x", $0) }.joined()
        captureChars += hex.count
        capture!.append(["d": direction, "c": channel, "t": Int(Date().timeIntervalSince(operationStarted) * 1000), "x": hex])
    }

    func finish(extra: [String: Any] = [:]) {
        guard let id = current?["id"] as? Int else { return }
        timer?.cancel(); timer = nil
        state["updatedAt"] = Int64(Date().timeIntervalSince1970 * 1000)
        var response: [String: Any] = ["id": id, "result": state]
        extra.forEach { response[$0.key] = $0.value }
        if let frames = capture { response["capture"] = frames }
        capture = nil
        current = nil
        writeTarget = nil; routeBlock = Data(); routeStage = ""
        musicReceiver = nil
        musicDeleteReceiver = nil
        syncReceiver = nil
        emit(response)
        DispatchQueue.main.async { self.pump() }
    }

    func peripheralStateName(_ value: CBPeripheralState?) -> String {
        switch value {
        case .connected?: return "connected"
        case .connecting?: return "connecting"
        case .disconnecting?: return "disconnecting"
        case .disconnected?: return "disconnected"
        default: return "none"
        }
    }

    /// Where and how a request failed, for the app's diagnostics report. Only
    /// the source site, states and NSError domain/code: never userInfo, GATT
    /// payloads or identifiers.
    func failureDetail(_ error: Error?, timedOut: Bool, line: Int, function: String) -> [String: Any] {
        var detail: [String: Any] = [
            "site": "main.swift:\(line) \(function)",
            "operation": operation,
            "elapsedMs": Int(Date().timeIntervalSince(operationStarted) * 1000),
            "timedOut": timedOut,
            "bluetoothState": state["bluetoothState"] as? String ?? "unknown",
            "peripheralState": peripheralStateName(peripheral?.state),
            "characteristics": characteristics.count,
            "discoveryPending": discoveryPending,
            "subscriptionsPending": subscriptions.count,
            "queued": requests.count
        ]
        if !routeStage.isEmpty { detail["routeStage"] = routeStage }
        if let error = error as NSError? {
            detail["errorDomain"] = error.domain
            detail["errorCode"] = error.code
        }
        return detail
    }

    func fail(_ message: String, _ error: Error? = nil, timedOut: Bool = false, extra: [String: Any] = [:], line: Int = #line, function: String = #function) {
        guard let id = current?["id"] as? Int else { return }
        let detail = failureDetail(error, timedOut: timedOut, line: line, function: function)
        timer?.cancel(); timer = nil
        if connecting {
            central?.stopScan()
            if let p = peripheral { central?.cancelPeripheralConnection(p) }
            clearConnection()
            state["phase"] = "failed"
        }
        writeFrames.removeAll(); responseBytes = Data(); responseRemaining = nil
        writeTarget = nil; routeBlock = Data(); routeStage = ""
        musicReceiver = nil
        musicDeleteReceiver = nil
        syncReceiver = nil
        current = nil
        // Error text is static. NSError/userInfo and GATT payloads are never logged;
        // a developer capture travels separately and is written only to the local archive.
        var failure: [String: Any] = ["id": id, "error": message, "detail": detail]
        extra.forEach { failure[$0.key] = $0.value }
        if let frames = capture { failure["capture"] = frames }
        capture = nil
        emit(failure)
        DispatchQueue.main.async { self.pump() }
    }

    func beginWhenPoweredOn() {
        guard let central = central else { return }
        switch central.state {
        case .poweredOn:
            state["bluetoothState"] = "powered_on"
            discovered.removeAll()
            if connecting {
                guard let name = current?["deviceName"] as? String, name.hasPrefix("COROS") else {
                    fail("Find and select your COROS watch before connecting."); return
                }
                deadline(60, "The watch did not connect. Open System → Pair Phone on the watch, keep it nearby, and confirm any macOS pairing prompt.")
                // A watch connected elsewhere on this Mac may no longer
                // advertise, so reuse the selected OS identity. That identity
                // can also be stale: the watch isn't bonded to the Mac and
                // rotates its address, so keep scanning and switch to the
                // watch if it advertises under a new identity.
                // With a remembered identity, only that peripheral; never another one by name.
                let pinned = pinnedIdentity
                guard current?["pinnedId"] == nil || pinned != nil else {
                    fail("The remembered watch identity is invalid."); return
                }
                let connected = central.retrieveConnectedPeripherals(withServices: channels.map { CBUUID(string: $0.1) })
                if let known = connected.first(where: { pinned == nil ? $0.name == name : $0.identifier == pinned }) {
                    connectPeripheral(known, name: name); return
                }
                if let id = pinned ?? (current?["deviceId"] as? String).flatMap({ UUID(uuidString: $0) }),
                   let known = central.retrievePeripherals(withIdentifiers: [id]).first,
                   pinned != nil || known.name == name {
                    connectPeripheral(known, name: name, keepScanning: true)
                }
            } else { deadline(8, nil) }
            central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        case .unauthorized:
            state["bluetoothState"] = "unauthorized"
            fail("Allow CorosLink Bluetooth access in System Settings → Privacy & Security → Bluetooth.")
        case .poweredOff:
            state["bluetoothState"] = "powered_off"
            fail("Turn on Bluetooth in macOS, then try again.")
        case .unsupported:
            state["bluetoothState"] = "unsupported"
            fail("Bluetooth is unavailable on this Mac.")
        case .resetting, .unknown: break
        @unknown default: fail("Bluetooth is unavailable on this Mac.")
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if operation == "scan" || connecting { beginWhenPoweredOn() }
        else if central.state != .poweredOn { clearConnection() }
    }

    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? p.name ?? ""
        guard name.hasPrefix("COROS") else { return }
        let choice: [String: Any] = ["deviceId": p.identifier.uuidString, "deviceName": name, "rssiDbm": RSSI.intValue]
        discovered[p.identifier.uuidString] = choice
        guard connecting, name == current?["deviceName"] as? String else { return }
        if let pinned = pinnedIdentity {
            guard p.identifier == pinned else {
                if otherIdentity == nil {
                    otherIdentity = p.identifier.uuidString
                    let request = current?["id"] as? Int
                    // Give the remembered watch a moment to advertise before reporting the other device.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                        guard let self = self, self.connecting, self.current?["id"] as? Int == request, !self.pinnedSeen,
                              self.peripheral?.state != .connected, let other = self.otherIdentity else { return }
                        self.fail("This doesn’t look like the watch you connected before.", extra: ["mismatch": ["deviceId": other]])
                    }
                }
                return
            }
            pinnedSeen = true
        }
        if let pending = peripheral {
            // The remembered identity is still pending; prefer the one advertising now.
            guard pending.identifier != p.identifier, pending.state != .connected else { return }
            peripheral = nil
            central.cancelPeripheralConnection(pending)
        }
        state["rssiDbm"] = RSSI.intValue
        connectPeripheral(p, name: name)
    }

    func connectPeripheral(_ p: CBPeripheral, name: String, keepScanning: Bool = false) {
        guard connecting, peripheral == nil else { return }
        if !keepScanning { central?.stopScan() }
        peripheral = p; p.delegate = self
        state["deviceName"] = name; state["deviceId"] = p.identifier.uuidString
        central?.connect(p, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        guard connecting, peripheral === p else { central.cancelPeripheralConnection(p); return }
        central.stopScan()
        state["maximumWriteBytes"] = p.maximumWriteValueLength(for: .withoutResponse)
        characteristics.removeAll()
        p.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        guard peripheral === p else { return }
        if connecting { fail("The watch could not connect. Keep it awake in Pair Phone mode and confirm any macOS pairing prompt.", error) }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        guard peripheral === p else { return }
        clearConnection()
        if operation == "disconnect" { finish() }
        else if current != nil { fail("The watch disconnected. Keep it nearby and reconnect.", error) }
        else {
            // No request is waiting, so tell the app's diagnostics trail why the link dropped.
            var detail: [String: Any] = [:]
            if let error = error as NSError? { detail["errorDomain"] = error.domain; detail["errorCode"] = error.code }
            emit(["event": "disconnected", "detail": detail])
        }
    }

    func clearConnection() {
        state["phase"] = "disconnected"; state["connected"] = false
        state["encrypted"] = false; state["systemBind"] = "not_authenticated"
        state.removeValue(forKey: "rssiDbm")
        state.removeValue(forKey: "authenticatedAt")
        state.removeValue(forKey: "watchEvents")
        var values = state["channels"] as? [[String: Any]] ?? []
        for i in values.indices { values[i]["subscribed"] = false }
        state["channels"] = values
        peripheral = nil; characteristics.removeAll()
        reading = nil; reads.removeAll(); subscriptions.removeAll()
        writeFrames.removeAll()
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard connecting, peripheral === p else { return }
        guard error == nil, let services = p.services, !services.isEmpty else {
            fail("The watch's Bluetooth services could not be discovered.", error); return
        }
        discoveryPending = services.count
        for service in services { p.discoverCharacteristics(nil, for: service) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard connecting, peripheral === p else { return }
        if let values = service.characteristics, error == nil {
            for value in values { characteristics[value.uuid.uuidString.lowercased()] = value }
        }
        discoveryPending -= 1
        if discoveryPending == 0 {
            guard controlWrite() != nil else { fail("This watch does not expose the supported COROS control channel."); return }
            reads = standardReads.compactMap { label, uuid in
                guard let value = characteristics[uuid.lowercased()], value.properties.contains(.read) else { return nil }
                return (label, value)
            }
            nextRead()
        }
    }

    func nextRead() {
        guard let p = peripheral else { return }
        if reads.isEmpty {
            subscriptions = channels.compactMap { _, uuid in characteristics[uuid.replacingOccurrences(of: "0001", with: "0003").lowercased()] }
            state["channels"] = channels.compactMap { name, uuid -> [String: Any]? in
                let notify = uuid.replacingOccurrences(of: "0001", with: "0003")
                let write = uuid.replacingOccurrences(of: "0001", with: "0002")
                guard characteristics[notify] != nil, characteristics[write] != nil else { return nil }
                return ["name": name, "serviceUuid": uuid, "notifications": 0, "receivedBytes": 0, "subscribed": false]
            }
            nextSubscription()
        } else {
            reading = reads.removeFirst()
            p.readValue(for: reading!.1)
        }
    }

    func nextSubscription() {
        guard let p = peripheral else { return }
        if subscriptions.isEmpty {
            state["connected"] = true; state["phase"] = "connected"
            state["maximumWriteBytes"] = p.maximumWriteValueLength(for: .withoutResponse)
            finish()
        } else { p.setNotifyValue(true, for: subscriptions.removeFirst()) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard connecting, peripheral === p else { return }
        guard error == nil, characteristic.isNotifying else {
            fail("Bluetooth notifications could not be enabled. Keep the watch in Pair Phone mode and confirm the macOS pairing prompt.", error); return
        }
        var values = state["channels"] as? [[String: Any]] ?? []
        for i in values.indices where (values[i]["serviceUuid"] as? String)?.replacingOccurrences(of: "0001", with: "0003") == characteristic.uuid.uuidString.lowercased() {
            values[i]["subscribed"] = true
        }
        state["channels"] = values
        nextSubscription()
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === p else { return }
        if let pending = reading, pending.1 === characteristic {
            reading = nil
            if error == nil, let data = characteristic.value {
                if pending.0 == "batteryPercent", data.count == 1, data[0] <= 100 { state[pending.0] = Int(data[0]) }
                else if pending.0 != "batteryPercent" { state[pending.0] = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .controlCharacters) ?? "" }
            }
            if connecting { nextRead() } else { finish() }
            return
        }
        guard error == nil, let data = characteristic.value else { return }
        let uuid = characteristic.uuid.uuidString.lowercased()
        var values = state["channels"] as? [[String: Any]] ?? []
        for i in values.indices where (values[i]["serviceUuid"] as? String)?.replacingOccurrences(of: "0001", with: "0003") == uuid {
            values[i]["notifications"] = (values[i]["notifications"] as? Int ?? 0) + 1
            values[i]["receivedBytes"] = (values[i]["receivedBytes"] as? Int ?? 0) + data.count
            values[i]["lastNotificationAt"] = Int64(Date().timeIntervalSince1970 * 1000)
        }
        state["channels"] = values
        let controlNotify = channels[0].1.replacingOccurrences(of: "0001", with: "0003")
        let bulkNotify = channels[1].1.replacingOccurrences(of: "0001", with: "0003")
        if uuid == controlNotify || uuid == bulkNotify { record("rx", uuid == controlNotify ? "control" : "bulk", data) }
        if operation == "musicInventoryPage", uuid == controlNotify || uuid == bulkNotify {
            do {
                guard let receiver = musicReceiver else { return }
                let result = try receiver.accept(data, control: uuid == controlNotify)
                if let payload = result.payload {
                    finish(extra: ["payload": payload.base64EncodedString()]); return
                }
                if !result.frames.isEmpty {
                    writeTarget = result.bulk ? characteristics[channels[1].1.replacingOccurrences(of: "0001", with: "0002")] : controlWrite()
                    writeFrames = result.frames
                    flushWrites()
                }
            } catch { fail("The watch returned an invalid or incomplete music inventory.") }
            return
        }
        if operation == "syncFileBlock", uuid == controlNotify || uuid == bulkNotify {
            do {
                guard let receiver = syncReceiver else { return }
                let result = try receiver.accept(data, control: uuid == controlNotify)
                if let payload = result.payload {
                    syncReceiver = nil
                    finish(extra: ["payload": payload.base64EncodedString()]); return
                }
                if !result.frames.isEmpty {
                    writeTarget = result.bulk ? characteristics[channels[1].1.replacingOccurrences(of: "0001", with: "0002")] : controlWrite()
                    writeFrames = result.frames
                    flushWrites()
                }
            } catch { fail("The watch returned invalid or incomplete records.") }
            return
        }
        // Decode only the bounded unsolicited events traced in the W332 firmware.
        // Authentication, notification text and other payloads never enter UI state.
        if uuid == controlNotify, var event = decodeWatchInteraction(data) {
            interactionSequence += 1
            event["id"] = interactionSequence
            event["receivedAt"] = Int64(Date().timeIntervalSince1970 * 1000)
            var events = state["watchEvents"] as? [[String: Any]] ?? []
            events.append(event); state["watchEvents"] = Array(events.suffix(12))
        }
        if operation == "musicDelete", uuid == controlNotify, data.first == 0xc1 {
            do {
                try musicDeleteReceiver?.acceptStorage(data)
                if let payload = musicDeleteReceiver?.result { finish(extra: ["payload": payload.base64EncodedString()]) }
            } catch { fail("The watch returned an invalid music delete response.") }
            return
        }
        let ota = operation == "officialOtaBlock" || operation == "lightMapOtaBlock"
        let dataFile = operation == "dataFileBlock"
        if (operation == "routeBlock" || operation == "watchfaceBlock" || operation == "musicDelete" || ota || dataFile), uuid == controlNotify, data.first == 0x78 {
            let fileIndex: UInt8 = ota || dataFile ? (UInt8(exactly: current?["fileId"] as? Int ?? 255) ?? 255) : operation == "musicDelete" ? 93 : operation == "watchfaceBlock" ? 8 : 0x14
            // A refusal is a single status byte (firmware: 2 busy, 3 bad header, 0x14/0x2b/0xfd file not accepted now).
            if data.count == 4, data[1] == 0, data[2] == data[3] {
                fail("The watch refused the file transfer (code \(data[2]))."); return
            }
            guard (data.count == 6 || data.count == 9), data[1] == 0,
                  data.dropFirst(2).dropLast().reduce(UInt8(0), { $0 &+ $1 }) == data.last else {
                fail("Invalid COROS file acknowledgement."); return
            }
            if routeStage == "ready" {
                if ota { responseBytes = data }
                if data[2] == 1, (data.count == 9 ? data[6] == 1 : data[4] == fileIndex) { finishFileTransfer(); return }
                guard data.count == 9, data[2] <= 1, data[6] == 1, data[4] >= 20,
                      (!ota || data[7] == 3),
                      let bulk = characteristics[channels[1].1.replacingOccurrences(of: "0001", with: "0002")] else {
                    fail("The watch rejected the file transfer header."); return
                }
                // A successful header reply can also acknowledge a cached block.
                if data[2] == 1 { finishFileTransfer(); return }
                let size = min(Int(data[4]), p.maximumWriteValueLength(for: .withoutResponse), 240) - 3
                let count = (routeBlock.count + size - 1) / size
                let window = ota ? Int(data[5]) : 256
                guard size >= 17, count <= 256, window > 0 else { fail("The file block exceeds the negotiated packet limit."); return }
                writeFrames = stride(from: 0, to: routeBlock.count, by: size).enumerated().map { sequence, offset in
                    Data([0x78, UInt8(sequence % window), fileIndex]) + routeBlock.subdata(in: offset..<min(offset + size, routeBlock.count))
                }
                routeStage = "complete"; writeTarget = bulk
                deadline(20, "The watch did not acknowledge the file data block.")
                flushWrites()
            } else {
                guard data[2] == 1, (data.count == 9 ? data[6] == 1 : data[4] == fileIndex),
                      writeFrames.isEmpty else {
                    fail("The watch rejected the file data block."); return
                }
                if ota { responseBytes = data }
                finishFileTransfer()
            }
            return
        }
        if operation == "exchange", uuid == controlNotify, data.first == expectedOpcode {
            guard data.count >= 3 else { fail("Invalid COROS response frame."); return }
            if let previous = responseRemaining, previous == 0 || data[1] != previous - 1 {
                fail("Invalid COROS response frame sequence."); return
            }
            responseRemaining = data[1]; responseBytes.append(data.dropFirst(2))
            guard responseBytes.count <= 4096 else { fail("COROS response is too large."); return }
            if data[1] == 0 {
                guard let checksum = responseBytes.last, responseBytes.dropLast().reduce(UInt8(0), { $0 &+ $1 }) == checksum else {
                    fail("COROS response checksum failed."); return
                }
                let payload = Data(responseBytes.dropLast())
                writeFrames.removeAll(); responseBytes = Data(); responseRemaining = nil
                finish(extra: ["payload": payload.base64EncodedString()])
            }
        }
    }

    func controlWrite() -> CBCharacteristic? {
        characteristics[channels[0].1.replacingOccurrences(of: "0001", with: "0002")]
    }

    func finishFileTransfer() {
        if operation == "officialOtaBlock" || operation == "lightMapOtaBlock" {
            finish(extra: ["payload": responseBytes.base64EncodedString()]); return
        }
        guard let receiver = musicDeleteReceiver else { finish(); return }
        receiver.fileAcknowledged = true
        if let payload = receiver.result { finish(extra: ["payload": payload.base64EncodedString()]); return }
        routeStage = "deletion"
        deadline(20, "The watch did not confirm music deletion.")
    }

    func flushWrites() {
        guard let p = peripheral, let characteristic = writeTarget ?? controlWrite() else { return }
        while !writeFrames.isEmpty, p.canSendWriteWithoutResponse {
            let frame = writeFrames.removeFirst()
            record("tx", characteristic === controlWrite() ? "control" : "bulk", frame)
            p.writeValue(frame, for: characteristic, type: .withoutResponse)
            if characteristic === controlWrite() { state["controlWrites"] = (state["controlWrites"] as? Int ?? 0) + 1 }
        }
        if operation == "sendNotification", writeFrames.isEmpty { finish() }
    }

    func peripheralIsReady(toSendWriteWithoutResponse p: CBPeripheral) { flushWrites() }

    func peripheral(_ p: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
        guard peripheral === p else { return }
        if error == nil, RSSI.intValue != 127 { state["rssiDbm"] = RSSI.intValue }
        if operation == "status" { finish() }
    }

    func shutdown() {
        central?.stopScan()
        if let p = peripheral { central?.cancelPeripheralConnection(p) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
    }
}

func decodeWatchInteraction(_ data: Data) -> [String: Any]? {
    guard data.count >= 4, data[1] == 0,
          data.dropFirst(2).dropLast().reduce(UInt8(0), { $0 &+ $1 }) == data.last else { return nil }
    if data[0] == 0xC5, data.count == 5, (1...7).contains(data[2]) {
        return ["kind": "media-control", "action": Int(data[2]), "value": Int(data[3])]
    }
    if data[0] == 2, data.count == 4, data[2] == 2 { return ["kind": "call-rejected"] }
    return nil
}

/// Files CorosLink pushes like the phone app: workout and weather.
let pushedDataFiles: Set<UInt8> = [41, 80]

func fileLimit(_ fileIndex: UInt8) -> Int {
    fileIndex == 9 ? 7025507 : fileIndex == 8 ? 0x320000
        : pushedDataFiles.contains(fileIndex) ? 65_536 : 2_000_000
}

func validFileBlock(_ header: Data, _ block: Data, _ fileIndex: UInt8) -> Bool {
    guard header.count == 21, block.count > 0, block.count <= 4096,
          (fileIndex == 8 || fileIndex == 0x14 || fileIndex == 93 || fileIndex == 9 || fileIndex == 50 || pushedDataFiles.contains(fileIndex)), Array(header.prefix(3)) == [0x78, 0, fileIndex],
          (fileIndex != 8 || header[16] < 10), Array(header[17..<20]) == [0, 0, 3] else { return false }
    func little(_ offset: Int, _ count: Int) -> Int {
        (0..<count).reduce(0) { $0 | Int(header[offset + $1]) << ($1 * 8) }
    }
    if fileIndex == 93 && (header[16] != 0 || little(3, 4) != 0 || little(9, 4) != block.count || !validMusicDeleteFile(block)) { return false }
    var crc: UInt16 = 0xffff
    for byte in block {
        crc ^= UInt16(byte) << 8
        for _ in 0..<8 { crc = (crc &<< 1) ^ (crc & 0x8000 == 0 ? 0 : 0x1021) }
    }
    return little(7, 2) == block.count && little(9, 4) >= block.count &&
        little(9, 4) <= fileLimit(fileIndex) && little(3, 4) + little(9, 4) <= fileLimit(fileIndex) &&
        little(13, 2) == Int(crc) && block.reduce(UInt8(0), { $0 &+ $1 }) == header[15] &&
        header[2..<20].reduce(UInt8(0), { $0 &+ $1 }) == header[20]
}

// Development-only official W332 3.2008.0 rehearsal. The caller pins whole-file
// SHA256 before transport; this helper independently bounds each raw block.
func validOfficialOtaBlock(_ header: Data, _ block: Data, _ fileIndex: UInt8) -> Bool {
    guard validFileBlock(header, block, fileIndex), fileIndex == 9 || fileIndex == 50,
          header[16] == 0 else { return false }
    let offset = (0..<4).reduce(0) { $0 | Int(header[3 + $1]) << ($1 * 8) }
    let remaining = (0..<4).reduce(0) { $0 | Int(header[9 + $1]) << ($1 * 8) }
    let total = fileIndex == 9 ? 7025507 : 285172
    return offset % 4096 == 0 && offset + remaining == total && block.count == min(4096, remaining)
}

// Only the locally pinned light map length is accepted on this separate path.
// System9 continues to use the original-only operation and its existing bounds.
func validLightMapOtaBlock(_ header: Data, _ block: Data, _ fileIndex: UInt8) -> Bool {
    guard fileIndex == 50, validFileBlock(header, block, fileIndex), header[16] == 0 else { return false }
    let offset = (0..<4).reduce(0) { $0 | Int(header[3 + $1]) << ($1 * 8) }
    let remaining = (0..<4).reduce(0) { $0 | Int(header[9 + $1]) << ($1 * 8) }
    return offset % 4096 == 0 && offset + remaining == 285318 && block.count == min(4096, remaining)
}

// Read-only W332 music metadata (storage category 0, SFT file 93). This
// receiver cannot request an audio file, upload a file, or delete a track.
enum CorosMusicReadError: Error { case invalid }
struct CorosMusicReadResult {
    var frames: [Data] = []
    var bulk = false
    var payload: Data?
}
final class CorosMusicPageReceiver {
    let page: Int
    var file = Data()
    var block = Data()
    var header = Data()
    var controlBytes = Data()
    var controlRemaining: UInt8?
    var sequence = 0
    var stage = "header"
    var total: Int?
    init(page: Int) { self.page = page }

    func little(_ data: Data, _ offset: Int, _ size: Int) -> Int {
        (0..<size).reduce(0) { $0 | Int(data[offset + $1]) << ($1 * 8) }
    }
    func integer(_ value: Int, _ size: Int) -> Data {
        Data((0..<size).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) })
    }
    func frames(_ opcode: UInt8, _ payload: Data) -> [Data] {
        var logical = payload
        logical.append(payload.reduce(UInt8(0)) { $0 &+ $1 })
        let count = (logical.count + 17) / 18
        return stride(from: 0, to: logical.count, by: 18).enumerated().map { index, offset in
            Data([opcode, UInt8(count - index - 1)]) + logical.subdata(in: offset..<min(offset + 18, logical.count))
        }
    }
    func requestFrames() -> [Data] {
        // Mobile's epoch is 2014-01-01; timezone is in fifteen-minute units.
        let time = Int(Date().timeIntervalSince1970) - 1_388_534_400
        let zone = TimeZone.current.secondsFromGMT() / 900
        let payload = Data([93]) + integer(file.count, 4) + Data([0]) + integer(time, 4)
            + Data([UInt8(truncatingIfNeeded: zone), 3]) + integer(0, 4) + integer(page, 4)
        return frames(0x7c, payload)
    }
    func accept(_ data: Data, control: Bool) throws -> CorosMusicReadResult {
        if control {
            let opcode: UInt8 = stage == "ack" ? 0x7d : 0x7c
            guard data.first == opcode else { return CorosMusicReadResult() }
            guard data.count >= 3, controlRemaining == nil || (controlRemaining! > 0 && data[1] == controlRemaining! - 1) else { throw CorosMusicReadError.invalid }
            controlRemaining = data[1]; controlBytes.append(data.dropFirst(2))
            guard controlBytes.count <= 512 else { throw CorosMusicReadError.invalid }
            if data[1] != 0 { return CorosMusicReadResult() }
            guard controlBytes.dropLast().reduce(UInt8(0), { $0 &+ $1 }) == controlBytes.last else { throw CorosMusicReadError.invalid }
            let payload = Data(controlBytes.dropLast())
            controlBytes = Data(); controlRemaining = nil
            if stage == "ack" {
                guard payload == Data([1, 93]) else { throw CorosMusicReadError.invalid }
                if file.count == total { return CorosMusicReadResult(payload: file) }
                stage = "header"
                return CorosMusicReadResult(frames: requestFrames())
            }
            guard stage == "header", payload.count >= 19, payload[12] == 0,
                  payload[15] == 93, payload[16] == 3 else { throw CorosMusicReadError.invalid }
            let size = little(payload, 4, 2), remaining = little(payload, 6, 4)
            guard size > 0, size <= 12_288, size <= remaining, remaining <= 262_144,
                  payload[13] >= 20, payload[14] > 0 else { throw CorosMusicReadError.invalid }
            if let total = total {
                guard file.count + remaining == total else { throw CorosMusicReadError.invalid }
            } else { total = remaining }
            header = payload; block = Data(); sequence = 0; stage = "bulk"
            // Window requests use the bulk channel and have no SUM byte.
            return CorosMusicReadResult(frames: [Data([0x7c, 0, 93])], bulk: true)
        }
        guard data.count >= 3, data[0] == 0x7c, data[2] == 93 else { return CorosMusicReadResult() }
        guard stage == "bulk", data.count > 3, Int(data[1]) == sequence,
              data.count <= Int(header[13]), block.count + data.count - 3 <= little(header, 4, 2) else { throw CorosMusicReadError.invalid }
        block.append(data.dropFirst(3)); sequence += 1
        if block.count == little(header, 4, 2) {
            var crc: UInt16 = 0xffff
            for byte in block {
                crc ^= UInt16(byte) << 8
                for _ in 0..<8 { crc = (crc &<< 1) ^ (crc & 0x8000 == 0 ? 0 : 0x1021) }
            }
            guard Int(crc) == little(header, 10, 2) else { throw CorosMusicReadError.invalid }
            // The success bit acknowledges metadata; category 0 at +12 releases
            // its temporary listing cache. It does not delete stored music.
            let ack = integer(file.count, 4) + Data([1, 93]) + Data(repeating: 0, count: 10)
            file.append(block); stage = "ack"
            return CorosMusicReadResult(frames: frames(0x7d, ack))
        }
        if sequence == Int(header[14]) {
            sequence = 0
            return CorosMusicReadResult(frames: [Data([0x7c, 0, 93])], bulk: true)
        }
        return CorosMusicReadResult()
    }
}

// Read-only SyncData blocks for local activity sync (twin of scripts/coros_ble_activity.py).
// One request returns [remaining u32][block] after the CRC check. Nothing is ever
// acknowledged (0x7D moves the watch's sync pointer), so there is no operation for it.
let readOnlySyncFiles: Set<Int> = [14, 5]
let syncMaxBlockBytes = 12_288
let syncMaxFileBytes = 64 * 1024 * 1024

func syncFrames(_ opcode: UInt8, _ payload: Data) -> [Data] {
    var logical = payload
    logical.append(payload.reduce(UInt8(0)) { $0 &+ $1 })
    let count = (logical.count + 17) / 18
    return stride(from: 0, to: logical.count, by: 18).enumerated().map { index, offset in
        Data([opcode, UInt8(count - index - 1)]) + logical.subdata(in: offset..<min(offset + 18, logical.count))
    }
}

func syncLittle(_ data: Data, _ offset: Int, _ size: Int) -> Int {
    (0..<size).reduce(0) { $0 | Int(data[data.startIndex + offset + $1]) << ($1 * 8) }
}

func syncInteger(_ value: Int, _ size: Int) -> Data {
    Data((0..<size).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) })
}

func syncCrc16(_ data: Data) -> Int {
    var crc: UInt16 = 0xffff
    for byte in data {
        crc ^= UInt16(byte) << 8
        for _ in 0..<8 { crc = (crc &<< 1) ^ (crc & 0x8000 == 0 ? 0 : 0x1021) }
    }
    return Int(crc)
}

final class CorosSyncControlReply {
    let opcode: UInt8
    let limit: Int
    var bytes = Data()
    var remaining: UInt8?
    init(opcode: UInt8, limit: Int) { self.opcode = opcode; self.limit = limit }

    func accept(_ data: Data) throws -> Data? {
        guard data.first == opcode else { return nil }
        guard data.count >= 3, remaining == nil || (remaining! > 0 && data[data.startIndex + 1] == remaining! - 1) else { throw CorosMusicReadError.invalid }
        remaining = data[data.startIndex + 1]; bytes.append(data.dropFirst(2))
        guard bytes.count <= limit else { throw CorosMusicReadError.invalid }
        if remaining != 0 { return nil }
        guard bytes.dropLast().reduce(UInt8(0), { $0 &+ $1 }) == bytes.last else { throw CorosMusicReadError.invalid }
        let payload = Data(bytes.dropLast())
        bytes = Data(); remaining = nil
        return payload
    }
}

final class CorosSyncBlockReceiver {
    let fileIndex: UInt8
    let offset: Int
    let selector: Int
    let now: Int
    let utcOffset: Int
    let control = CorosSyncControlReply(opcode: 0x7c, limit: 512)
    var header = Data()
    var block = Data()
    var sequence = 0
    var stage = "header"

    init?(fileIndex: Int, offset: Int, selector: Int, now: Int? = nil, utcOffset: Int? = nil) {
        guard readOnlySyncFiles.contains(fileIndex), (0..<syncMaxFileBytes).contains(offset),
              (0...0xffff_ffff).contains(selector) else { return nil }
        self.fileIndex = UInt8(fileIndex); self.offset = offset; self.selector = selector
        self.now = now ?? Int(Date().timeIntervalSince1970)
        self.utcOffset = utcOffset ?? TimeZone.current.secondsFromGMT()
    }

    func requestFrames() -> [Data] {
        // Mobile's epoch is 2014-01-01; timezone is in fifteen-minute units.
        let payload = Data([fileIndex]) + syncInteger(offset, 4) + Data([0]) + syncInteger(now - 1_388_534_400, 4)
            + Data([UInt8(truncatingIfNeeded: utcOffset / 900), 3]) + syncInteger(0, 4) + syncInteger(selector, 4)
        return syncFrames(0x7c, payload)
    }

    func accept(_ data: Data, control isControl: Bool) throws -> CorosMusicReadResult {
        if isControl {
            guard let payload = try control.accept(data) else { return CorosMusicReadResult() }
            guard stage == "header", payload.count >= 19, payload[payload.startIndex + 12] == 0,
                  payload[payload.startIndex + 15] == fileIndex, payload[payload.startIndex + 16] == 3 else { throw CorosMusicReadError.invalid }
            let size = syncLittle(payload, 4, 2), remaining = syncLittle(payload, 6, 4)
            guard size > 0, size <= syncMaxBlockBytes, size <= remaining, remaining <= syncMaxFileBytes,
                  offset + remaining <= syncMaxFileBytes,
                  payload[payload.startIndex + 13] >= 20, payload[payload.startIndex + 14] > 0 else { throw CorosMusicReadError.invalid }
            header = payload; block = Data(); sequence = 0; stage = "bulk"
            // Window requests use the bulk channel and have no SUM byte.
            return CorosMusicReadResult(frames: [Data([0x7c, 0, fileIndex])], bulk: true)
        }
        guard data.count >= 3, data.first == 0x7c, data[data.startIndex + 2] == fileIndex else { return CorosMusicReadResult() }
        let size = header.isEmpty ? 0 : syncLittle(header, 4, 2)
        guard stage == "bulk", data.count > 3, Int(data[data.startIndex + 1]) == sequence,
              data.count <= Int(header[header.startIndex + 13]), block.count + data.count - 3 <= size else { throw CorosMusicReadError.invalid }
        block.append(data.dropFirst(3)); sequence += 1
        if block.count == size {
            guard syncCrc16(block) == syncLittle(header, 10, 2) else { throw CorosMusicReadError.invalid }
            stage = "done"
            return CorosMusicReadResult(payload: syncInteger(syncLittle(header, 6, 4), 4) + block)
        }
        if sequence == Int(header[header.startIndex + 14]) {
            sequence = 0
            return CorosMusicReadResult(frames: [Data([0x7c, 0, fileIndex])], bulk: true)
        }
        return CorosMusicReadResult()
    }
}

// A music delete completes only after both SFT transport and storage command C1.
final class CorosMusicDeleteReceiver {
    var fileAcknowledged = false
    var storagePayload: Data?
    var bytes = Data()
    var remaining: UInt8?
    var result: Data? { fileAcknowledged ? storagePayload : nil }

    func acceptStorage(_ frame: Data) throws {
        guard frame.count >= 3, frame[0] == 0xc1, storagePayload == nil,
              remaining == nil || (remaining! > 0 && frame[1] == remaining! - 1) else { throw CorosMusicReadError.invalid }
        remaining = frame[1]; bytes.append(frame.dropFirst(2))
        guard bytes.count <= 5 else { throw CorosMusicReadError.invalid }
        if frame[1] == 0 {
            guard bytes.count == 5, bytes[0] == 1, bytes[1] == 1, bytes[2] == 0,
                  bytes.dropLast().reduce(UInt8(0), { $0 &+ $1 }) == bytes.last else { throw CorosMusicReadError.invalid }
            storagePayload = Data(bytes.dropLast())
        }
    }
}

// Private worker boundary: exactly one local MP3 row, category 0, <=512 bytes.
func validMusicDeleteFile(_ file: Data) -> Bool {
    guard file.count >= 48, file.count <= 512 else { return false }
    let reader = CorosMusicPageReceiver(page: 0)
    func little(_ offset: Int, _ count: Int) -> Int { reader.little(file, offset, count) }
    func crc(_ value: Data) -> Int {
        var c: UInt16 = 0xffff
        for byte in value { c ^= UInt16(byte) << 8; for _ in 0..<8 { c = (c &<< 1) ^ (c & 0x8000 == 0 ? 0 : 0x1021) } }
        return Int(c)
    }
    let proto = file.subdata(in: 48..<file.count)
    guard Array(file[0..<4]) == [0x48, 0x46, 0, 93], little(8, 4) == file.count - 16,
          crc(file.subdata(in: 0..<14)) == little(14, 2), crc(file.subdata(in: 16..<file.count)) == little(12, 2),
          Array(file[16..<24]) == [0x48, 0x53, 0, 0, 0, 0, 0, 0], little(26, 2) == 44,
          little(30, 4) == file.count - 44, little(34, 4) == file.count - 44, little(38, 4) == 1,
          crc(file.subdata(in: 16..<42)) == little(42, 2), little(44, 4) == proto.count,
          crc(proto) == little(24, 2) else { return false }
    var offset = 0
    func varint() -> Int? {
        var value = 0
        for index in 0..<5 {
            guard offset < proto.count else { return nil }
            let byte = proto[offset]; offset += 1; value |= Int(byte & 127) << (index * 7)
            if byte & 128 == 0 { return value <= 0xffffffff ? value : nil }
        }
        return nil
    }
    guard varint() == 10, let size = varint(), size == proto.count - offset else { return false }
    var fields = Set<Int>()
    while offset < proto.count {
        guard let key = varint(), [8, 16, 26, 32].contains(key), !fields.contains(key) else { return false }
        fields.insert(key)
        if key == 26 {
            guard let count = varint(), count > 0, count <= 259, count <= proto.count - offset,
                  let path = String(data: proto.subdata(in: offset..<offset + count), encoding: .utf8),
                  path.hasPrefix("/emmc2:/Music/") else { return false }
            let name = path.dropFirst("/emmc2:/Music/".count)
            guard name.lowercased().hasSuffix(".mp3"), !name.contains("/"), !name.contains("\\"),
                  !name.unicodeScalars.contains(where: { $0.value < 32 }) else { return false }
            offset += count
        } else {
            guard let value = varint(), key != 8 || value == 1 else { return false }
        }
    }
    return fields.count == 4
}

let worker = BluetoothWorker()
emit(["ready": true])
DispatchQueue.global(qos: .userInitiated).async {
    // Bound requests without storing arbitrary-sized stdin, even if a parent fails.
    var buffer = Data()
    while true {
        let chunk = FileHandle.standardInput.availableData
        if chunk.isEmpty { DispatchQueue.main.async { worker.shutdown() }; break }
        buffer.append(chunk)
        if buffer.count > 32_768 { exit(1) }
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer.subdata(in: 0..<newline)
            buffer.removeSubrange(0...newline)
            if let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any] {
                DispatchQueue.main.async { worker.enqueue(value) }
            }
        }
    }
}
RunLoop.main.run()
