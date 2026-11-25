// One request at a time over btleplug (CoreBluetooth on macOS, WinRT on Windows, BlueZ on Linux), answering with the
// same JSON as CorosLink's helpers (native/corebluetooth/main.swift and scripts/coros-system-ble.py), so the app's
// TypeScript drives every platform the same way.
//
// The helper only moves GATT frames. Account keys never reach it: the app signs the watch's sign-in challenge itself
// and sends the answer through `exchange`. Error texts are fixed; failure details carry the step and states only,
// never payloads or device identifiers (a mismatched watch's identity travels outside `detail`).
use std::collections::{BTreeMap, HashMap};
use std::pin::Pin;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use btleplug::api::{Central, CentralEvent, CentralState, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, ValueNotification, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral, PeripheralId};
use futures::{Stream, StreamExt};
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use tokio::time::{sleep_until, Instant};
use uuid::Uuid;

use crate::protocol::{self, chunked, sum, InteractiveReceiver, MusicDeleteReceiver, MusicPageReceiver, SyncBlockReceiver, SyncError};

/// The three COROS services; each has a write characteristic (…0002…) and a notify one (…0003…).
const CHANNELS: [(&str, &str); 3] = [
    ("control", "6e400001-b5a3-f393-e0a9-77656c6f6f70"),
    ("bulk", "6e400001-b5a3-f393-e0a9-e50e24dcca9e"),
    ("auxiliary", "6e400001-b5a3-f393-e0a9-77757c7f7f70"),
];
/// Device Information and battery, read once on connect.
const STANDARD_READS: [(&str, &str); 8] = [
    ("deviceNameValue", "2a00"),
    ("batteryPercent", "2a19"),
    ("modelNumber", "2a24"),
    ("serialNumber", "2a25"),
    ("firmwareRevision", "2a26"),
    ("hardwareRevision", "2a27"),
    ("softwareRevision", "2a28"),
    ("manufacturerName", "2a29"),
];

#[cfg(target_os = "macos")]
const TRANSPORT: &str = "corebluetooth";
#[cfg(target_os = "windows")]
const TRANSPORT: &str = "winrt";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const TRANSPORT: &str = "bluez";

#[cfg(target_os = "macos")]
mod text {
    pub const PERMISSION: &str = "Bluetooth permission or startup did not complete. Check System Settings → Privacy & Security → Bluetooth.";
    pub const UNAUTHORIZED: &str = "Allow C-LINK Bluetooth access in System Settings → Privacy & Security → Bluetooth.";
    pub const POWERED_OFF: &str = "Turn on Bluetooth in macOS, then try again.";
    pub const UNAVAILABLE: &str = "Bluetooth is unavailable on this Mac.";
    pub const NO_CONNECT: &str = "The watch did not connect. Open System → Pair Phone on the watch, keep it nearby, and confirm any macOS pairing prompt.";
    pub const CONNECT_FAILED: &str = "The watch could not connect. Keep it awake in Pair Phone mode and confirm any macOS pairing prompt.";
    pub const NOTIFY_FAILED: &str = "Bluetooth notifications could not be enabled. Keep the watch in Pair Phone mode and confirm the macOS pairing prompt.";
    pub const BATTERY: &str = "Battery read did not complete. Keep the watch awake and confirm any macOS pairing prompt.";
}
#[cfg(target_os = "windows")]
mod text {
    pub const PERMISSION: &str = "Bluetooth did not start. Check that Bluetooth is on in Windows Settings → Bluetooth & devices.";
    pub const UNAUTHORIZED: &str = "Allow C-LINK to use Bluetooth in Windows Settings → Privacy & security.";
    pub const POWERED_OFF: &str = "Turn on Bluetooth in Windows, then try again.";
    pub const UNAVAILABLE: &str = "Bluetooth is unavailable on this computer.";
    pub const NO_CONNECT: &str = "The watch did not connect. Open System → Pair Phone on the watch, keep it nearby, and confirm any Windows pairing prompt.";
    pub const CONNECT_FAILED: &str = "The watch could not connect. Keep it awake in Pair Phone mode and confirm any Windows pairing prompt.";
    pub const NOTIFY_FAILED: &str = "Bluetooth notifications could not be enabled. Keep the watch in Pair Phone mode and confirm any Windows pairing prompt.";
    pub const BATTERY: &str = "Battery read did not complete. Keep the watch awake and confirm any Windows pairing prompt.";
    pub const PAIR_FAILED: &str = "Pairing with the watch failed. Confirm any Windows pairing prompt. If pairing keeps failing, remove the watch under Settings → Bluetooth & devices and try again.";
    pub const UNPAIR_FAILED: &str = "The old Windows pairing with the watch could not be removed. Remove the watch under Settings → Bluetooth & devices, then try again.";
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod text {
    pub const PERMISSION: &str = "Bluetooth did not start. Check that BlueZ is running and Bluetooth is on.";
    pub const UNAUTHORIZED: &str = "C-LINK isn't allowed to use Bluetooth. Check that your user may use BlueZ.";
    pub const POWERED_OFF: &str = "Turn on Bluetooth, then try again.";
    pub const UNAVAILABLE: &str = "Bluetooth is unavailable on this computer.";
    pub const NO_CONNECT: &str = "The watch did not connect. Open System → Pair Phone on the watch, keep it nearby, and confirm any pairing prompt.";
    pub const CONNECT_FAILED: &str = "The watch could not connect. Keep it awake in Pair Phone mode and confirm any pairing prompt.";
    pub const NOTIFY_FAILED: &str = "Bluetooth notifications could not be enabled. Keep the watch in Pair Phone mode and confirm any pairing prompt.";
    pub const BATTERY: &str = "Battery read did not complete. Keep the watch awake and confirm any pairing prompt.";
    #[cfg(target_os = "linux")]
    pub const PAIR_FAILED: &str = "Pairing with the watch failed. Check that Bluetooth is on, the watch is awake, and any pairing prompt is confirmed. BlueZ and a pairing agent must be running.";
}
const MISMATCH: &str = "This doesn\u{2019}t look like the watch you connected before.";
const DISCONNECTED: &str = "The watch disconnected. Keep it nearby and reconnect.";

/// Where a request failed, for the app's diagnostics: this file and line.
macro_rules! site {
    () => {
        concat!("worker.rs:", line!())
    };
}

fn standard_uuid(short: &str) -> String {
    format!("0000{short}-0000-1000-8000-00805f9b34fb")
}
fn write_uuid(service: &str) -> String {
    service.replacen("0001", "0002", 1)
}
fn notify_uuid(service: &str) -> String {
    service.replacen("0001", "0003", 1)
}
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// A watch's identity as the app remembers it: CoreBluetooth's UUID on macOS (as Swift prints it), the Bluetooth
/// address elsewhere (as bleak prints it), so identities saved by CorosLink's helpers still match.
fn device_id(p: &Peripheral) -> String {
    #[cfg(target_os = "macos")]
    {
        p.id().to_string().to_uppercase()
    }
    #[cfg(not(target_os = "macos"))]
    {
        p.address().to_string()
    }
}

/// A remembered identity in the form `device_id` gives, or None when it can't be one.
fn identity(text: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        Uuid::parse_str(text).ok().map(|u| u.hyphenated().to_string().to_uppercase())
    }
    #[cfg(not(target_os = "macos"))]
    {
        // As the Python helper: any non-empty identity up to 128 characters, compared as an address.
        (!text.is_empty() && text.len() <= 128).then(|| text.to_uppercase())
    }
}

/// The device an advertising event is about (not connects, disconnects or adapter state). BlueZ announces a device
/// once and its later adverts only as RSSI or data updates, so all of these count.
fn advertiser(event: &CentralEvent) -> Option<&PeripheralId> {
    match event {
        CentralEvent::DeviceDiscovered(id)
        | CentralEvent::DeviceUpdated(id)
        | CentralEvent::RssiUpdate { id, .. }
        | CentralEvent::ManufacturerDataAdvertisement { id, .. }
        | CentralEvent::ServiceDataAdvertisement { id, .. }
        | CentralEvent::ServicesAdvertisement { id, .. } => Some(id),
        _ => None,
    }
}

/// The error's kind, never its text (which can carry identifiers).
fn error_kind(error: &btleplug::Error) -> &'static str {
    use btleplug::Error::*;
    match error {
        PermissionDenied => "PermissionDenied",
        DeviceNotFound => "DeviceNotFound",
        NotConnected => "NotConnected",
        UnexpectedCallback => "UnexpectedCallback",
        UnexpectedCharacteristic => "UnexpectedCharacteristic",
        NoSuchCharacteristic => "NoSuchCharacteristic",
        NoAdapterAvailable => "NoAdapterAvailable",
        NotSupported(_) => "NotSupported",
        TimedOut(_) => "TimedOut",
        Uuid(_) => "Uuid",
        InvalidBDAddr(_) => "InvalidBDAddr",
        RuntimeError(_) => "RuntimeError",
        Other(_) => "Other",
        #[allow(unreachable_patterns)]
        _ => "Unknown",
    }
}

