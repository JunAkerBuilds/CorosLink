// The COROS framing the helper does itself: control frames and their SUM byte, the file-block (SFT) headers it
// checks before sending anything, and the receivers for music listings, activity sync blocks and music deletes.
// A line-by-line port of CorosLink's native/corebluetooth/main.swift (its free functions and receiver classes),
// which is itself the twin of scripts/coros_ble_*.py. No Bluetooth here, so all of it is unit-tested.

/// The wrapping byte sum COROS puts after a logical payload.
pub fn sum(bytes: &[u8]) -> u8 {
    bytes.iter().fold(0u8, |a, b| a.wrapping_add(*b))
}

/// CRC-16/CCITT-FALSE, as the SFT header carries it.
pub fn crc16(bytes: &[u8]) -> u16 {
    let mut crc: u16 = 0xffff;
    for &byte in bytes {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            crc = (crc << 1) ^ if crc & 0x8000 == 0 { 0 } else { 0x1021 };
        }
    }
    crc
}

/// Little-endian unsigned integer of `size` bytes at `offset`.
pub fn little(data: &[u8], offset: usize, size: usize) -> u64 {
    (0..size).fold(0u64, |v, i| v | (data[offset + i] as u64) << (i * 8))
}

/// `value` as `size` little-endian bytes (truncating, like Swift's UInt8(truncatingIfNeeded:)).
pub fn integer(value: i64, size: usize) -> Vec<u8> {
    (0..size).map(|i| (value >> (i * 8)) as u8).collect()
}

/// A logical payload + SUM split into frames of `chunk` bytes, each led by [opcode, frames left].
pub fn chunked(opcode: u8, payload: &[u8], chunk: usize) -> Vec<Vec<u8>> {
    let mut logical = payload.to_vec();
    logical.push(sum(payload));
    let count = logical.len().div_ceil(chunk);
    logical
        .chunks(chunk)
        .enumerate()
        .map(|(index, part)| {
            let mut frame = vec![opcode, (count - index - 1) as u8];
            frame.extend_from_slice(part);
            frame
        })
        .collect()
}

/// The 18-byte frames music and sync requests use.
pub fn frames18(opcode: u8, payload: &[u8]) -> Vec<Vec<u8>> {
    chunked(opcode, payload, 18)
}

/// Mobile's epoch (2014-01-01) and the local zone in fifteen-minute units, as requests carry them.
pub const MOBILE_EPOCH: i64 = 1_388_534_400;

pub fn now_seconds() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn utc_offset_seconds() -> i64 {
    chrono::Local::now().offset().local_minus_utc() as i64
}

/// Watch events the firmware sends unasked: media keys and a rejected call (W332). Nothing else is decoded.
pub fn decode_watch_interaction(data: &[u8]) -> Option<serde_json::Value> {
    if data.len() < 4 || data[1] != 0 || sum(&data[2..data.len() - 1]) != *data.last().unwrap() {
        return None;
    }
    if data[0] == 0xC5 && data.len() == 5 && (1..=7).contains(&data[2]) {
        return Some(serde_json::json!({ "kind": "media-control", "action": data[2], "value": data[3] }));
    }
    if data[0] == 2 && data.len() == 4 && data[2] == 2 {
        return Some(serde_json::json!({ "kind": "call-rejected" }));
    }
    None
}

/// The watch's USB-storage prompt (3.2008.0 firmware): `0D 00 11 01 xx sum`, xx 0 while it asks, 1 when it closes.
pub fn decode_usb_access(data: &[u8]) -> Option<&'static str> {
    if data.len() != 6 || data[0] != 0x0D || data[1] != 0 || data[2] != 0x11 || data[3] != 1 || data[4] > 1 {
        return None;
    }
    if data[2].wrapping_add(data[3]).wrapping_add(data[4]) != data[5] {
        return None;
    }
    Some(if data[4] == 0 { "usb-access-request" } else { "usb-access-closed" })
}

/// Files pushed like the phone app does: workout, weather, training calendar and GPS assistance.
pub const PUSHED_DATA_FILES: [u8; 6] = [41, 80, 42, 13, 68, 70];
/// GPS assistance: 13 (ELPO, LTO), 68 (second ELPO file), 70 (RTO ephemeris). Up to 256 KB each.
pub const SATELLITE_DATA_FILES: [u8; 3] = [13, 68, 70];
/// Files C-LINK's engine sends with `dataFileBlock` besides those: watch settings 54 and the gear list 84.
pub const ENGINE_DATA_FILES: [u8; 2] = [54, 84];
pub const ROUTE_FILE: u8 = 0x14;
pub const WATCHFACE_FILE: u8 = 8;
pub const MUSIC_DELETE_FILE: u8 = 93;

pub fn file_limit(file_index: u8) -> u64 {
    if file_index == 9 {
        7_025_507
    } else if file_index == 8 {
        0x320000
    } else if SATELLITE_DATA_FILES.contains(&file_index) {
        262_144
    } else if PUSHED_DATA_FILES.contains(&file_index) || ENGINE_DATA_FILES.contains(&file_index) {
        65_536
    } else {
        2_000_000
    }
}

/// Whether a 21-byte SFT header and its block are a well-formed transfer of `file_index`.
pub fn valid_file_block(header: &[u8], block: &[u8], file_index: u8) -> bool {
    // A NetEase delete has storage category 3 at +16 (local music 0), in the same 21-byte header.
    if file_index == 93 && header.len() == 21 && header[16] == 3 {
        return valid_netease_delete_block(header, block);
    }
    let known = [8, 0x14, 93, 9, 50].contains(&file_index) || PUSHED_DATA_FILES.contains(&file_index) || ENGINE_DATA_FILES.contains(&file_index);
    if header.len() != 21 || block.is_empty() || block.len() > 4096 || !known || header[..3] != [0x78, 0, file_index] {
        return false;
    }
    if file_index == 8 && header[16] >= 10 {
        return false;
    }
    // GPS assistance carries a 24-bit hour in bytes 16–18; other files a single byte.
    let tail_ok = if SATELLITE_DATA_FILES.contains(&file_index) { header[19] == 3 } else { header[17..20] == [0, 0, 3] };
    if !tail_ok {
        return false;
    }
    let l = |offset, count| little(header, offset, count);
    if file_index == 93 && (header[16] != 0 || l(3, 4) != 0 || l(9, 4) != block.len() as u64 || !valid_music_delete_file(block)) {
        return false;
    }
    l(7, 2) == block.len() as u64
        && l(9, 4) >= block.len() as u64
        && l(9, 4) <= file_limit(file_index)
        && l(3, 4) + l(9, 4) <= file_limit(file_index)
        && l(13, 2) == crc16(block) as u64
        && sum(block) == header[15]
        && sum(&header[2..20]) == header[20]
}