pub fn emit(value: &Value) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

/// Notifications, drained from btleplug as they arrive (its own buffer keeps only 16 and drops the rest).
type Notes = mpsc::UnboundedReceiver<ValueNotification>;
type Events = Pin<Box<dyn Stream<Item = CentralEvent> + Send>>;

enum Wake {
    Note(Uuid, Vec<u8>),
    Disconnected,
    Deadline,
}

/// A request ended: answered (with extra fields) or refused (message, extra fields, extra `detail` fields, site,
/// timed out, error kind).
enum End {
    Done(Map<String, Value>),
    Failed { message: String, extra: Map<String, Value>, detail: Map<String, Value>, site: &'static str, timed_out: bool, error: Option<&'static str> },
}

fn done() -> End {
    End::Done(Map::new())
}
fn done_with(payload: &[u8]) -> End {
    let mut extra = Map::new();
    extra.insert("payload".into(), json!(B64.encode(payload)));
    End::Done(extra)
}
fn failed(message: impl Into<String>, site: &'static str) -> End {
    End::Failed { message: message.into(), extra: Map::new(), detail: Map::new(), site, timed_out: false, error: None }
}
/// Development only (CLINK_BLE_DEBUG): a line on stderr. Never payloads or keys.
fn debug(line: impl std::fmt::Display) {
    if std::env::var_os("CLINK_BLE_DEBUG").is_some() {
        eprintln!("clink-ble: {line}");
    }
}

fn failed_error(message: impl Into<String>, site: &'static str, error: &btleplug::Error) -> End {
    debug(format_args!("{site}: {error}"));
    End::Failed { message: message.into(), extra: Map::new(), detail: Map::new(), site, timed_out: false, error: Some(error_kind(error)) }
}
fn timed_out(message: impl Into<String>, site: &'static str) -> End {
    End::Failed { message: message.into(), extra: Map::new(), detail: Map::new(), site, timed_out: true, error: None }
}
fn mismatch(id: String, site: &'static str) -> End {
    let mut extra = Map::new();
    extra.insert("mismatch".into(), json!({ "deviceId": id }));
    End::Failed { message: MISMATCH.into(), extra, detail: Map::new(), site, timed_out: false, error: None }
}
/// The watch refused a sync read (CorosKit's WatchSyncFile.Refused): its code goes in `detail.refusedCode`.
fn refused(code: u8, site: &'static str, timed_out: bool) -> End {
    let message = match code {
        protocol::ANOTHER_SYNC => "Another app is syncing with the watch. C-LINK reads it again later.".to_string(),
        0x16 => "The watch is busy with a workout or another sync. C-LINK reads it again later.".to_string(),
        _ => format!("The watch refused the read (code {code})."),
    };
    let mut detail = Map::new();
    detail.insert("refusedCode".into(), json!(code));
    End::Failed { message, extra: Map::new(), detail, site, timed_out, error: None }
}

/// The remembered watch a connect must find: its identity, and the serial number that lets another identity stand in.
struct Identity {
    pinned: Option<String>,
    serial: Option<String>,
}

/// Whether a subscribe failed the way a Windows request to an unpaired watch does (the Python helper's
/// PAIRING_REQUIRED_CODES or "Access Denied"). btleplug reports the GATT status only, not the ATT code, so a
/// protocol error counts too; Windows pairs only when it lists the watch as unpaired.
#[cfg(target_os = "windows")]
fn pairing_required(error: &btleplug::Error) -> bool {
    match error {
        btleplug::Error::PermissionDenied => true,
        btleplug::Error::NotSupported(text) => text == "ProtocolError",
        btleplug::Error::Other(e) => pairing_refusal(&e.to_string()),
        _ => false,
    }
}
/// btleplug's WinRT subscribe failure text: `GattCommunicationStatus(2)` protocol error, `(3)` access denied.
#[cfg(any(target_os = "windows", test))]
fn pairing_refusal(text: &str) -> bool {
    text.ends_with("GattCommunicationStatus(2)") || text.ends_with("GattCommunicationStatus(3)")
}

/// Early return with an End.
macro_rules! bail {
    ($end:expr) => {
        return $end
    };
}

pub struct Worker {
    adapter: Option<Adapter>,
    events: Option<Events>,
    notes: Option<Notes>,
    peripheral: Option<Peripheral>,
    characteristics: HashMap<String, Characteristic>,
    state: Map<String, Value>,
    discovered: BTreeMap<String, Value>,
    interaction_sequence: u64,
    capture: Option<Vec<Value>>,
    capture_chars: usize,
    started: Instant,
    /// The helper's start, the clock interactive messages are timed on.
    created: Instant,
    operation: String,
    route_stage: String,
    queued: usize,
    /// The watch's unasked 0x0D messages (live workout data), reassembled apart from any request.
    interactive: InteractiveReceiver,
    /// Where a connect is (scan, connect, subscribe, pair, unpair), reported in a failed connect's `detail.step`.
    step: &'static str,
    /// The last subscribe failed the way an unpaired request does (Windows pairs then).
    #[cfg(target_os = "windows")]
    pairing_required: bool,
    /// This connect removed a Windows pairing the watch no longer honours.
    stale_pairing_cleared: bool,
}

impl Worker {
    pub fn new() -> Self {
        let mut state = Map::new();
        for (key, value) in [
            ("phase", json!("idle")),
            ("connected", json!(false)),
            ("encrypted", json!(false)),
            ("pairingManagedByOS", json!(true)),
            ("systemBind", json!("unavailable")),
            ("backend", json!("system")),
            ("transport", json!(TRANSPORT)),
            ("helper", json!("clink-ble")),
            ("channels", json!([])),
        ] {
            state.insert(key.into(), value);
        }
        Worker {
            adapter: None,
            events: None,
            notes: None,
            peripheral: None,
            characteristics: HashMap::new(),
            state,
            discovered: BTreeMap::new(),
            interaction_sequence: 0,
            capture: None,
            capture_chars: 0,
            started: Instant::now(),
            created: Instant::now(),
            operation: String::new(),
            route_stage: String::new(),
            queued: 0,
            interactive: InteractiveReceiver::default(),
            step: "",
            #[cfg(target_os = "windows")]
            pairing_required: false,
            stale_pairing_cleared: false,
        }
    }

    pub fn set_queued(&mut self, queued: usize) {
        self.queued = queued;
    }

    // ── Requests ────────────────────────────────────────────────────────────────────────────────────────────────

    pub async fn handle(&mut self, request: Value) {
        let Some(id) = request.get("id").and_then(Value::as_i64) else { return };
        self.operation = request.get("operation").and_then(Value::as_str).unwrap_or("").to_string();
        self.started = Instant::now();
        self.route_stage.clear();
        let capturing = request.get("capture").and_then(Value::as_bool) == Some(true)
            && ["syncFileBlock", "exchange", "exchangeFrames", "musicInventoryPage", "musicDelete"].contains(&self.operation.as_str());
        self.capture = capturing.then(Vec::new);
        self.capture_chars = 0;

        let end = match self.operation.as_str() {
            // Not in CorosLink's helpers: whether Bluetooth is on and allowed, for C-LINK's Watch page.
            "hello" => match self.adapter(Instant::now() + Duration::from_secs(10)).await {
                Ok(_) => done(),
                Err(end) => end,
            },
            "scan" => self.scan().await,
            "connect" => self.connect(&request).await,
            "status" => self.status().await,
            "refresh" => self.refresh().await,
            "exchange" => self.exchange(&request).await,
            "exchangeFrames" => self.exchange_frames(&request).await,
            "musicInventoryPage" => self.music_page(&request).await,
            "syncFileBlock" => self.sync_block(&request).await,
            "sendNotification" => self.send_notification(&request).await,
            "routeBlock" | "watchfaceBlock" | "musicDelete" | "officialOtaBlock" | "lightMapOtaBlock" | "dataFileBlock" => self.file_block(&request).await,
            "disconnect" => self.disconnect().await,
            _ => failed("Unsupported Bluetooth operation.", site!()),
        };
        self.answer(id, end).await;
        self.operation.clear();
        self.route_stage.clear();
    }