/// Development-only official W332 3.2008.0 rehearsal: each raw block bounded on its own.
pub fn valid_official_ota_block(header: &[u8], block: &[u8], file_index: u8) -> bool {
    if !valid_file_block(header, block, file_index) || !(file_index == 9 || file_index == 50) || header[16] != 0 {
        return false;
    }
    let offset = little(header, 3, 4);
    let remaining = little(header, 9, 4);
    let total = if file_index == 9 { 7_025_507 } else { 285_172 };
    offset.is_multiple_of(4096) && offset + remaining == total && block.len() as u64 == remaining.min(4096)
}

/// Only the locally pinned light map length is accepted on this path.
pub fn valid_light_map_ota_block(header: &[u8], block: &[u8], file_index: u8) -> bool {
    if file_index != 50 || !valid_file_block(header, block, file_index) || header[16] != 0 {
        return false;
    }
    let offset = little(header, 3, 4);
    let remaining = little(header, 9, 4);
    offset.is_multiple_of(4096) && offset + remaining == 285_318 && block.len() as u64 == remaining.min(4096)
}

/// Reads protobuf varints from a bounded buffer, at most 5 bytes and 32 bits each.
struct Varints<'a> {
    data: &'a [u8],
    offset: usize,
}

impl Varints<'_> {
    fn next(&mut self) -> Option<u64> {
        let mut value = 0u64;
        for index in 0..5 {
            let byte = *self.data.get(self.offset)?;
            self.offset += 1;
            value |= ((byte & 127) as u64) << (index * 7);
            if byte & 128 == 0 {
                return (value <= 0xffff_ffff).then_some(value);
            }
        }
        None
    }
    fn left(&self) -> usize {
        self.data.len() - self.offset
    }
}

/// The "HF…HS…" wrapper shared by music delete files; `category` is 0 (local) or 3 (NetEase).
fn valid_music_wrapper(file: &[u8], category: u8) -> bool {
    let l = |offset, count| little(file, offset, count);
    let len = file.len() as u64;
    let proto = &file[48..];
    file[0..4] == [0x48, 0x46, 0, 93]
        && l(8, 4) == len - 16
        && crc16(&file[0..14]) as u64 == l(14, 2)
        && crc16(&file[16..]) as u64 == l(12, 2)
        && file[16..24] == [0x48, 0x53, 0, category, 0, 0, 0, 0]
        && l(26, 2) == 44
        && l(30, 4) == len - 44
        && l(34, 4) == len - 44
        && l(38, 4) == 1
        && crc16(&file[16..42]) as u64 == l(42, 2)
        && l(44, 4) == proto.len() as u64
        && crc16(proto) as u64 == l(24, 2)
}

/// Removes songs from exactly one NetEase playlist: category 3 and one Music163StorageInfo with one playlist ID and
/// at least one song ID.
pub fn valid_netease_delete_block(header: &[u8], file: &[u8]) -> bool {
    let l = |offset, count| little(header, offset, count);
    if header.len() != 21 || header[..3] != [0x78, 0, 93] || file.len() < 48 || file.len() > 4096 {
        return false;
    }
    if l(3, 4) != 0
        || l(7, 2) != file.len() as u64
        || l(9, 4) != file.len() as u64
        || l(13, 2) != crc16(file) as u64
        || sum(file) != header[15]
        || header[16..20] != [3, 0, 0, 3]
        || sum(&header[2..20]) != header[20]
    {
        return false;
    }
    if !valid_music_wrapper(file, 3) {
        return false;
    }
    let proto = &file[48..];
    let mut r = Varints { data: proto, offset: 0 };
    if r.next() != Some(10) {
        return false;
    }
    match r.next() {
        Some(size) if size as usize == r.left() => {}
        _ => return false,
    }
    let (mut playlists, mut songs) = (0, 0);
    while r.left() > 0 {
        let Some(key) = r.next() else { return false };
        match key {
            8 | 32 => {
                if r.next().is_none() {
                    return false;
                }
            }
            18 | 26 => {
                let Some(count) = r.next() else { return false };
                let count = count as usize;
                if count == 0 || count > 32 || count > r.left() {
                    return false;
                }
                let id = &proto[r.offset..r.offset + count];
                if !id.iter().all(|&c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
                    return false;
                }
                r.offset += count;
                if key == 18 {
                    playlists += 1
                } else {
                    songs += 1
                }
            }
            42 => {
                let Some(count) = r.next() else { return false };
                if count > 64 || count as usize > r.left() {
                    return false;
                }
                r.offset += count as usize;
            }
            _ => return false,
        }
    }
    playlists == 1 && songs > 0 && songs <= 500
}

/// Exactly one local MP3 row (category 0), at most 512 bytes.
pub fn valid_music_delete_file(file: &[u8]) -> bool {
    if file.len() < 48 || file.len() > 512 || !valid_music_wrapper(file, 0) {
        return false;
    }
    let proto = &file[48..];
    let mut r = Varints { data: proto, offset: 0 };
    if r.next() != Some(10) {
        return false;
    }
    match r.next() {
        Some(size) if size as usize == r.left() => {}
        _ => return false,
    }
    let mut fields: Vec<u64> = Vec::new();
    while r.left() > 0 {
        let Some(key) = r.next() else { return false };
        if ![8, 16, 26, 32].contains(&key) || fields.contains(&key) {
            return false;
        }
        fields.push(key);
        if key == 26 {
            let Some(count) = r.next() else { return false };
            let count = count as usize;
            if count == 0 || count > 259 || count > r.left() {
                return false;
            }
            let Ok(path) = std::str::from_utf8(&proto[r.offset..r.offset + count]) else { return false };
            let Some(name) = path.strip_prefix("/emmc2:/Music/") else { return false };
            if !name.to_lowercase().ends_with(".mp3") || name.contains('/') || name.contains('\\') || name.chars().any(|c| (c as u32) < 32) {
                return false;
            }
            r.offset += count;
        } else {
            let Some(value) = r.next() else { return false };
            if key == 8 && value != 1 {
                return false;
            }
        }
    }
    fields.len() == 4
}

#[derive(Debug, PartialEq)]
pub struct Invalid;

/// What a receiver wants next: frames to write (to the bulk channel when `bulk`), or the finished payload.
#[derive(Debug, Default, PartialEq)]
pub struct ReadResult {
    pub frames: Vec<Vec<u8>>,
    pub bulk: bool,
    pub payload: Option<Vec<u8>>,
}

impl ReadResult {
    fn frames(frames: Vec<Vec<u8>>) -> Self {
        ReadResult { frames, ..Default::default() }
    }
    fn window(file_index: u8) -> Self {
        // Window requests use the bulk channel and have no SUM byte.
        ReadResult { frames: vec![vec![0x7c, 0, file_index]], bulk: true, payload: None }
    }
    fn payload(payload: Vec<u8>) -> Self {
        ReadResult { payload: Some(payload), ..Default::default() }
    }
}

/// A multi-frame control reply with a frames-left counter and a SUM byte.
pub struct ControlReply {
    opcode: u8,
    limit: usize,
    bytes: Vec<u8>,
    remaining: Option<u8>,
}

impl ControlReply {
    pub fn new(opcode: u8, limit: usize) -> Self {
        ControlReply { opcode, limit, bytes: Vec::new(), remaining: None }
    }
    pub fn set_opcode(&mut self, opcode: u8) {
        self.opcode = opcode;
    }
    /// Ok(None) while more frames are due; frames of another opcode are ignored.
    pub fn accept(&mut self, data: &[u8]) -> Result<Option<Vec<u8>>, Invalid> {
        if data.first() != Some(&self.opcode) {
            return Ok(None);
        }
        let in_order = match self.remaining {
            None => true,
            Some(r) => r > 0 && data.get(1) == Some(&(r - 1)),
        };
        if data.len() < 3 || !in_order {
            return Err(Invalid);
        }
        self.remaining = Some(data[1]);
        self.bytes.extend_from_slice(&data[2..]);
        if self.bytes.len() > self.limit {
            return Err(Invalid);
        }
        if data[1] != 0 {
            return Ok(None);
        }
        let (body, checksum) = self.bytes.split_at(self.bytes.len() - 1);
        if sum(body) != checksum[0] {
            return Err(Invalid);
        }
        let payload = body.to_vec();
        self.bytes.clear();
        self.remaining = None;
        Ok(Some(payload))
    }
}

#[derive(PartialEq)]
enum Stage {
    Header,
    Bulk,
    Ack,
    Done,
}

/// Read-only W332 music metadata (storage category 0, SFT file 93). Can't request audio, upload or delete.
pub struct MusicPageReceiver {
    page: i64,
    category: i64,
    file: Vec<u8>,
    block: Vec<u8>,
    header: Vec<u8>,
    control: ControlReply,
    sequence: usize,
    stage: Stage,
    total: Option<u64>,
}

impl MusicPageReceiver {
    pub fn new(page: i64, category: i64) -> Self {
        MusicPageReceiver {
            page,
            category,
            file: Vec::new(),
            block: Vec::new(),
            header: Vec::new(),
            control: ControlReply::new(0x7c, 512),
            sequence: 0,
            stage: Stage::Header,
            total: None,
        }
    }

    pub fn request_frames(&self) -> Vec<Vec<u8>> {
        let time = now_seconds() - MOBILE_EPOCH;
        let zone = utc_offset_seconds() / 900;
        let mut payload = vec![93];
        payload.extend(integer(self.file.len() as i64, 4));
        payload.push(0);
        payload.extend(integer(time, 4));
        payload.extend([zone as u8, 3]);
        payload.extend(integer(self.category, 4));
        payload.extend(integer(self.page, 4));
        frames18(0x7c, &payload)
    }

    pub fn accept(&mut self, data: &[u8], control: bool) -> Result<ReadResult, Invalid> {
        if control {
            self.control.set_opcode(if self.stage == Stage::Ack { 0x7d } else { 0x7c });
            let Some(payload) = self.control.accept(data)? else { return Ok(ReadResult::default()) };
            if self.stage == Stage::Ack {
                if payload != [1, 93] {
                    return Err(Invalid);
                }
                if Some(self.file.len() as u64) == self.total {
                    return Ok(ReadResult::payload(self.file.clone()));
                }
                self.stage = Stage::Header;
                return Ok(ReadResult::frames(self.request_frames()));
            }
            // +12 is 0 for every category; the category travels in the request.
            if self.stage != Stage::Header || payload.len() < 19 || payload[12] != 0 || payload[15] != 93 || payload[16] != 3 {
                return Err(Invalid);
            }
            let size = little(&payload, 4, 2);
            let remaining = little(&payload, 6, 4);
            if size == 0 || size > 12_288 || size > remaining || remaining > 262_144 || payload[13] < 20 || payload[14] == 0 {
                return Err(Invalid);
            }
            match self.total {
                Some(total) if self.file.len() as u64 + remaining != total => return Err(Invalid),
                Some(_) => {}
                None => self.total = Some(remaining),
            }
            self.header = payload;
            self.block.clear();
            self.sequence = 0;
            self.stage = Stage::Bulk;
            return Ok(ReadResult::window(93));
        }
        if data.len() < 3 || data[0] != 0x7c || data[2] != 93 {
            return Ok(ReadResult::default());
        }
        let size = if self.header.is_empty() { 0 } else { little(&self.header, 4, 2) as usize };
        if self.stage != Stage::Bulk
            || data.len() <= 3
            || data[1] as usize != self.sequence
            || data.len() > self.header[13] as usize
            || self.block.len() + data.len() - 3 > size
        {
            return Err(Invalid);
        }
        self.block.extend_from_slice(&data[3..]);
        self.sequence += 1;
        if self.block.len() == size {
            if crc16(&self.block) as u64 != little(&self.header, 10, 2) {
                return Err(Invalid);
            }
            // The success bit acknowledges metadata and releases the watch's listing cache; it deletes nothing.
            let mut ack = integer(self.file.len() as i64, 4);
            ack.extend([1, 93]);
            ack.extend([0u8; 10]);
            self.file.extend_from_slice(&self.block);
            self.stage = Stage::Ack;
            return Ok(ReadResult::frames(frames18(0x7d, &ack)));
        }
        if self.sequence == self.header[14] as usize {
            self.sequence = 0;
            return Ok(ReadResult::window(93));
        }
        Ok(ReadResult::default())
    }
}

/// Files local sync reads, never acknowledged (0x7D would move the watch's sync pointer): the daily history 5,
/// the workouts 14 and the watch settings 54. Never a write or delete file (the gear list 84 is write-only).
pub const READ_ONLY_SYNC_FILES: [i64; 3] = [14, 5, 54];
pub const SYNC_MAX_BLOCK_BYTES: u64 = 12_288;
pub const SYNC_MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// Why a sync block failed: damaged, or refused with a code (CorosKit's `WatchSyncFile.Refused`): the watch's own
/// code at @12 of a short header (0x16 busy, 0x14 nothing to give), or 0 when another client's sync got in the way.
#[derive(Debug, PartialEq)]
pub enum SyncError {
    Invalid,
    Refused(u8),
}

/// C-LINK's own refusal code: another client (the COROS app, the watch itself) was syncing over the same link.
pub const ANOTHER_SYNC: u8 = 0;

/// One CRC-checked SyncData block: the payload is [remaining u32][block]. A port of CorosKit's SyncBlockReceiver:
/// every subscriber hears the watch's replies, so another client's headers, records, 0x7D acknowledgements and 0x78
/// file replies are passed over and remembered (`saw_other_sync`); a block that then fails is busy, not damaged.
pub struct SyncBlockReceiver {
    file_index: u8,
    offset: u64,
    selector: u64,
    now: i64,
    utc_offset: i64,
    control: ControlReply,
    header: Vec<u8>,
    block: Vec<u8>,
    sequence: usize,
    stage: Stage,
    saw_other_sync: bool,
}