    async fn answer(&mut self, id: i64, end: End) {
        let capture = self.capture.take();
        let mut response = Map::new();
        response.insert("id".into(), json!(id));
        match end {
            End::Done(extra) => {
                self.state.insert("updatedAt".into(), json!(now_ms()));
                response.insert("result".into(), Value::Object(self.state.clone()));
                response.extend(extra);
            }
            End::Failed { message, extra, detail: more, site, timed_out, error } => {
                let mut detail = Map::new();
                detail.insert("site".into(), json!(site));
                detail.insert("operation".into(), json!(self.operation));
                detail.insert("elapsedMs".into(), json!(self.started.elapsed().as_millis() as u64));
                detail.insert("timedOut".into(), json!(timed_out));
                detail.insert("bluetoothState".into(), self.state.get("bluetoothState").cloned().unwrap_or(json!("unknown")));
                detail.insert("peripheralState".into(), json!(self.peripheral_state().await));
                detail.insert("characteristics".into(), json!(self.characteristics.len()));
                detail.insert("queued".into(), json!(self.queued));
                if !self.route_stage.is_empty() {
                    detail.insert("routeStage".into(), json!(self.route_stage));
                }
                if let Some(kind) = error {
                    detail.insert("errorDomain".into(), json!("btleplug"));
                    detail.insert("errorKind".into(), json!(kind));
                }
                detail.extend(more);
                if self.operation == "connect" {
                    // As the Python helper: the connect step, and whether a stale Windows pairing was removed.
                    if !self.step.is_empty() {
                        detail.insert("step".into(), json!(self.step));
                    }
                    if self.stale_pairing_cleared {
                        detail.insert("staleBondCleared".into(), json!(true));
                    }
                    self.step = "";
                    self.drop_link().await;
                    self.state.insert("phase".into(), json!("failed"));
                }
                response.insert("error".into(), json!(message));
                response.insert("detail".into(), Value::Object(detail));
                response.extend(extra);
            }
        }
        if let Some(frames) = capture {
            response.insert("capture".into(), Value::Array(frames));
        }
        emit(&Value::Object(response));
    }