impl SyncBlockReceiver {
    pub fn new(file_index: i64, offset: i64, selector: i64, now: Option<i64>, utc_offset: Option<i64>) -> Option<Self> {
        if !READ_ONLY_SYNC_FILES.contains(&file_index) || offset < 0 || offset as u64 >= SYNC_MAX_FILE_BYTES || !(0..=0xffff_ffff).contains(&selector) {
            return None;
        }
        Some(SyncBlockReceiver {
            file_index: file_index as u8,
            offset: offset as u64,
            selector: selector as u64,
            now: now.unwrap_or_else(now_seconds),
            utc_offset: utc_offset.unwrap_or_else(utc_offset_seconds),
            control: ControlReply::new(0x7c, 4096),
            header: Vec::new(),
            block: Vec::new(),
            sequence: 0,
            stage: Stage::Header,
            saw_other_sync: false,
        })
    }

    /// Whether traffic that isn't ours came in during this block (a timeout then reads as busy too).
    pub fn saw_other_sync(&self) -> bool {
        self.saw_other_sync
    }

    pub fn request_frames(&self) -> Vec<Vec<u8>> {
        let mut payload = vec![self.file_index];
        payload.extend(integer(self.offset as i64, 4));
        payload.push(0);
        payload.extend(integer(self.now - MOBILE_EPOCH, 4));
        payload.extend([(self.utc_offset / 900) as u8, 3]);
        payload.extend(integer(0, 4));
        payload.extend(integer(self.selector as i64, 4));
        frames18(0x7c, &payload)
    }

    /// Busy when someone else's sync was heard, otherwise damaged.
    fn failure(&self) -> SyncError {
        if self.saw_other_sync {
            SyncError::Refused(ANOTHER_SYNC)
        } else {
            SyncError::Invalid
        }
    }

    /// One 0x7C control reply, reassembled. Replies to someone else interleave with ours and carry no file, so a
    /// frame out of sequence (or a reply whose SUM fails) drops what came before it and starts a new reply. The
    /// reassembly starts afresh after every last frame: the next 0x7C may be someone else's header.
    fn reassemble(&mut self, frame: &[u8]) -> Option<Vec<u8>> {
        let payload = match self.control.accept(frame) {
            Ok(payload) => payload,
            Err(_) => {
                self.saw_other_sync = true;
                self.control = ControlReply::new(0x7c, 4096);
                self.control.accept(frame).unwrap_or_else(|_| {
                    self.control = ControlReply::new(0x7c, 4096);
                    None
                })
            }
        };
        if frame.len() >= 2 && frame[1] == 0 {
            self.control = ControlReply::new(0x7c, 4096);
        }
        payload
    }

    pub fn accept(&mut self, data: &[u8], control: bool) -> Result<ReadResult, SyncError> {
        if control {
            // Someone's acknowledgement (the COROS app's 0x7D) or a file transfer's reply (0x78): another sync.
            if matches!(data.first(), Some(0x7d) | Some(0x78)) {
                self.saw_other_sync = true;
                return Ok(ReadResult::default());
            }
            if data.first() != Some(&0x7c) {
                return Ok(ReadResult::default());
            }
            let Some(payload) = self.reassemble(data) else { return Ok(ReadResult::default()) };
            // Another file's header (or refusal) answers someone else.
            if payload.len() >= 16 && payload[15] != self.file_index {
                self.saw_other_sync = true;
                return Ok(ReadResult::default());
            }
            // A second header for this file once ours is in: someone else reads it too.
            if self.stage != Stage::Header {
                self.saw_other_sync = true;
                return Ok(ReadResult::default());
            }
            // A refusal is a short header: no size, a code at @12.
            if payload.len() >= 16 && payload[12] != 0 && little(&payload, 4, 2) == 0 {
                return Err(SyncError::Refused(payload[12]));
            }
            if payload.len() < 19 || payload[12] != 0 || payload[15] != self.file_index || payload[16] != 3 {
                return Err(self.failure());
            }
            let size = little(&payload, 4, 2);
            let remaining = little(&payload, 6, 4);
            if size == 0 && remaining == 0 {
                // An empty file at the start (the COROS app just synced); inside the file, the watch is serving
                // another client's sync.
                if self.offset == 0 {
                    self.stage = Stage::Done;
                    return Ok(ReadResult::payload(vec![0; 4]));
                }
                return Err(SyncError::Refused(ANOTHER_SYNC));
            }
            if size == 0
                || size > SYNC_MAX_BLOCK_BYTES
                || size > remaining
                || remaining > SYNC_MAX_FILE_BYTES
                || self.offset + remaining > SYNC_MAX_FILE_BYTES
                || payload[13] < 20
                || payload[14] == 0
            {
                return Err(self.failure());
            }
            self.header = payload;
            self.block.clear();
            self.sequence = 0;
            self.stage = Stage::Bulk;
            return Ok(ReadResult::window(self.file_index));
        }
        if data.len() < 3 || data[0] != 0x7c {
            return Ok(ReadResult::default());
        }
        // Another file's records: someone else's sync.
        if data[2] != self.file_index {
            self.saw_other_sync = true;
            return Ok(ReadResult::default());
        }
        // Records before this block's header are left over from a read that failed partway.
        if self.header.is_empty() {
            return Ok(ReadResult::default());
        }
        let size = little(&self.header, 4, 2) as usize;
        if self.stage != Stage::Bulk
            || data.len() <= 3
            || data[1] as usize != self.sequence
            || data.len() > self.header[13] as usize
            || self.block.len() + data.len() - 3 > size
        {
            return Err(self.failure());
        }
        self.block.extend_from_slice(&data[3..]);
        self.sequence += 1;
        if self.block.len() == size {
            if crc16(&self.block) as u64 != little(&self.header, 10, 2) {
                return Err(self.failure());
            }
            self.stage = Stage::Done;
            let mut payload = integer(little(&self.header, 6, 4) as i64, 4);
            payload.extend_from_slice(&self.block);
            return Ok(ReadResult::payload(payload));
        }
        if self.sequence == self.header[14] as usize {
            self.sequence = 0;
            return Ok(ReadResult::window(self.file_index));
        }
        Ok(ReadResult::default())
    }
}

/// The watch's own interactive messages (control opcode 0x0D, such as live workout data), reassembled apart from
/// any request: a port of CorosKit's InteractiveReceiver. A message is SUM-framed like any control reply and holds
/// records [subtype][size][body]; a body of 255 bytes continues in the next record of the same subtype.
#[derive(Default)]
pub struct InteractiveReceiver {
    response: Option<ControlReply>,
    last_frame: Option<f64>,
    partial: bool,
}