    async fn peripheral_state(&self) -> &'static str {
        match &self.peripheral {
            None => "none",
            Some(p) => match p.is_connected().await {
                Ok(true) => "connected",
                _ => "disconnected",
            },
        }
    }

    // ── Bluetooth start, waiting ────────────────────────────────────────────────────────────────────────────────

    /// The adapter, powered on, within `deadline`.
    async fn adapter(&mut self, deadline: Instant) -> Result<Adapter, End> {
        if self.adapter.is_none() {
            let manager = match Manager::new().await {
                Ok(m) => m,
                // macOS refuses up front when Bluetooth access was denied in System Settings.
                Err(btleplug::Error::PermissionDenied) => {
                    self.state.insert("bluetoothState".into(), json!("unauthorized"));
                    return Err(failed(text::UNAUTHORIZED, site!()));
                }
                Err(e) => return Err(failed_error(text::UNAVAILABLE, site!(), &e)),
            };
            let adapter = manager.adapters().await.ok().and_then(|a| a.into_iter().next());
            let Some(adapter) = adapter else {
                self.state.insert("bluetoothState".into(), json!("unsupported"));
                return Err(failed(text::UNAVAILABLE, site!()));
            };
            self.events = adapter.events().await.ok();
            self.adapter = Some(adapter);
        }
        let adapter = self.adapter.clone().unwrap();
        loop {
            match adapter.adapter_state().await {
                Ok(CentralState::PoweredOn) => {
                    self.state.insert("bluetoothState".into(), json!("powered_on"));
                    return Ok(adapter);
                }
                Ok(CentralState::PoweredOff) => {
                    self.state.insert("bluetoothState".into(), json!("powered_off"));
                    return Err(failed(text::POWERED_OFF, site!()));
                }
                // Unknown: still starting, or waiting on the macOS permission prompt.
                _ => {}
            }
            if Instant::now() >= deadline {
                return Err(timed_out(text::PERMISSION, site!()));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    /// The next notification, a disconnect of our watch, or the deadline. Other central events are dropped.
    async fn wait(&mut self, deadline: Instant) -> Wake {
        loop {
            let ours = self.peripheral.as_ref().map(|p| p.id());
            let (notes, events) = (&mut self.notes, &mut self.events);
            tokio::select! {
                note = recv(notes) => match note {
                    Some(n) => return Wake::Note(n.uuid, n.value),
                    None => self.notes = None,
                },
                event = next(events) => match event {
                    Some(CentralEvent::DeviceDisconnected(id)) if Some(&id) == ours.as_ref() => {
                        if !self.connected().await {
                            return Wake::Disconnected;
                        }
                    }
                    Some(CentralEvent::StateUpdate(CentralState::PoweredOff)) => {
                        self.state.insert("bluetoothState".into(), json!("powered_off"));
                        return Wake::Disconnected;
                    }
                    Some(_) => {}
                    None => self.events = None,
                },
                _ = sleep_until(deadline) => return Wake::Deadline,
            }
        }
    }

    /// Between requests: watch events, the USB prompt, and the link dropping.
    pub async fn idle(&mut self) {
        let ours = self.peripheral.as_ref().map(|p| p.id());
        let (notes, events) = (&mut self.notes, &mut self.events);
        tokio::select! {
            note = recv(notes) => match note {
                Some(n) => { self.observe(n.uuid, &n.value); }
                None => self.notes = None,
            },
            event = next(events) => match event {
                Some(CentralEvent::DeviceDisconnected(id)) if Some(&id) == ours.as_ref() => {
                    if !self.connected().await {
                        self.clear_connection();
                        emit(&json!({ "event": "disconnected", "detail": {} }));
                    }
                }
                Some(CentralEvent::StateUpdate(CentralState::PoweredOff)) => {
                    self.state.insert("bluetoothState".into(), json!("powered_off"));
                    if self.peripheral.is_some() {
                        self.clear_connection();
                        emit(&json!({ "event": "disconnected", "detail": {} }));
                    }
                }
                Some(_) => {}
                None => self.events = None,
            },
        }
    }

    /// What every notification does: channel counters, the developer capture, the USB prompt (consumed), and the
    /// watch's media keys / call events. Returns false when the notification was consumed.
    fn observe(&mut self, uuid: Uuid, data: &[u8]) -> bool {
        let uuid = uuid.to_string();
        if let Some(Value::Array(channels)) = self.state.get_mut("channels") {
            for channel in channels.iter_mut() {
                if channel.get("serviceUuid").and_then(Value::as_str).map(notify_uuid).as_deref() == Some(uuid.as_str()) {
                    let n = channel["notifications"].as_u64().unwrap_or(0) + 1;
                    let bytes = channel["receivedBytes"].as_u64().unwrap_or(0) + data.len() as u64;
                    channel["notifications"] = json!(n);
                    channel["receivedBytes"] = json!(bytes);
                    channel["lastNotificationAt"] = json!(now_ms());
                }
            }
        }
        let control = uuid == notify_uuid(CHANNELS[0].1);
        let bulk = uuid == notify_uuid(CHANNELS[1].1);
        if control || bulk {
            self.record("rx", if control { "control" } else { "bulk" }, data);
        }
        if control {
            if let Some(event) = protocol::decode_usb_access(data) {
                emit(&json!({ "event": event }));
                return false;
            }
            // The watch's own messages (live workout data and the like), as CorosKit's onInteractive. Not consumed:
            // no request waits on 0x0D, and CorosLink's helpers passed them on the same way.
            if data.first() == Some(&protocol::INTERACTIVE_OPCODE) {
                let time = self.created.elapsed().as_secs_f64();
                for (subtype, body) in self.interactive.accept(data, time) {
                    emit(&json!({ "event": "interactive", "subtype": subtype, "payload": B64.encode(body) }));
                }
            }
        }
        // Music and sync reads take their frames before watch events are decoded, as the Swift helper does.
        if control && !["musicInventoryPage", "syncFileBlock"].contains(&self.operation.as_str()) {
            if let Some(mut event) = protocol::decode_watch_interaction(data) {
                self.interaction_sequence += 1;
                event["id"] = json!(self.interaction_sequence);
                event["receivedAt"] = json!(now_ms());
                let mut events = self.state.get("watchEvents").and_then(Value::as_array).cloned().unwrap_or_default();
                events.push(event);
                let skip = events.len().saturating_sub(12);
                self.state.insert("watchEvents".into(), Value::Array(events.split_off(skip)));
            }
        }
        true
    }

    /// Developer capture of local-sync frames (never sign-in), bounded under the app's 256 KB line limit.
    fn record(&mut self, direction: &str, channel: &str, data: &[u8]) {
        let Some(capture) = self.capture.as_mut() else { return };
        if self.capture_chars >= 120_000 {
            return;
        }
        let hex: String = data.iter().map(|b| format!("{b:02x}")).collect();
        self.capture_chars += hex.len();
        capture.push(json!({ "d": direction, "c": channel, "t": self.started.elapsed().as_millis() as u64, "x": hex }));
    }

    // ── Characteristics and writes ──────────────────────────────────────────────────────────────────────────────

    fn characteristic(&self, uuid: &str) -> Option<Characteristic> {
        self.characteristics.get(uuid).cloned()
    }
    fn control_write(&self) -> Option<Characteristic> {
        self.characteristic(&write_uuid(CHANNELS[0].1))
    }
    fn bulk_write(&self) -> Option<Characteristic> {
        self.characteristic(&write_uuid(CHANNELS[1].1))
    }
    /// The largest write without response the link takes now.
    fn max_write(&self) -> usize {
        self.peripheral.as_ref().map(|p| p.mtu() as usize).unwrap_or(23).saturating_sub(3)
    }
    async fn connected(&self) -> bool {
        match &self.peripheral {
            Some(p) => p.is_connected().await.unwrap_or(false),
            None => false,
        }
    }

    /// Writes frames without response, giving up at `deadline` with `late` (a write can wait on the link being
    /// ready to send again; that has stuck on a PACE 4).
    async fn write(&mut self, target: &Characteristic, frames: Vec<Vec<u8>>, deadline: Instant, late: &'static str) -> Result<(), End> {
        let control = Some(target.uuid) == self.control_write().map(|c| c.uuid);
        let Some(p) = self.peripheral.clone() else { return Err(failed(DISCONNECTED, site!())) };
        for frame in frames {
            self.record("tx", if control { "control" } else { "bulk" }, &frame);
            match tokio::time::timeout_at(deadline, p.write(target, &frame, WriteType::WithoutResponse)).await {
                Err(_) => return Err(timed_out(late, site!())),
                Ok(Err(e)) => return Err(failed_error(DISCONNECTED, site!(), &e)),
                Ok(Ok(())) => {}
            }
            if control {
                let n = self.state.get("controlWrites").and_then(Value::as_u64).unwrap_or(0) + 1;
                self.state.insert("controlWrites".into(), json!(n));
            }
        }
        Ok(())
    }

    // ── Connection ──────────────────────────────────────────────────────────────────────────────────────────────

    fn clear_connection(&mut self) {
        for (key, value) in [("phase", json!("disconnected")), ("connected", json!(false)), ("encrypted", json!(false)), ("systemBind", json!("not_authenticated"))] {
            self.state.insert(key.into(), value);
        }
        for key in ["rssiDbm", "authenticatedAt", "watchEvents"] {
            self.state.remove(key);
        }
        if let Some(Value::Array(channels)) = self.state.get_mut("channels") {
            for channel in channels.iter_mut() {
                channel["subscribed"] = json!(false);
            }
        }
        self.peripheral = None;
        self.notes = None;
        self.characteristics.clear();
    }

    async fn drop_link(&mut self) {
        if let Some(adapter) = &self.adapter {
            let _ = adapter.stop_scan().await;
        }
        if let Some(p) = self.peripheral.clone() {
            let _ = tokio::time::timeout(Duration::from_secs(4), p.disconnect()).await;
        }
        self.clear_connection();
    }

    async fn scan(&mut self) -> End {
        let adapter = match self.adapter(Instant::now() + Duration::from_secs(60)).await {
            Ok(a) => a,
            Err(end) => bail!(end),
        };
        self.state.insert("phase".into(), json!("scanning"));
        self.discovered.clear();
        if let Err(e) = adapter.start_scan(ScanFilter::default()).await {
            bail!(failed_error(text::UNAVAILABLE, site!(), &e));
        }
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let event = {
                let events = &mut self.events;
                tokio::select! {
                    event = next(events) => event,
                    _ = sleep_until(deadline) => break,
                }
            };
            match event {
                Some(event) => {
                    if let Some(id) = advertiser(&event) {
                        self.note_device(&adapter, id).await;
                    }
                }
                None => {
                    self.events = None;
                    tokio::time::sleep_until(deadline).await;
                    break;
                }
            }
        }
        let _ = adapter.stop_scan().await;
        if std::env::var_os("CLINK_BLE_DEBUG").is_some() {
            // Development only: how many advertisers of any kind the scan saw, to tell "no watch" from "no scan".
            eprintln!("clink-ble: scan saw {} devices", adapter.peripherals().await.map(|p| p.len()).unwrap_or(0));
        }
        let mut devices: Vec<Value> = self.discovered.values().cloned().collect();
        devices.sort_by(|a, b| a["deviceName"].as_str().unwrap_or("").cmp(b["deviceName"].as_str().unwrap_or("")));
        self.state.insert("discoveredDevices".into(), Value::Array(devices));
        self.state.insert("phase".into(), json!("idle"));
        done()
    }

    /// Records an advertising COROS watch; returns it with its name.
    async fn note_device(&mut self, adapter: &Adapter, id: &PeripheralId) -> Option<(Peripheral, String)> {
        let p = adapter.peripheral(id).await.ok()?;
        let props = p.properties().await.ok()??;
        let name = props.local_name.or(props.advertisement_name)?;
        if !name.starts_with("COROS") {
            return None;
        }
        let mut choice = json!({ "deviceId": device_id(&p), "deviceName": name });
        if let Some(rssi) = props.rssi {
            choice["rssiDbm"] = json!(rssi);
        }
        self.discovered.insert(device_id(&p), choice);
        Some((p, name))
    }

    async fn connect(&mut self, request: &Value) -> End {
        if self.connected().await {
            bail!(done());
        }
        let deadline = Instant::now() + Duration::from_secs(60);
        let adapter = match self.adapter(deadline).await {
            Ok(a) => a,
            Err(end) => bail!(end),
        };
        self.state.insert("phase".into(), json!("connecting"));
        self.discovered.clear();
        self.step = "";
        self.stale_pairing_cleared = false;
        let name = request.get("deviceName").and_then(Value::as_str).unwrap_or("").to_string();
        if !name.starts_with("COROS") {
            bail!(failed("Find and select your COROS watch before connecting.", site!()));
        }
        // A pinnedId that is there but isn't a usable identity (null included) is refused, as the Swift helper does.
        let pinned = match request.get("pinnedId") {
            None => None,
            Some(value) => match value.as_str().and_then(identity) {
                Some(id) => Some(id),
                None => bail!(failed("The remembered watch identity is invalid.", site!())),
            },
        };
        self.step = "scan";
        let pinned_serial = request.get("pinnedSerial").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_uppercase);
        let chosen = request.get("deviceId").and_then(Value::as_str).and_then(identity);
        let matches = |p: &Peripheral, advertised: Option<&str>| match &pinned {
            Some(pinned) => &device_id(p) == pinned,
            None => advertised == Some(name.as_str()),
        };

        // A watch already connected to this computer may no longer advertise: use it.
        let mut candidate: Option<Peripheral> = None;
        // Extended on macOS only.
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut known = adapter.peripherals().await.unwrap_or_default();
        #[cfg(target_os = "macos")]
        {
            let services = CHANNELS.iter().filter_map(|(_, u)| Uuid::parse_str(u).ok()).collect();
            let options = btleplug::api::RetrievePeripheralsOptions { identifiers: None, services: Some(services) };
            known.extend(adapter.retrieve_peripherals(options).await.unwrap_or_default());
        }
        for p in known {
            if p.is_connected().await.unwrap_or(false) {
                let advertised = p.properties().await.ok().flatten().and_then(|props| props.local_name);
                if matches(&p, advertised.as_deref()) {
                    candidate = Some(p);
                    break;
                }
            }
        }
        // The identity the app remembers (or just picked) can be retrieved without a scan on macOS. It can also be
        // stale: the watch isn't bonded and rotates its address. So, like the Swift helper, connect to it in the
        // background and scan at the same time; whichever finds the watch first wins. Never cancel and reuse the
        // same peripheral: btleplug forgets a peripheral when its connect is cancelled.
        let mut pending: Option<(Peripheral, tokio::task::JoinHandle<btleplug::Result<()>>)> = None;
        #[cfg(target_os = "macos")]
        if candidate.is_none() {
            if let Some(id) = pinned.as_deref().or(chosen.as_deref()).and_then(|t| Uuid::parse_str(t).ok()) {
                let options = btleplug::api::RetrievePeripheralsOptions { identifiers: Some(vec![PeripheralId::from(id)]), services: None };
                if let Some(known) = adapter.retrieve_peripherals(options).await.ok().and_then(|v| v.into_iter().next()) {
                    let advertised = known.properties().await.ok().flatten().and_then(|props| props.local_name);
                    let same = pinned.is_some() || advertised.is_none() || advertised.as_deref() == Some(name.as_str());
                    if same {
                        debug("connecting to the remembered watch while scanning");
                        let connecting = known.clone();
                        pending = Some((known, tokio::spawn(async move { connecting.connect().await })));
                    }
                }
            }
        }
        let _ = &chosen;

        if candidate.is_none() {
            if let Err(e) = adapter.start_scan(ScanFilter::default()).await {
                bail!(failed_error(text::UNAVAILABLE, site!(), &e));
            }
            // With a remembered identity, only that watch; a same-named one with another identity is tried (when its
            // serial number can be checked) or reported, after giving the remembered one 10 s to show up.
            let mut other: Option<(Peripheral, Instant)> = None;
            loop {
                let wake_at = match &other {
                    Some((_, at)) => (*at).min(deadline),
                    None => deadline,
                };
                let event = {
                    let events = &mut self.events;
                    tokio::select! {
                        event = next(events) => Some(event),
                        joined = joined(&mut pending) => {
                            match joined {
                                Some(Ok(())) => {
                                    debug("the remembered watch connected");
                                    candidate = pending.take().map(|(p, _)| p);
                                    break;
                                }
                                Some(Err(e)) => {
                                    debug(format_args!("the remembered watch didn't connect: {e}"));
                                    pending = None;
                                }
                                None => pending = None,
                            }
                            continue;
                        }
                        _ = sleep_until(wake_at) => None,
                    }
                };
                match event {
                    Some(Some(event)) => {
                        let Some(id) = advertiser(&event) else { continue };
                        let Some((p, advertised)) = self.note_device(&adapter, id).await else { continue };
                        if advertised != name {
                            continue;
                        }
                        // The watch advertising is the one already being connected to: let that connect finish.
                        if pending.as_ref().is_some_and(|(k, _)| k.id() == p.id()) {
                            continue;
                        }
                        if let Some(pinned) = &pinned {
                            if &device_id(&p) != pinned {
                                if other.is_none() {
                                    other = Some((p, Instant::now() + Duration::from_secs(10)));
                                }
                                continue;
                            }
                        }
                        if let Some(rssi) = p.properties().await.ok().flatten().and_then(|props| props.rssi) {
                            self.state.insert("rssiDbm".into(), json!(rssi));
                        }
                        debug("found the watch advertising");
                        cancel(&mut pending).await;
                        candidate = Some(p);
                        break;
                    }
                    Some(None) => {
                        self.events = None;
                        sleep_until(wake_at).await;
                    }
                    None => {
                        if Instant::now() >= deadline {
                            let _ = adapter.stop_scan().await;
                            cancel(&mut pending).await;
                            bail!(timed_out(text::NO_CONNECT, site!()));
                        }
                        // The remembered watch didn't show up: try the other one if its serial number can be checked.
                        let (p, _) = other.take().unwrap();
                        cancel(&mut pending).await;
                        if pinned_serial.is_none() {
                            let _ = adapter.stop_scan().await;
                            bail!(mismatch(device_id(&p), site!()));
                        }
                        candidate = Some(p);
                        break;
                    }
                }
            }
            let _ = adapter.stop_scan().await;
        }
        let p = candidate.unwrap();
        self.state.insert("deviceName".into(), json!(name));
        self.state.insert("deviceId".into(), json!(device_id(&p)));
        self.peripheral = Some(p.clone());
        let identity = Identity { pinned, serial: pinned_serial };
        let opened = self.open(&p, deadline, &identity).await;
        #[cfg(target_os = "windows")]
        let opened = match opened {
            Err(end) if self.stale_pairing(&end, &p).await => {
                // CorosLink 0.1.57 and 0.1.58 paired on every connect. A watch that later dropped that pairing (paired
                // with the phone again) refuses the old key, and Windows, still listing it as paired, never pairs
                // again. The pairing was CorosLink's own and the watch doesn't need one: remove it and try once more.
                let _ = tokio::time::timeout(Duration::from_secs(4), p.disconnect()).await;
                self.step = "unpair";
                let address = u64::from(p.address());
                match tokio::time::timeout(Duration::from_secs(30), tokio::task::spawn_blocking(move || pairing::unpair(address))).await {
                    Ok(Ok(Ok(()))) => {}
                    Ok(Ok(Err(reason))) => {
                        debug(format_args!("unpairing failed: {reason}"));
                        bail!(failed(text::UNPAIR_FAILED, site!()));
                    }
                    _ => bail!(timed_out(text::UNPAIR_FAILED, site!())),
                }
                self.stale_pairing_cleared = true;
                self.state.insert("phase".into(), json!("connecting"));
                self.open(&p, Instant::now() + Duration::from_secs(60), &identity).await
            }
            other => other,
        };
        if let Err(end) = opened {
            bail!(end);
        }
        if self.stale_pairing_cleared {
            // As the Python helper: the app adds helper events to the Bluetooth trail of later error reports.
            emit(&json!({ "event": "stale bond cleared" }));
        }
        self.step = "";
        self.state.insert("connected".into(), json!(true));
        self.state.insert("phase".into(), json!("connected"));
        self.state.insert("maximumWriteBytes".into(), json!(self.max_write()));
        done()
    }

    /// One connection attempt: the link, its services, then `prepare`. BlueZ pairs first (as the Python helper's
    /// bleak does with pair=True); Windows connects unpaired, like macOS, and pairs only when the watch refuses an
    /// unpaired request.
    async fn open(&mut self, p: &Peripheral, deadline: Instant, identity: &Identity) -> Result<(), End> {
        self.step = "connect";
        self.notes = None;
        #[cfg(target_os = "linux")]
        {
            self.step = "pair";
            let path = format!("/org/bluez/{}", p.id());
            let left = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(left, tokio::task::spawn_blocking(move || pairing::pair(&path, left))).await {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(reason))) => {
                    debug(format_args!("pairing failed: {reason}"));
                    return Err(failed(text::PAIR_FAILED, site!()));
                }
                _ => return Err(timed_out(text::PAIR_FAILED, site!())),
            }
            self.step = "connect";
        }
        // On Linux always: btleplug's connect is what waits for BlueZ to resolve the services (Pair connects too,
        // and BlueZ answers Connect on a connected, resolved device at once).
        if cfg!(target_os = "linux") || !p.is_connected().await.unwrap_or(false) {
            let left = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(left, p.connect()).await {
                Err(_) => return Err(timed_out(text::NO_CONNECT, site!())),
                Ok(Err(e)) => return Err(failed_error(text::CONNECT_FAILED, site!(), &e)),
                Ok(Ok(())) => {}
            }
        }
        let left = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, p.discover_services()).await {
            Err(_) => return Err(timed_out(text::NO_CONNECT, site!())),
            Ok(Err(e)) => return Err(failed_error("The watch's Bluetooth services could not be discovered.", site!(), &e)),
            Ok(Ok(())) => {}
        }
        self.characteristics = p.characteristics().into_iter().map(|c| (c.uuid.to_string(), c)).collect();
        if self.characteristics.is_empty() {
            return Err(failed("The watch's Bluetooth services could not be discovered.", site!()));
        }
        if self.control_write().is_none() {
            return Err(failed("This watch does not expose the supported COROS control channel.", site!()));
        }
        let first = self.prepare(p, deadline, identity, true).await;
        #[cfg(target_os = "windows")]
        if first.is_err() && self.pairing_required {
            self.step = "pair";
            let address = u64::from(p.address());
            match tokio::time::timeout(Duration::from_secs(60), tokio::task::spawn_blocking(move || pairing::pair(address))).await {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(reason))) => {
                    debug(format_args!("pairing failed: {reason}"));
                    return Err(failed(text::PAIR_FAILED, site!()));
                }
                _ => return Err(timed_out(text::PAIR_FAILED, site!())),
            }
            return self.prepare(p, Instant::now() + Duration::from_secs(60), identity, false).await;
        }
        first
    }

    /// Device Information, the identity check, and notifications on every channel. Repeated after pairing on
    /// Windows, so channels already subscribed are left as they are.
    async fn prepare(&mut self, p: &Peripheral, deadline: Instant, identity: &Identity, fresh: bool) -> Result<(), End> {
        self.step = "subscribe";
        #[cfg(target_os = "windows")]
        {
            self.pairing_required = false;
        }
        for (label, _) in STANDARD_READS {
            self.state.remove(label);
        }
        for (label, short) in STANDARD_READS {
            let Some(c) = self.characteristic(&standard_uuid(short)).filter(|c| c.properties.contains(CharPropFlags::READ)) else { continue };
            let left = deadline.saturating_duration_since(Instant::now());
            let Ok(Ok(data)) = tokio::time::timeout(left, p.read(&c)).await else { continue };
            if label == "batteryPercent" {
                if data.len() == 1 && data[0] <= 100 {
                    self.state.insert(label.into(), json!(data[0]));
                }
            } else {
                let text = String::from_utf8_lossy(&data).trim_matches(|c: char| c.is_control()).to_string();
                self.state.insert(label.into(), json!(text));
            }
        }
        // Another identity stands in for the remembered one only with its serial number, before notifications are
        // on and long before the sign-in challenge is answered.
        if let Some(pinned) = &identity.pinned {
            if &device_id(p) != pinned {
                let serial = self.state.get("serialNumber").and_then(Value::as_str).map(|s| s.trim().to_uppercase());
                if identity.serial.is_none() || serial != identity.serial {
                    return Err(mismatch(device_id(p), site!()));
                }
            }
        }
        if fresh {
            let channels: Vec<Value> = CHANNELS
                .iter()
                .filter(|(_, uuid)| self.characteristics.contains_key(&notify_uuid(uuid)) && self.characteristics.contains_key(&write_uuid(uuid)))
                .map(|(name, uuid)| json!({ "name": name, "serviceUuid": uuid, "notifications": 0, "receivedBytes": 0, "subscribed": false }))
                .collect();
            self.state.insert("channels".into(), Value::Array(channels));
        }
        if self.notes.is_none() {
            self.notes = match p.notifications().await {
                Ok(mut stream) => {
                    let (sender, receiver) = mpsc::unbounded_channel();
                    tokio::spawn(async move {
                        while let Some(note) = stream.next().await {
                            if sender.send(note).is_err() {
                                break;
                            }
                        }
                    });
                    Some(receiver)
                }
                Err(e) => return Err(failed_error(text::NOTIFY_FAILED, site!(), &e)),
            };
        }
        for (_, uuid) in CHANNELS {
            let Some(c) = self.characteristic(&notify_uuid(uuid)) else { continue };
            let subscribed = self.state.get("channels").and_then(Value::as_array).is_some_and(|channels| {
                channels.iter().any(|ch| ch["serviceUuid"] == json!(uuid) && ch["subscribed"] == json!(true))
            });
            if subscribed {
                continue;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(left, p.subscribe(&c)).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    #[cfg(target_os = "windows")]
                    {
                        self.pairing_required = pairing_required(&e);
                    }
                    return Err(failed_error(text::NOTIFY_FAILED, site!(), &e));
                }
                Err(_) => return Err(timed_out(text::NOTIFY_FAILED, site!())),
            }
            if let Some(Value::Array(channels)) = self.state.get_mut("channels") {
                for channel in channels.iter_mut().filter(|ch| ch["serviceUuid"] == json!(uuid)) {
                    channel["subscribed"] = json!(true);
                }
            }
        }
        Ok(())
    }

    /// Whether a Windows pairing may be what failed this attempt, so removing it and retrying unpaired can help, as
    /// the Python helper decides: only Bluetooth failures (or timeouts) while connecting or subscribing, and only
    /// when Windows lists the watch as paired. A failed pairing means the watch asked for one: removing can't help.
    #[cfg(target_os = "windows")]
    async fn stale_pairing(&mut self, end: &End, p: &Peripheral) -> bool {
        let End::Failed { error, timed_out, .. } = end else { return false };
        if !(error.is_some() || *timed_out) || !["connect", "subscribe"].contains(&self.step) {
            return false;
        }
        let address = u64::from(p.address());
        matches!(
            tokio::time::timeout(Duration::from_secs(15), tokio::task::spawn_blocking(move || pairing::is_paired(address))).await,
            Ok(Ok(true))
        )
    }

    async fn disconnect(&mut self) -> End {
        self.drop_link().await;
        done()
    }

    async fn status(&mut self) -> End {
        if let Some(p) = self.peripheral.clone() {
            if !p.is_connected().await.unwrap_or(false) {
                self.clear_connection();
            } else if cfg!(target_os = "macos") {
                if let Ok(Ok(rssi)) = tokio::time::timeout(Duration::from_secs(2), p.read_rssi()).await {
                    if rssi != 127 {
                        self.state.insert("rssiDbm".into(), json!(rssi));
                    }
                }
            } else {
                self.state.remove("rssiDbm");
            }
        }
        done()
    }

    async fn refresh(&mut self) -> End {
        let battery = self.characteristic(&standard_uuid("2a19"));
        let (Some(p), Some(battery)) = (self.peripheral.clone(), battery) else { return done() };
        if !p.is_connected().await.unwrap_or(false) {
            return done();
        }
        match tokio::time::timeout(Duration::from_secs(45), p.read(&battery)).await {
            Err(_) => timed_out(text::BATTERY, site!()),
            Ok(Ok(data)) => {
                if data.len() == 1 && data[0] <= 100 {
                    self.state.insert("batteryPercent".into(), json!(data[0]));
                }
                done()
            }
            Ok(Err(_)) => done(),
        }
    }

    // ── Control requests ────────────────────────────────────────────────────────────────────────────────────────

    async fn exchange(&mut self, request: &Value) -> End {
        let payload = request.get("payload").and_then(Value::as_str).and_then(|t| B64.decode(t).ok());
        let requested = request.get("maximumWriteBytes").and_then(Value::as_u64);
        let (true, Some(data), Some(requested)) = (self.connected().await, payload, requested) else {
            return failed("The COROS control request is invalid or the watch is disconnected.", site!());
        };
        if data.len() > 4096 {
            return failed("The COROS control request is invalid or the watch is disconnected.", site!());
        }
        let maximum = (requested as usize).min(self.max_write()).min(255);
        let write = self.control_write().filter(|c| c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE));
        let (true, Some(write)) = (maximum >= 3, write) else {
            return failed("The COROS control write channel is unavailable.", site!());
        };
        let opcode = request.get("opcode").and_then(Value::as_u64).unwrap_or(0xA5) as u8;
        let frames = chunked(opcode, &data, maximum - 2);
        if frames.len() > 256 {
            return failed("COROS control request is too large.", site!());
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        self.control_exchange(&write, frames, opcode, deadline).await
    }

    /// Control frames written exactly as given (a command framed its own way, such as CorosKit's WatchFinding: the
    /// opcode and a 0 frames-left byte, no SUM), and the reply for `opcode`. The reply can wait on the wearer
    /// (the ring lasts until a button is pressed), so the deadline is the app's `timeoutMs`, 60 s by default.
    async fn exchange_frames(&mut self, request: &Value) -> End {
        let invalid = || failed("The COROS control request is invalid or the watch is disconnected.", site!());
        let Some(encoded) = request.get("frames").and_then(Value::as_array) else { return invalid() };
        let opcode = request.get("opcode").and_then(Value::as_u64).and_then(|v| u8::try_from(v).ok());
        let timeout = request.get("timeoutMs").map_or(Some(60_000), Value::as_u64).filter(|ms| *ms > 0).map(|ms| ms.min(120_000));
        let (true, Some(opcode), Some(timeout)) = (self.connected().await, opcode, timeout) else { return invalid() };
        let maximum = self.max_write().min(255);
        let mut frames = Vec::new();
        for value in encoded {
            match value.as_str().and_then(|t| B64.decode(t).ok()) {
                Some(frame) if !frame.is_empty() && frame.len() <= maximum => frames.push(frame),
                _ => return invalid(),
            }
        }
        if frames.is_empty() || frames.len() > 32 {
            return invalid();
        }
        let write = self.control_write().filter(|c| c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE));
        let Some(write) = write else { return failed("The COROS control write channel is unavailable.", site!()) };
        let deadline = Instant::now() + Duration::from_millis(timeout);
        self.control_exchange(&write, frames, opcode, deadline).await
    }

    /// Writes control frames and returns the SUM-checked reply for `opcode` (≤ 4 KB).
    async fn control_exchange(&mut self, write: &Characteristic, frames: Vec<Vec<u8>>, opcode: u8, deadline: Instant) -> End {
        if let Err(end) = self.write(write, frames, deadline, "The watch did not answer the COROS control request.").await {
            return end;
        }
        let control = notify_uuid(CHANNELS[0].1);
        let mut bytes: Vec<u8> = Vec::new();
        let mut remaining: Option<u8> = None;
        loop {
            match self.wait(deadline).await {
                Wake::Deadline => return timed_out("The watch did not answer the COROS control request.", site!()),
                Wake::Disconnected => {
                    self.clear_connection();
                    return failed(DISCONNECTED, site!());
                }
                Wake::Note(uuid, data) => {
                    if !self.observe(uuid, &data) || uuid.to_string() != control || data.first() != Some(&opcode) {
                        continue;
                    }
                    if data.len() < 3 {
                        return failed("Invalid COROS response frame.", site!());
                    }
                    if let Some(previous) = remaining {
                        if previous == 0 || data[1] != previous - 1 {
                            return failed("Invalid COROS response frame sequence.", site!());
                        }
                    }
                    remaining = Some(data[1]);
                    bytes.extend_from_slice(&data[2..]);
                    if bytes.len() > 4096 {
                        return failed("COROS response is too large.", site!());
                    }
                    if data[1] == 0 {
                        let (body, checksum) = bytes.split_at(bytes.len() - 1);
                        if sum(body) != checksum[0] {
                            return failed("COROS response checksum failed.", site!());
                        }
                        return done_with(body);
                    }
                }
            }
        }
    }

    async fn music_page(&mut self, request: &Value) -> End {
        // Storage category 0 is local music (pages 0–255); 3 is NetEase, read whole (page -1).
        let category = request.get("category").and_then(Value::as_i64).unwrap_or(0);
        let page = request.get("page").and_then(Value::as_i64);
        let valid = matches!((category, page), (0, Some(0..=255)) | (3, Some(-1)));
        let (true, true, Some(control), Some(bulk)) = (self.connected().await, valid, self.control_write(), self.bulk_write()) else {
            return failed("The music inventory request is invalid or the watch is disconnected.", site!());
        };
        let mut receiver = MusicPageReceiver::new(page.unwrap(), category);
        let deadline = Instant::now() + Duration::from_secs(30);
        if let Err(end) = self.write(&control, receiver.request_frames(), deadline, "The watch did not return its music inventory.").await {
            return end;
        }
        let (control_note, bulk_note) = (notify_uuid(CHANNELS[0].1), notify_uuid(CHANNELS[1].1));
        loop {
            match self.wait(deadline).await {
                Wake::Deadline => return timed_out("The watch did not return its music inventory.", site!()),
                Wake::Disconnected => {
                    self.clear_connection();
                    return failed(DISCONNECTED, site!());
                }
                Wake::Note(uuid, data) => {
                    let text = uuid.to_string();
                    if !self.observe(uuid, &data) || (text != control_note && text != bulk_note) {
                        continue;
                    }
                    match receiver.accept(&data, text == control_note) {
                        Err(_) => return failed("The watch returned an invalid or incomplete music inventory.", site!()),
                        Ok(result) => {
                            if let Some(payload) = result.payload {
                                return done_with(&payload);
                            }
                            if !result.frames.is_empty() {
                                let target = if result.bulk { bulk.clone() } else { control.clone() };
                                if let Err(end) = self.write(&target, result.frames, deadline, "The watch did not return its music inventory.").await {
                                    return end;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// Read-only local sync (daily history, workouts, watch settings): one CRC-checked block, returned
    /// unacknowledged. A refusal names its code in `detail.refusedCode`.
    async fn sync_block(&mut self, request: &Value) -> End {
        let receiver = match (request.get("fileIndex").and_then(Value::as_i64), request.get("offset").and_then(Value::as_i64)) {
            (Some(file), Some(offset)) => SyncBlockReceiver::new(file, offset, request.get("selector").and_then(Value::as_i64).unwrap_or(0), None, None),
            _ => None,
        };
        let (true, Some(mut receiver), Some(control), Some(bulk)) = (self.connected().await, receiver, self.control_write(), self.bulk_write()) else {
            return failed("The watch sync request is invalid or the watch is disconnected.", site!());
        };
        let deadline = Instant::now() + Duration::from_secs(30);
        if let Err(end) = self.write(&control, receiver.request_frames(), deadline, "The watch did not send the requested records.").await {
            return end;
        }
        let (control_note, bulk_note) = (notify_uuid(CHANNELS[0].1), notify_uuid(CHANNELS[1].1));
        loop {
            match self.wait(deadline).await {
                // The watch was serving someone else's sync (the COROS app on the same link): busy, read again later.
                Wake::Deadline if receiver.saw_other_sync() => return refused(protocol::ANOTHER_SYNC, site!(), true),
                Wake::Deadline => return timed_out("The watch did not send the requested records.", site!()),
                Wake::Disconnected => {
                    self.clear_connection();
                    return failed(DISCONNECTED, site!());
                }
                Wake::Note(uuid, data) => {
                    let text = uuid.to_string();
                    if !self.observe(uuid, &data) || (text != control_note && text != bulk_note) {
                        continue;
                    }
                    match receiver.accept(&data, text == control_note) {
                        Err(SyncError::Refused(code)) => return refused(code, site!(), false),
                        Err(SyncError::Invalid) => return failed("The watch returned invalid or incomplete records.", site!()),
                        Ok(result) => {
                            if let Some(payload) = result.payload {
                                return done_with(&payload);
                            }
                            if !result.frames.is_empty() {
                                let target = if result.bulk { bulk.clone() } else { control.clone() };
                                if let Err(end) = self.write(&target, result.frames, deadline, "The watch did not send the requested records.").await {
                                    return end;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    async fn send_notification(&mut self, request: &Value) -> End {
        let invalid = || failed("The notification request is invalid or the watch is disconnected.", site!());
        let encoded: Vec<String> = request
            .get("frames")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let write = self.control_write().filter(|c| c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE));
        let (true, Some(write)) = (self.connected().await, write) else { return invalid() };
        if encoded.is_empty() || encoded.len() > 256 {
            return invalid();
        }
        let maximum = self.max_write().min(255);
        let mut frames = Vec::new();
        let mut sequence: Option<u8> = None;
        for (index, text) in encoded.iter().enumerate() {
            let Ok(frame) = B64.decode(text) else { return failed("Invalid notification fragment sequence.", site!()) };
            let lead = if index == 0 { 0x80 } else { 0 };
            if frame.len() < 4 || frame.len() > maximum || frame[0] != 0x79 || frame[1] as usize != encoded.len() - index - 1 || frame[2] & 0x80 != lead {
                return failed("Invalid notification fragment sequence.", site!());
            }
            if index == 0 {
                sequence = Some(frame[2] & 0x7f);
            }
            if Some(frame[2] & 0x7f) != sequence {
                return failed("Invalid notification message sequence.", site!());
            }
            frames.push(frame);
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        match self.write(&write, frames, deadline, "Bluetooth did not finish sending the notification.").await {
            Err(end) => end,
            Ok(()) => done(),
        }
    }

    // ── File transfers (routes, faces, music deletes, pushed data files, development OTA) ──────────────────────

    async fn file_block(&mut self, request: &Value) -> End {
        let op = self.operation.clone();
        let ota = op == "officialOtaBlock" || op == "lightMapOtaBlock";
        let file_id = request.get("fileId").and_then(Value::as_u64).and_then(|v| u8::try_from(v).ok()).unwrap_or(255);
        // Files pushed like the phone app does: workout, weather, training calendar, GPS assistance; nothing else.
        let file_index: u8 = if ota {
            file_id
        } else if op == "dataFileBlock" {
            // And the engine's watch settings (54) and gear list (84).
            if protocol::PUSHED_DATA_FILES.contains(&file_id) || protocol::ENGINE_DATA_FILES.contains(&file_id) {
                file_id
            } else {
                255
            }
        } else if op == "musicDelete" {
            protocol::MUSIC_DELETE_FILE
        } else if op == "watchfaceBlock" {
            protocol::WATCHFACE_FILE
        } else {
            protocol::ROUTE_FILE
        };
        let header = request.get("header").and_then(Value::as_str).and_then(|t| B64.decode(t).ok());
        let block = request.get("block").and_then(Value::as_str).and_then(|t| B64.decode(t).ok());
        let invalid = || failed("The COROS file request is invalid or its transfer channel is unavailable.", site!());
        let (Some(header), Some(block)) = (header, block) else { return invalid() };
        let valid = protocol::valid_file_block(&header, &block, file_index)
            && (op != "officialOtaBlock" || protocol::valid_official_ota_block(&header, &block, file_index))
            && (op != "lightMapOtaBlock" || protocol::valid_light_map_ota_block(&header, &block, file_index));
        let wwr = |c: Option<Characteristic>| c.filter(|c| c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE));
        let (true, true, Some(control), Some(bulk)) = (self.connected().await, valid, wwr(self.control_write()), wwr(self.bulk_write())) else {
            return invalid();
        };
        if self.max_write() < header.len() {
            return failed("Bluetooth packet size is too small for file sync. Reconnect the watch.", site!());
        }
        let mut music = (op == "musicDelete").then(MusicDeleteReceiver::default);
        let mut response: Vec<u8> = Vec::new();
        self.route_stage = "ready".into();
        let mut deadline = Instant::now() + Duration::from_secs(15);
        if let Err(end) = self.write(&control, vec![header], deadline, "The watch did not accept the file transfer header.").await {
            return end;
        }
        let control_note = notify_uuid(CHANNELS[0].1);
        loop {
            let data = match self.wait(deadline).await {
                Wake::Deadline => {
                    return timed_out(
                        match self.route_stage.as_str() {
                            "ready" => "The watch did not accept the file transfer header.",
                            "complete" => "The watch did not acknowledge the file data block.",
                            _ => "The watch did not confirm music deletion.",
                        },
                        site!(),
                    )
                }
                Wake::Disconnected => {
                    self.clear_connection();
                    return failed(DISCONNECTED, site!());
                }
                Wake::Note(uuid, data) => {
                    if !self.observe(uuid, &data) || uuid.to_string() != control_note {
                        continue;
                    }
                    data
                }
            };
            if let (Some(receiver), Some(0xc1)) = (music.as_mut(), data.first()) {
                if receiver.accept_storage(&data).is_err() {
                    return failed("The watch returned an invalid music delete response.", site!());
                }
                if let Some(payload) = receiver.result() {
                    return done_with(&payload);
                }
                continue;
            }
            if data.first() != Some(&0x78) {
                continue;
            }
            // A refusal is a single status byte (firmware: 2 busy, 3 bad header, 0x14/0x2b/0xfd not accepted now).
            if data.len() == 4 && data[1] == 0 && data[2] == data[3] {
                return failed(format!("The watch refused the file transfer (code {}).", data[2]), site!());
            }
            if !(data.len() == 6 || data.len() == 9) || data[1] != 0 || sum(&data[2..data.len() - 1]) != *data.last().unwrap() {
                return failed("Invalid COROS file acknowledgement.", site!());
            }
            let accepted = data[2] == 1 && if data.len() == 9 { data[6] == 1 } else { data[4] == file_index };
            let finished = if self.route_stage == "ready" {
                if ota {
                    response = data.clone();
                }
                if accepted {
                    true
                } else {
                    if data.len() != 9 || data[2] > 1 || data[6] != 1 || data[4] < 20 || (ota && data[7] != 3) {
                        return failed("The watch rejected the file transfer header.", site!());
                    }
                    let size = (data[4] as usize).min(self.max_write()).min(240).saturating_sub(3);
                    let count = block.len().div_ceil(size.max(1));
                    let window = if ota { data[5] as usize } else { 256 };
                    if size < 17 || count > 256 || window == 0 {
                        return failed("The file block exceeds the negotiated packet limit.", site!());
                    }
                    let frames: Vec<Vec<u8>> = block
                        .chunks(size)
                        .enumerate()
                        .map(|(sequence, part)| [vec![0x78, (sequence % window) as u8, file_index], part.to_vec()].concat())
                        .collect();
                    self.route_stage = "complete".into();
                    deadline = Instant::now() + Duration::from_secs(20);
                    if let Err(end) = self.write(&bulk, frames, deadline, "The watch did not acknowledge the file data block.").await {
                        return end;
                    }
                    false
                }
            } else if self.route_stage == "complete" {
                if !accepted {
                    return failed("The watch rejected the file data block.", site!());
                }
                if ota {
                    response = data.clone();
                }
                true
            } else {
                false
            };
            if finished {
                if ota {
                    return done_with(&response);
                }
                let Some(receiver) = music.as_mut() else { return done() };
                receiver.file_acknowledged = true;
                if let Some(payload) = receiver.result() {
                    return done_with(&payload);
                }
                self.route_stage = "deletion".into();
                deadline = Instant::now() + Duration::from_secs(20);
            }
        }
    }

    pub async fn shutdown(&mut self) {
        self.drop_link().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

/// Windows pairing through WinRT (btleplug doesn't pair), as the Python helper does it through bleak. Blocking: run
/// on `spawn_blocking`. Failures carry a status or HRESULT only, never device details.
#[cfg(target_os = "windows")]
mod pairing {
    use windows::Devices::Bluetooth::BluetoothLEDevice;
    use windows::Devices::Enumeration::{
        DeviceInformation, DeviceInformationCustomPairing, DevicePairingKinds, DevicePairingRequestedEventArgs, DevicePairingResultStatus,
        DeviceUnpairingResultStatus,
    };
    use windows::Foundation::TypedEventHandler;

    /// The watch's DeviceInformation, read fresh (a device's own copy isn't updated), as bleak's pair() reads it.
    fn information(address: u64) -> windows::core::Result<DeviceInformation> {
        let device = BluetoothLEDevice::FromBluetoothAddressAsync(address)?.join()?;
        let id = device.DeviceInformation()?.Id()?;
        let information = DeviceInformation::CreateFromIdAsync(&id)?.join();
        let _ = device.Close();
        information
    }

    fn reason(error: windows::core::Error) -> String {
        format!("HRESULT {:#010x}", error.code().0)
    }

    /// Whether Windows lists the watch as paired; false when that can't be read.
    pub fn is_paired(address: u64) -> bool {
        information(address).and_then(|i| i.Pairing()?.IsPaired()).unwrap_or(false)
    }

    /// Just Works pairing, the request accepted here, as bleak's WinRT pair() does. Already paired is fine.
    pub fn pair(address: u64) -> Result<(), String> {
        let run = || -> windows::core::Result<Result<(), String>> {
            let pairing = information(address)?.Pairing()?;
            if pairing.IsPaired()? {
                return Ok(Ok(()));
            }
            if !pairing.CanPair()? {
                return Ok(Err("pairing not supported".into()));
            }
            let custom = pairing.Custom()?;
            let accept = TypedEventHandler::<DeviceInformationCustomPairing, DevicePairingRequestedEventArgs>::new(|_, args| {
                if let Some(args) = args.as_ref() {
                    args.Accept()?;
                }
                Ok(())
            });
            let token = custom.PairingRequested(&accept)?;
            let result = custom.PairAsync(DevicePairingKinds::ConfirmOnly).and_then(|operation| operation.join());
            let _ = custom.RemovePairingRequested(token);
            let status = result?.Status()?;
            Ok(if status == DevicePairingResultStatus::Paired || status == DevicePairingResultStatus::AlreadyPaired {
                Ok(())
            } else {
                Err(format!("pairing status {}", status.0))
            })
        };
        run().unwrap_or_else(|e| Err(reason(e)))
    }

    /// Removes Windows' pairing with the watch, as bleak's WinRT unpair() does. Already unpaired is fine.
    pub fn unpair(address: u64) -> Result<(), String> {
        let run = || -> windows::core::Result<Result<(), String>> {
            let device = BluetoothLEDevice::FromBluetoothAddressAsync(address)?.join()?;
            let result = device.DeviceInformation()?.Pairing()?.UnpairAsync()?.join();
            let _ = device.Close();
            let status = result?.Status()?;
            Ok(if status == DeviceUnpairingResultStatus::Unpaired || status == DeviceUnpairingResultStatus::AlreadyUnpaired {
                Ok(())
            } else {
                Err(format!("unpairing status {}", status.0))
            })
        };
        run().unwrap_or_else(|e| Err(reason(e)))
    }
}

/// BlueZ pairing over D-Bus (org.bluez.Device1.Pair), as the Python helper's bleak does on connect with pair=True.
/// Like it, C-LINK registers no agent: BlueZ uses the desktop's (Just Works needs no input). Blocking: run on
/// `spawn_blocking`. Failures carry the D-Bus error name only.
#[cfg(target_os = "linux")]
mod pairing {
    use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
    use std::time::Duration;

    pub fn pair(path: &str, timeout: Duration) -> Result<(), String> {
        let name = |e: dbus::Error| e.name().unwrap_or("org.freedesktop.DBus.Error.Failed").to_string();
        let connection = dbus::blocking::Connection::new_system().map_err(name)?;
        let device = connection.with_proxy("org.bluez", path, timeout);
        if device.get::<bool>("org.bluez.Device1", "Paired").unwrap_or(false) {
            return Ok(());
        }
        match device.method_call::<(), _, _, _>("org.bluez.Device1", "Pair", ()) {
            Ok(()) => Ok(()),
            Err(e) if e.name() == Some("org.bluez.Error.AlreadyExists") => Ok(()),
            Err(e) => Err(name(e)),
        }
    }
}

/// The background connect to a remembered watch finishing; never resolves when there is none.
async fn joined(pending: &mut Option<(Peripheral, tokio::task::JoinHandle<btleplug::Result<()>>)>) -> Option<btleplug::Result<()>> {
    match pending {
        Some((_, handle)) => handle.await.ok(),
        None => futures::future::pending().await,
    }
}

/// Stops a background connect that lost to the scan, so CoreBluetooth doesn't connect a watch nobody tracks.
async fn cancel(pending: &mut Option<(Peripheral, tokio::task::JoinHandle<btleplug::Result<()>>)>) {
    if let Some((p, handle)) = pending.take() {
        handle.abort();
        let _ = tokio::time::timeout(Duration::from_secs(2), p.disconnect()).await;
    }
}

/// The next notification; never resolves when there is no link. A closed channel gives None.
async fn recv(notes: &mut Option<Notes>) -> Option<ValueNotification> {
    match notes {
        Some(n) => n.recv().await,
        None => futures::future::pending().await,
    }
}

/// The next item of an optional stream; never resolves when there is none. A finished stream gives None.
async fn next<S: Stream + Unpin>(stream: &mut Option<S>) -> Option<S::Item> {
    match stream {
        Some(s) => s.next().await,
        None => futures::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identities() {
        #[cfg(target_os = "macos")]
        {
            let id = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
            assert_eq!(identity(id).as_deref(), Some(id));
            assert_eq!(identity(&id.to_lowercase()).as_deref(), Some(id), "any case");
            assert_eq!(identity(&format!("{{{id}}}")).as_deref(), Some(id), "braced form normalised");
            assert_eq!(identity("AA:BB:CC:DD:EE:FF"), None);
        }
        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(identity("aa:bb:cc:dd:ee:ff").as_deref(), Some("AA:BB:CC:DD:EE:FF"));
            assert_eq!(identity(""), None);
        }
    }

    #[test]
    fn windows_pairing_refusals() {
        assert!(pairing_refusal("Windows UWP threw error on subscribe: GattCommunicationStatus(3)"), "access denied");
        assert!(pairing_refusal("Windows UWP threw error on subscribe: GattCommunicationStatus(2)"), "protocol error");
        assert!(!pairing_refusal("Windows UWP threw error on subscribe: GattCommunicationStatus(1)"), "unreachable");
    }

    #[test]
    fn uuids() {
        assert_eq!(write_uuid(CHANNELS[0].1), "6e400002-b5a3-f393-e0a9-77656c6f6f70");
        assert_eq!(notify_uuid(CHANNELS[1].1), "6e400003-b5a3-f393-e0a9-e50e24dcca9e");
        assert_eq!(standard_uuid("2a19"), Uuid::from_u128(0x00002a19_0000_1000_8000_00805f9b34fb).to_string());
    }
}