pub const INTERACTIVE_OPCODE: u8 = 0x0d;
const INTERACTIVE_MAX_BYTES: usize = 4096;

impl InteractiveReceiver {
    fn reply(&mut self) -> &mut ControlReply {
        self.response.get_or_insert_with(|| ControlReply::new(INTERACTIVE_OPCODE, 4096))
    }

    fn restart(&mut self) {
        self.response = None;
        self.partial = false;
    }

    /// The records a frame completes, if any. `time` is a monotonic clock in seconds; a message left half-way for
    /// more than 3 s is dropped.
    pub fn accept(&mut self, frame: &[u8], time: f64) -> Vec<(u8, Vec<u8>)> {
        if self.partial && self.last_frame.is_some_and(|last| time - last > 3.0) {
            self.restart();
        }
        self.last_frame = Some(time);
        let payload = match self.reply().accept(frame) {
            Ok(payload) => payload,
            Err(_) => {
                // The message so far is out of sequence or damaged; the frame may begin the next one.
                self.restart();
                match self.reply().accept(frame) {
                    Ok(payload) => payload,
                    Err(_) => {
                        self.restart();
                        return Vec::new();
                    }
                }
            }
        };
        let Some(payload) = payload else {
            self.partial = true;
            return Vec::new();
        };
        self.restart();
        interactive_records(&payload).unwrap_or_default()
    }
}

/// The records of one interactive message, or None when it is damaged.
pub fn interactive_records(data: &[u8]) -> Option<Vec<(u8, Vec<u8>)>> {
    let mut records = Vec::new();
    let mut offset = 0;
    let next = |offset: &mut usize| -> Option<&[u8]> {
        if data.len() - *offset < 2 {
            return None;
        }
        let size = data[*offset + 1] as usize;
        *offset += 2;
        if size > data.len() - *offset {
            return None;
        }
        let part = &data[*offset..*offset + size];
        *offset += size;
        Some(part)
    };
    while offset < data.len() {
        let subtype = data[offset];
        let mut part = next(&mut offset)?;
        let mut body = part.to_vec();
        while part.len() == 255 && offset < data.len() && data[offset] == subtype {
            part = next(&mut offset)?;
            body.extend_from_slice(part);
        }
        if body.len() > INTERACTIVE_MAX_BYTES {
            return None;
        }
        records.push((subtype, body));
    }
    Some(records)
}

/// A music delete completes only after both the SFT transfer and storage command C1.
#[derive(Default)]
pub struct MusicDeleteReceiver {
    pub file_acknowledged: bool,
    storage_payload: Option<Vec<u8>>,
    bytes: Vec<u8>,
    remaining: Option<u8>,
}

impl MusicDeleteReceiver {
    pub fn result(&self) -> Option<Vec<u8>> {
        if self.file_acknowledged {
            self.storage_payload.clone()
        } else {
            None
        }
    }

    pub fn accept_storage(&mut self, frame: &[u8]) -> Result<(), Invalid> {
        let in_order = match self.remaining {
            None => true,
            Some(r) => r > 0 && frame.get(1) == Some(&(r - 1)),
        };
        if frame.len() < 3 || frame[0] != 0xc1 || self.storage_payload.is_some() || !in_order {
            return Err(Invalid);
        }
        self.remaining = Some(frame[1]);
        self.bytes.extend_from_slice(&frame[2..]);
        if self.bytes.len() > 5 {
            return Err(Invalid);
        }
        if frame[1] == 0 {
            // [2] echoes the storage category: 0 local music, 3 NetEase.
            let b = &self.bytes;
            if b.len() != 5 || b[0] != 1 || b[1] != 1 || !(b[2] == 0 || b[2] == 3) || sum(&b[..4]) != b[4] {
                return Err(Invalid);
            }
            self.storage_payload = Some(b[..4].to_vec());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 21-byte SFT header for `block`, built the way CorosLink's TypeScript encoders build it.
    fn header(file_index: u8, block: &[u8], offset: u32, remaining: u32, byte16: u8) -> Vec<u8> {
        let mut h = vec![0x78, 0, file_index];
        h.extend(offset.to_le_bytes());
        h.extend((block.len() as u16).to_le_bytes());
        h.extend(remaining.to_le_bytes());
        h.extend(crc16(block).to_le_bytes());
        h.push(sum(block));
        h.extend([byte16, 0, 0, 3]);
        let s = sum(&h[2..20]);
        h.push(s);
        h
    }

    #[test]
    fn checksums() {
        assert_eq!(crc16(b"123456789"), 0x29B1);
        assert_eq!(sum(&[0xff, 0x02]), 1);
        assert_eq!(little(&[0x34, 0x12, 0, 0], 0, 4), 0x1234);
        assert_eq!(integer(-1, 2), vec![0xff, 0xff]);
    }

    #[test]
    fn control_frames_split_and_number() {
        let frames = chunked(0xA5, &[1, 2, 3, 4, 5], 3);
        // 5 bytes + SUM = 6 bytes in chunks of 3: two frames, counting down.
        assert_eq!(frames, vec![vec![0xA5, 1, 1, 2, 3], vec![0xA5, 0, 4, 5, 15]]);
    }

    #[test]
    fn watch_events() {
        assert_eq!(decode_watch_interaction(&[0xC5, 0, 3, 1, 4]), Some(serde_json::json!({"kind":"media-control","action":3,"value":1})));
        assert_eq!(decode_watch_interaction(&[2, 0, 2, 2]), Some(serde_json::json!({"kind":"call-rejected"})));
        assert_eq!(decode_watch_interaction(&[0xC5, 0, 3, 1, 5]), None);
        assert_eq!(decode_usb_access(&[0x0D, 0, 0x11, 1, 0, 0x12]), Some("usb-access-request"));
        assert_eq!(decode_usb_access(&[0x0D, 0, 0x11, 1, 1, 0x13]), Some("usb-access-closed"));
        assert_eq!(decode_usb_access(&[0x0D, 0, 0x11, 1, 2, 0x14]), None);
    }

    #[test]
    fn file_blocks() {
        let block: Vec<u8> = (0..4096u32).map(|i| (i * 7) as u8).collect();
        let face = header(8, &block, 0, 9000, 1);
        assert!(valid_file_block(&face, &block, 8));
        assert!(!valid_file_block(&face, &block, 0x14), "wrong transfer type");
        let mut bad = face.clone();
        bad[16] = 10;
        assert!(!valid_file_block(&bad, &block, 8), "watch face slot out of range");
        let mut bad = face.clone();
        bad[20] ^= 1;
        assert!(!valid_file_block(&bad, &block, 8), "header SUM");
        let mut bad = face.clone();
        bad[13] ^= 1;
        assert!(!valid_file_block(&bad, &block, 8), "block CRC");
        assert!(!valid_file_block(&header(8, &block, 0, 0x320001, 1), &block, 8), "over the face size limit");
        // Pushed data files: weather 80 at most 64 KB, GPS assistance with an hour in 16–18.
        let small = vec![1u8; 100];
        assert!(valid_file_block(&header(80, &small, 0, 100, 0), &small, 80));
        assert!(!valid_file_block(&header(81, &small, 0, 100, 0), &small, 81), "unknown file");
        let mut gps = header(13, &small, 0, 100, 0);
        gps[16] = 5;
        gps[17] = 6;
        gps[18] = 7;
        gps[20] = sum(&gps[2..20]);
        assert!(valid_file_block(&gps, &small, 13));
    }

    #[test]
    fn ota_blocks() {
        let block = vec![9u8; 4096];
        assert!(valid_official_ota_block(&header(9, &block, 4096, 7_025_507 - 4096, 0), &block, 9));
        assert!(!valid_official_ota_block(&header(9, &block, 4000, 7_025_507 - 4000, 0), &block, 9), "unaligned");
        assert!(valid_light_map_ota_block(&header(50, &block, 0, 285_318, 0), &block, 50));
        assert!(!valid_light_map_ota_block(&header(50, &block, 0, 285_172, 0), &block, 50));
    }

    /// A one-row local music delete file, as CorosLink's encodeMusicDeleteFile writes it.
    fn music_delete_file(path: &str) -> Vec<u8> {
        let mut row = vec![8, 1, 16, 42, 26, path.len() as u8];
        row.extend(path.as_bytes());
        row.extend([32, 0xd2, 0x09]);
        let mut proto = vec![10, row.len() as u8];
        proto.extend(row);
        let len = 48 + proto.len();
        let mut file = vec![0u8; 48];
        file[0..4].copy_from_slice(&[0x48, 0x46, 0, 93]);
        file[8..12].copy_from_slice(&((len - 16) as u32).to_le_bytes());
        file[16..24].copy_from_slice(&[0x48, 0x53, 0, 0, 0, 0, 0, 0]);
        file[24..26].copy_from_slice(&crc16(&proto).to_le_bytes());
        file[26..28].copy_from_slice(&44u16.to_le_bytes());
        file[30..34].copy_from_slice(&((len - 44) as u32).to_le_bytes());
        file[34..38].copy_from_slice(&((len - 44) as u32).to_le_bytes());
        file[38..42].copy_from_slice(&1u32.to_le_bytes());
        file[44..48].copy_from_slice(&(proto.len() as u32).to_le_bytes());
        let c = crc16(&file[16..42]);
        file[42..44].copy_from_slice(&c.to_le_bytes());
        file.extend(&proto);
        let c = crc16(&file[16..]);
        file[12..14].copy_from_slice(&c.to_le_bytes());
        let c = crc16(&file[0..14]);
        file[14..16].copy_from_slice(&c.to_le_bytes());
        file
    }

    #[test]
    fn music_deletes() {
        let file = music_delete_file("/emmc2:/Music/Café.mp3");
        assert!(valid_music_delete_file(&file));
        assert!(valid_file_block(&header(93, &file, 0, file.len() as u32, 0), &file, 93));
        assert!(!valid_music_delete_file(&music_delete_file("/emmc2:/Music/a/b.mp3")), "no folders");
        assert!(!valid_music_delete_file(&music_delete_file("/emmc2:/Music/song.wav")), "MP3 only");
        assert!(!valid_music_delete_file(&music_delete_file("/emmc2:/Other/song.mp3")), "Music folder only");
        let mut receiver = MusicDeleteReceiver::default();
        receiver.accept_storage(&[0xc1, 0, 1, 1, 0, 0, 2]).unwrap();
        assert_eq!(receiver.result(), None, "not before the file is acknowledged");
        receiver.file_acknowledged = true;
        assert_eq!(receiver.result(), Some(vec![1, 1, 0, 0]));
        assert!(MusicDeleteReceiver::default().accept_storage(&[0xc1, 0, 1, 1, 0, 0, 3]).is_err());
    }

    /// The watch's header reply for a block: size, remaining, CRC, packet size 20+, window.
    fn sync_header(file_index: u8, block: &[u8], remaining: u32, packet: u8, window: u8) -> Vec<u8> {
        let mut p = vec![0u8; 19];
        p[4..6].copy_from_slice(&(block.len() as u16).to_le_bytes());
        p[6..10].copy_from_slice(&remaining.to_le_bytes());
        p[10..12].copy_from_slice(&crc16(block).to_le_bytes());
        p[13] = packet;
        p[14] = window;
        p[15] = file_index;
        p[16] = 3;
        p
    }

    #[test]
    fn sync_block() {
        let block: Vec<u8> = (0..100u8).collect();
        let mut r = SyncBlockReceiver::new(14, 0, 0, Some(MOBILE_EPOCH + 10), Some(3600)).unwrap();
        let request = r.request_frames();
        assert_eq!(request[0][..4], [0x7c, 1, 14, 0]);
        // Header reply in two control frames.
        let frames = frames18(0x7c, &sync_header(14, &block, 100, 40, 2));
        assert_eq!(r.accept(&frames[0], true).unwrap(), ReadResult::default());
        assert_eq!(r.accept(&frames[1], true).unwrap(), ReadResult::window(14));
        // Packets of 37 bytes of data (40 with the 3-byte lead), window of 2.
        let packets: Vec<Vec<u8>> = block.chunks(37).enumerate().map(|(i, c)| [vec![0x7c, (i % 2) as u8, 14], c.to_vec()].concat()).collect();
        assert_eq!(r.accept(&packets[0], false).unwrap(), ReadResult::default());
        assert_eq!(r.accept(&packets[1], false).unwrap(), ReadResult::window(14));
        let done = r.accept(&packets[2], false).unwrap();
        assert_eq!(done.payload.unwrap(), [100u32.to_le_bytes().to_vec(), block.clone()].concat());
        assert!(SyncBlockReceiver::new(15, 0, 0, None, None).is_none(), "read-only files only");
        // A wrong sequence number is refused.
        let mut r = SyncBlockReceiver::new(5, 0, 0, None, None).unwrap();
        for f in frames18(0x7c, &sync_header(5, &block, 100, 40, 2)) {
            r.accept(&f, true).unwrap();
        }
        assert!(r.accept(&[vec![0x7c, 1, 5], block[..37].to_vec()].concat(), false).is_err());
    }

    #[test]
    fn music_page() {
        let block: Vec<u8> = (0..50u8).collect();
        let mut r = MusicPageReceiver::new(0, 0);
        assert_eq!(r.request_frames()[0][..3], [0x7c, 1, 93]);
        let mut last = ReadResult::default();
        for f in frames18(0x7c, &sync_header(93, &block, 50, 60, 1)) {
            last = r.accept(&f, true).unwrap();
        }
        assert_eq!(last, ReadResult::window(93));
        let ack = r.accept(&[vec![0x7c, 0, 93], block.clone()].concat(), false).unwrap();
        assert_eq!(ack.frames[0][0], 0x7d, "metadata acknowledged");
        let done = r.accept(&frames18(0x7d, &[1, 93])[0], true).unwrap();
        assert_eq!(done.payload.unwrap(), block);
    }
}

#[cfg(test)]
mod coroslink_vectors {
    //! Headers and files made by CorosLink's own TypeScript encoders (coroslink-vectors.json), the same ones its
    //! Swift helper test checks: the Rust checks must accept them and reject them when altered.
    use super::*;

    fn hex(value: &serde_json::Value) -> Vec<u8> {
        let text = value.as_str().unwrap();
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn accepts_coroslink_encodings() {
        let v: serde_json::Value = serde_json::from_str(include_str!("coroslink-vectors.json")).unwrap();
        let (header, block) = (hex(&v["watchface"]["header"]), hex(&v["watchface"]["block"]));
        assert!(valid_file_block(&header, &block, 8));
        assert!(!valid_file_block(&header, &block, 0x14));
        let mut bad = header.clone();
        bad[16] = 10;
        assert!(!valid_file_block(&bad, &block, 8));
        let (header, file) = (hex(&v["musicDelete"]["header"]), hex(&v["musicDelete"]["file"]));
        assert!(valid_music_delete_file(&file));
        assert!(valid_file_block(&header, &file, 93));
        let mut bad = file.clone();
        let last = bad.len() - 1;
        bad[last] ^= 1;
        assert!(!valid_file_block(&header, &bad, 93));
    }
}

#[cfg(test)]
mod coroskit_sync {
    //! CorosKit's own tests for SyncBlockReceiver and InteractiveReceiver (WatchDataTests, WatchWorkoutTests,
    //! LiveWorkoutTests), with their frames and expected values.
    use super::*;

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap()).collect()
    }
    fn receiver(file: i64, offset: i64) -> SyncBlockReceiver {
        SyncBlockReceiver::new(file, offset, 0, None, None).unwrap()
    }
    const HEADER: [&str; 2] = ["7c010000000032009600000046ad0014020e0300", "7c0000e2"];
    const RECORDS: [&str; 3] = ["7c000e0b30557a9fc4e90e33587da2c7ec11365b", "7c010e80a5caef14395e83a8cdf2173c6186abd0", "7c000ef51a3f6489aed3f81d42678cb1d6fb20"];
    /// The trace's header for file 54: a whole, valid reply to someone else.
    const FOREIGN_SETTINGS_HEADER: &str = "7c00006081008c278c270000405300f01a360300001d";

    #[test]
    fn sync_requests_match_coroslinks_vectors() {
        let cases = [
            (0, 0, 1_792_300_000, 25200, ["7c010e000000000060f910181c03000000000000", "7c000000ae"]),
            (8192, 3, 1_792_300_000, -18000, ["7c010e002000000060f91018ec03000000000300", "7c000000a1"]),
            (1, 0, 1_792_300_123, -12600, ["7c010e0100000000dbf91018f203000000000000", "7c00000000"]),
        ];
        for (offset, selector, now, zone, frames) in cases {
            let r = SyncBlockReceiver::new(14, offset, selector, Some(now), Some(zone)).unwrap();
            assert_eq!(r.request_frames(), frames.map(hex).to_vec());
        }
        assert!(SyncBlockReceiver::new(93, 0, 0, None, None).is_none(), "only the record files are readable");
        assert!(SyncBlockReceiver::new(84, 0, 0, None, None).is_none(), "the gear list is write-only");
    }

    #[test]
    fn sync_block_is_reassembled_and_checked() {
        let mut r = receiver(14, 0);
        let mut windows = 0;
        let mut payload = None;
        for f in HEADER {
            let step = r.accept(&hex(f), true).unwrap();
            if step.bulk {
                windows += 1;
                assert_eq!(step.frames, vec![vec![0x7c, 0, 14]]);
            }
        }
        for f in RECORDS {
            let step = r.accept(&hex(f), false).unwrap();
            if step.bulk {
                windows += 1;
            }
            payload = step.payload.or(payload);
        }
        assert_eq!(windows, 2);
        assert_eq!(payload.unwrap(), hex("960000000b30557a9fc4e90e33587da2c7ec11365b80a5caef14395e83a8cdf2173c6186abd0f51a3f6489aed3f81d42678cb1d6fb20"));
        let mut damaged = receiver(14, 0);
        for f in HEADER {
            damaged.accept(&hex(f), true).unwrap();
        }
        assert_eq!(damaged.accept(&hex("7c010e0b30557a9f"), false), Err(SyncError::Invalid), "out of sequence");
    }

    #[test]
    fn sync_block_passes_over_other_reads() {
        let mut r = receiver(14, 0);
        assert_eq!(r.accept(&hex(RECORDS[0]), false).unwrap(), ReadResult::default(), "records before the header");
        let other = hex(concat!("00000000320096000000", "46ad0014020503", "0000"));
        assert_eq!(other[15], 5);
        for f in frames18(0x7c, &other) {
            assert_eq!(r.accept(&f, true).unwrap(), ReadResult::default(), "the daily history's header");
        }
        let mut payload = None;
        for f in HEADER {
            r.accept(&hex(f), true).unwrap();
        }
        for f in RECORDS {
            payload = r.accept(&hex(f), false).unwrap().payload.or(payload);
        }
        assert_eq!(payload.unwrap().len(), 4 + 50);
    }

    #[test]
    fn settings_file_header_as_a_pace_pro_sends_it() {
        let mut r = receiver(54, 0);
        let mut last = ReadResult::default();
        for f in frames18(0x7c, &hex("00608100ff27ff270000031400f01a36030000")) {
            last = r.accept(&f, true).unwrap();
        }
        assert_eq!(last, ReadResult::window(54));
    }

    #[test]
    fn empty_file_header_is_nothing_new() {
        let empty = hex("00000000000000000000000000f01a05030000");
        let mut r = receiver(5, 0);
        let mut last = ReadResult::default();
        for f in frames18(0x7c, &empty) {
            last = r.accept(&f, true).unwrap();
        }
        assert_eq!(last, ReadResult::payload(vec![0; 4]), "remaining 0, an empty block");
        let mut later = receiver(5, 4096);
        let results: Vec<_> = frames18(0x7c, &empty).iter().map(|f| later.accept(f, true)).collect();
        assert!(results.iter().any(Result::is_err), "past the start, an empty block is still refused");
    }

    #[test]
    fn reading_workouts_never_acknowledges() {
        let mut r = receiver(14, 0);
        let mut written = r.request_frames();
        for f in HEADER {
            written.extend(r.accept(&hex(f), true).unwrap().frames);
        }
        for f in RECORDS {
            written.extend(r.accept(&hex(f), false).unwrap().frames);
        }
        assert!(!written.is_empty());
        assert!(written.iter().all(|f| f[0] == 0x7c), "only 7C frames");
    }

    #[test]
    fn a_busy_watch_refuses_the_read() {
        let busy = hex("7c0000000000000000000000000016f01a0e2e");
        assert_eq!(receiver(14, 0).accept(&busy, true), Err(SyncError::Refused(0x16)));
        assert_eq!(receiver(5, 0).accept(&busy, true).unwrap().frames, Vec::<Vec<u8>>::new(), "another file's refusal");
    }

    #[test]
    fn a_watch_with_nothing_to_give_answers_0x14() {
        assert_eq!(receiver(5, 0).accept(&hex("7c0000000000000000000000000014f01a0523"), true), Err(SyncError::Refused(0x14)));
    }

    #[test]
    fn other_sync_traffic_mid_block_is_ignored() {
        let mut r = receiver(14, 36864);
        let mut written = Vec::new();
        for f in HEADER {
            written.extend(r.accept(&hex(f), true).unwrap().frames);
        }
        for f in ["be000101", "cb000101", "bd000101", FOREIGN_SETTINGS_HEADER, "7d00010506"] {
            assert_eq!(r.accept(&hex(f), true).unwrap(), ReadResult::default());
        }
        assert!(r.saw_other_sync());
        let mut payload = None;
        for f in RECORDS {
            let step = r.accept(&hex(f), false).unwrap();
            written.extend(step.frames);
            payload = step.payload.or(payload);
        }
        let payload = payload.unwrap();
        assert_eq!(little(&payload, 0, 4), 150);
        assert_eq!(payload.len() - 4, 50);
        assert!(!written.iter().any(|f| f[0] == 0x7d));
    }

    #[test]
    fn the_trace_header_is_another_files_whole_reply() {
        let payload = ControlReply::new(0x7c, 4096).accept(&hex(FOREIGN_SETTINGS_HEADER)).unwrap().unwrap();
        assert_eq!(payload[15], 54);
    }

    #[test]
    fn a_reply_split_by_someone_elses_is_dropped_not_thrown() {
        let mut r = receiver(14, 36864);
        for f in [HEADER[0], FOREIGN_SETTINGS_HEADER, HEADER[1]] {
            assert_eq!(r.accept(&hex(f), true).unwrap(), ReadResult::default());
        }
        assert!(r.saw_other_sync());
        let mut step = ReadResult::default();
        for f in HEADER {
            step = r.accept(&hex(f), true).unwrap();
        }
        assert_eq!(step.frames, vec![vec![0x7c, 0, 0x0e]], "the header asked for again is used");
    }

    #[test]
    fn an_empty_header_inside_the_file_is_busy() {
        let empty = hex("7c0000000000000000000000000000f01a0e0300001b");
        assert_eq!(receiver(14, 36864).accept(&empty, true), Err(SyncError::Refused(ANOTHER_SYNC)));
        assert_eq!(receiver(14, 0).accept(&empty, true).unwrap().payload, Some(vec![0; 4]));
    }

    #[test]
    fn broken_records_during_another_sync_are_busy() {
        let read = |other: &[&str]| {
            let mut r = receiver(14, 36864);
            for f in HEADER.iter().chain(other) {
                let _ = r.accept(&hex(f), true);
            }
            r.accept(&hex(RECORDS[0]), false).unwrap();
            r.accept(&hex(RECORDS[0]), false)
        };
        assert_eq!(read(&["7d00010506"]), Err(SyncError::Refused(ANOTHER_SYNC)));
        assert_eq!(read(&[]), Err(SyncError::Invalid));
    }

    /// CorosKit's LiveWorkoutTests `frames`: records split into 255-byte parts, framed in 18-byte chunks.
    fn interactive_frames(records: &[(u8, Vec<u8>)]) -> Vec<Vec<u8>> {
        let mut payload = Vec::new();
        for (subtype, body) in records {
            let mut offset = 0;
            loop {
                let chunk = &body[offset..(offset + 255).min(body.len())];
                payload.extend([*subtype, chunk.len() as u8]);
                payload.extend_from_slice(chunk);
                offset += 255;
                if offset >= body.len() {
                    break;
                }
            }
        }
        frames18(INTERACTIVE_OPCODE, &payload)
    }

    #[test]
    fn interactive_messages_reassemble_across_frames_and_records() {
        let long: Vec<u8> = (0..300u32).map(|i| (i % 251) as u8).collect();
        let mut r = InteractiveReceiver::default();
        let mut out = Vec::new();
        for f in interactive_frames(&[(6, long.clone()), (3, vec![1, 2])]) {
            out.extend(r.accept(&f, 0.0));
        }
        assert_eq!(out, vec![(6, long), (3, vec![1, 2])], "the 255-byte record goes on in the next");
    }

    #[test]
    fn interactive_messages_recover_from_a_lost_frame_and_stale_messages() {
        let mut r = InteractiveReceiver::default();
        let first = interactive_frames(&[(6, vec![7; 60])]);
        assert!(first.len() > 2);
        for (index, f) in first.iter().enumerate() {
            if index != 1 {
                assert!(r.accept(f, 1.0).is_empty());
            }
        }
        let next = interactive_frames(&[(6, vec![9, 9, 9])]);
        let out: Vec<_> = next.iter().flat_map(|f| r.accept(f, 2.0)).collect();
        assert_eq!(out, vec![(6, vec![9, 9, 9])]);
        // A message left half done for over 3 s is dropped before the next starts.
        r.accept(&first[0], 10.0);
        let out: Vec<_> = next.iter().flat_map(|f| r.accept(f, 20.0)).collect();
        assert_eq!(out.len(), 1);
        // A bad checksum is dropped.
        let mut bad = next.clone();
        let last = bad.len() - 1;
        let end = bad[last].len() - 1;
        bad[last][end] ^= 0xff;
        assert!(bad.iter().flat_map(|f| r.accept(f, 21.0)).next().is_none());
    }

    #[test]
    fn engine_data_files() {
        let block = vec![5u8; 300];
        let mut h = vec![0x78, 0, 54];
        h.extend(0u32.to_le_bytes());
        h.extend((block.len() as u16).to_le_bytes());
        h.extend((block.len() as u32).to_le_bytes());
        h.extend(crc16(&block).to_le_bytes());
        h.push(sum(&block));
        h.extend([0, 0, 0, 3]);
        h.push(sum(&h[2..20]));
        assert!(valid_file_block(&h, &block, 54), "settings");
        h[2] = 84;
        h[20] = sum(&h[2..20]);
        assert!(valid_file_block(&h, &block, 84), "gear list");
        h[9..13].copy_from_slice(&65_537u32.to_le_bytes());
        h[20] = sum(&h[2..20]);
        assert!(!valid_file_block(&h, &block, 84), "64 KB at most");
    }
}
