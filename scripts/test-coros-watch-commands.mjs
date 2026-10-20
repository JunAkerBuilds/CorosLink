import assert from "node:assert/strict";
import { encodeSyncTime, nearLocalMidnight, requireWatchAcknowledgement, WATCH_EPOCH } from "../dist-electron/corosWatchCommands.js";
import {
  cutUtf8, decodeTrainingList, encodeProgramLite, encodeTrainingPlan, LOCAL_PLAN_ENTRY_ID, ProtoWriter, encodeTrainingBlockHeader, encodeTrainingDeleteRequest, encodeWatchFile,
  planWindow, WorkoutNotSendableError, workoutSlot
} from "../dist-electron/corosBleTrainingProtocol.js";
import { crc16Ccitt } from "../dist-electron/corosBleRouteProtocol.js";
import {
  accountFromWatchProfile, decodeSettings, decodeWatchProfile, editWatchProfile, encodeSettings, encodeSettingsRequest, encodeWatchProfile, SETTING_USER_INFO
} from "../dist-electron/corosWatchProfile.js";
import { applySettingEdits, decodeExtSwitches, decodeSwitches, EXT_SWITCH_FIELDS, extSwitchFieldsFor, setSwitch, SWITCH_FIELDS, switchFieldsFor } from "../dist-electron/corosWatchSettings.js";
import { applyFwInfoGpsAssistance, decodeBindGpsAssistance, satelliteFilesFor, satelliteFormat } from "../dist-electron/corosWatchGpsAssist.js";
import { EXPERIMENTAL_SYNC_MODELS, SATELLITE_FORMAT_MODELS, WATCH_FEATURE_MODELS, watchSupports, watchTakesSatelliteFormat } from "../dist-electron/localSync/watchSyncModels.js";
import { CEP_FILES, cepFileFor, cepFileIsNewer, encodeCepTransfer, fetchCepFile, fetchCepIndex, parseCepFile, unixMsOfWatchHour, watchHour } from "../dist-electron/corosWatchCep.js";
import { elpoFile, elpoRecords, REPORTS, section, synapticsFile } from "./satellite-fixtures.mjs";
import crypto from "node:crypto";
import { appleWeatherCode, encodeWatchWeather, fetchWatchForecast } from "../dist-electron/corosWatchWeather.js";

// Commands CorosLink sends to the watch, checked against the COROS app's
// encoding. Runs on the compiled modules (npm run build:electron
// first) under several time zones (see package.json).

let passed = 0;
const test = async (name, body) => { try { await body(); passed += 1; } catch (error) { console.error(`✗ ${name}`); throw error; } };

// UTC offset in minutes at 2026-10-19 05:00:00.123Z for the zones the script is run under.
const ZONES = { "Asia/Ho_Chi_Minh": 420, "Asia/Kolkata": 330, "America/St_Johns": -150, "America/New_York": -240, UTC: 0 };

await test("time sync: seconds since 2014, both offset units, format, milliseconds", () => {
  const zone = process.env.TZ ?? "UTC";
  const offset = ZONES[zone];
  assert.notEqual(offset, undefined, `no expectation for ${zone}`);
  const now = new Date(Date.UTC(2026, 9, 19, 5, 0, 0, 123));
  assert.equal(-now.getTimezoneOffset() || 0, offset, "the test runs in the zone it names");
  const payload = encodeSyncTime(now, true);
  assert.equal(payload.length, 9);
  assert.equal(payload.readUInt32LE(0), Math.floor(now.getTime() / 1000) - WATCH_EPOCH);
  assert.equal(payload.readInt8(4), Math.trunc(offset / 30), "30-minute units, truncated like Java");
  assert.equal(payload.readInt8(5), Math.trunc(offset / 15));
  assert.equal(payload[6], 1, "12-hour");
  assert.equal(payload.readUInt16LE(7), 123);
  assert.equal(encodeSyncTime(now, false)[6], 0, "24-hour");
});

await test("time sync waits out the first seconds after midnight", () => {
  assert.equal(nearLocalMidnight(new Date(2026, 9, 19, 0, 0, 9)), true);
  assert.equal(nearLocalMidnight(new Date(2026, 9, 19, 0, 0, 10)), false);
  assert.equal(nearLocalMidnight(new Date(2026, 9, 19, 23, 59, 59)), false);
});

await test("acknowledgements", () => {
  requireWatchAcknowledgement(Buffer.from([1]), "x");
  assert.throws(() => requireWatchAcknowledgement(Buffer.from([0]), "time"), /did not accept the time/);
  assert.throws(() => requireWatchAcknowledgement(Buffer.alloc(0), "time"));
});

// Tiny protobuf reader for the checks below: field number → list of varints, strings or nested buffers.
function fields(buffer) {
  const out = new Map(); let i = 0;
  const varint = () => { let value = 0n, shift = 0n; for (;;) { const byte = buffer[i++]; value |= BigInt(byte & 127) << shift; if (byte < 128) return value; shift += 7n; } };
  while (i < buffer.length) {
    const tag = Number(varint()); const field = tag >> 3;
    const value = (tag & 7) === 0 ? varint() : (() => { const length = Number(varint()); const bytes = buffer.subarray(i, i + length); i += length; return bytes; })();
    out.set(field, [...(out.get(field) ?? []), value]);
  }
  return out;
}

const program = {
  id: "1792390000000000", name: "Intervals 5 × 1 km with a long descriptive name", sportType: 1, subType: 65535, pbVersion: 2,
  estimatedTime: 1650, estimatedDistance: 500000, createTimestamp: 1792390000,
  exercises: [
    { id: 1, name: "Warm-up", targetType: 2, targetValue: 600, restType: 3, sets: 1, exerciseType: 1 },
    { id: 2, name: "Interval Group", targetType: 5, targetValue: 100000, sets: 5, isGroup: true, groupId: "0" },
    { id: 3, name: "T1234", targetType: 5, targetValue: 100000, intensityType: 3, intensityValue: 230000, intensityValueExtend: 240000, groupId: "2", sets: 1 },
    { id: 4, name: "Open", targetType: 7, intensityType: 2, intensityValue: 120, groupId: "0", sets: 1 }
  ]
};

await test("workout: the app's ProgramLite, names split at 39 bytes", () => {
  const lite = fields(encodeProgramLite(program));
  const summary = fields(lite.get(1)[0]);
  assert.equal(summary.get(1)[0], 1792390000000000n);
  const name = summary.get(2)[0].toString();
  assert.equal(Buffer.byteLength(name), 39, "39 bytes, without splitting the ×");
  assert.equal(name + summary.get(20)[0].toString(), program.name);
  assert.equal(summary.get(11)[0], 1234n, "highest built-in name key");
  const steps = lite.get(2).map(fields);
  assert.equal(steps.length, 4, "repeat groups are kept");
  assert.equal(steps[1].get(20)[0], 1n, "is_group");
  assert.equal(steps[2].get(21)[0], 2n, "group_id");
  assert.equal(steps[2].get(9)[0], 230000n);
  assert.equal(steps[3].get(8), undefined, "an open-ended step has no intensity, as the app sends it");
  assert.equal(cutUtf8("a×b", 2), "a");
});

await test("workout: zone or percentage targets need settings this computer may not have", () => {
  const zoned = { ...program, exercises: [{ id: 1, name: "Z2", targetType: 2, targetValue: 600, intensityType: 2, intensityCustom: 2 }] };
  assert.throws(() => encodeProgramLite(zoned), WorkoutNotSendableError);
  assert.throws(() => encodeProgramLite({ ...program, exercises: [] }), /no steps/);
});

await test("workout: HF file, SendFile block header", () => {
  const body = encodeProgramLite(program);
  const file = encodeWatchFile(body, 41, program.createTimestamp);
  assert.equal(file.subarray(0, 2).toString(), "HF");
  assert.deepEqual([file[2], file[3], file.readUInt32LE(4), file.readUInt32LE(8)], [0, 41, program.createTimestamp - WATCH_EPOCH, body.length]);
  assert.equal(file.readUInt16LE(12), crc16Ccitt(body));
  assert.equal(file.readUInt16LE(14), crc16Ccitt(file.subarray(0, 14)));
  const header = encodeTrainingBlockHeader(41, file, 0, file.length, 3);
  assert.deepEqual([...header.subarray(0, 3)], [0x78, 0, 41]);
  assert.deepEqual([header.readUInt32LE(3), header.readUInt16LE(7), header.readUInt32LE(9)], [0, file.length, file.length]);
  assert.deepEqual([...header.subarray(16, 20)], [3, 0, 0, 3], "slot, then the constant 3");
  assert.equal(header[20], header.subarray(2, 20).reduce((sum, byte) => (sum + byte) & 255, 0));
  assert.throws(() => encodeTrainingBlockHeader(20, file, 0, file.length, 0), /Invalid/);
});

await test("workout list: parse, reuse a workout's slot, else the lowest free one", () => {
  const reply = Buffer.alloc(9 + 20 + 2);
  reply[0] = 1; reply[1] = 0; reply[2] = 0; reply.writeUInt32LE(4080, 3); reply[7] = 3; reply[8] = 2;
  reply.writeBigInt64LE(111n, 9); reply[17] = 0; reply[18] = 1;
  reply.writeBigInt64LE(222n, 19); reply[27] = 2; reply[28] = 4;
  const list = decodeTrainingList(reply);
  assert.deepEqual(list, { kind: 0, maxBytes: 4080, maxCount: 3, entries: [{ id: "111", slot: 0, version: 1 }, { id: "222", slot: 2, version: 4 }] });
  assert.equal(workoutSlot(list, "222"), 2);
  assert.equal(workoutSlot(list, "333"), 1);
  assert.throws(() => workoutSlot({ ...list, entries: [...list.entries, { id: "444", slot: 1, version: 1 }] }, "555"), /already holds 3 workouts/);
  assert.throws(() => decodeTrainingList(Buffer.from([0])), /did not return/);
  const remove = encodeTrainingDeleteRequest(0, [{ id: "222", slot: 2 }]);
  assert.deepEqual([remove[0], remove[1], remove.readBigInt64LE(2), remove[10]], [0, 1, 222n, 2]);
});

await test("training calendar: Monday-based window, records, then each workout as file 41", () => {
  const now = new Date(2026, 9, 21, 9, 0); // a Wednesday
  assert.deepEqual(planWindow(now), { startDay: "20261019", endDay: "20261122" });
  assert.deepEqual(planWindow(new Date(2026, 9, 25, 23, 0)), { startDay: "20261019", endDay: "20261122" }, "Sunday belongs to the week that began on Monday");
  const run = { ...program, id: "77", version: 3 };
  const zoned = { ...program, id: "78", exercises: [{ id: 1, name: "Z2", targetType: 2, targetValue: 600, intensityType: 2, intensityCustom: 2 }] };
  const { file, workouts, skipped, contentHash } = encodeTrainingPlan([
    { idInPlan: 5, happenDay: "20261023", program: run },
    { idInPlan: 6, happenDay: "20261018", program: run }, // before the window
    { idInPlan: 7, happenDay: "20261024", program: zoned }, // the watch can't take zone targets
    { idInPlan: 8, happenDay: "20261122", program: { ...run, exercises: [{ id: 1, exerciseType: 1, targetType: 2, targetValue: 300 }] } }
  ], now);
  assert.equal(workouts, 2);
  assert.deepEqual(skipped, { zoneTargets: 1 }, "a workout outside the window isn't counted as left off");
  const version = BigInt((Number.parseInt(contentHash.slice(0, 8), 16) >>> 1) || 1);
  assert.deepEqual([file.subarray(0, 2).toString(), file[3]], ["HF", 42]);
  const recordsLength = file.readUInt32LE(8);
  const records = []; let i = 16;
  while (i < 16 + recordsLength) { assert.equal(file[i], 2); records.push(fields(file.subarray(i + 2, i + 2 + file[i + 1]))); i += 2 + file[i + 1]; }
  const summary = records[0];
  assert.deepEqual([summary.get(1)[0], summary.get(3)[0], summary.get(4)[0], summary.get(5)[0], summary.get(6)[0], summary.get(8)[0]], [1n, 35n, 20261019n, version, 1n, 20261122n]);
  assert.deepEqual(records.slice(1).map((record) => [record.get(1)?.[0] ?? 0n, record.get(2)[0], record.get(4)[0], record.get(5)[0], record.get(10)[0]]),
    [[0n, 5n, 1n, 4n, 5n], [0n, 8n, 1n, 34n, 8n]], "type 0 (the only type the firmware matches to workouts), idInPlan, add, day number from Monday, planProgramId");
  // Each workout follows as its own file 41, carrying its calendar id.
  const workoutsStart = 16 + recordsLength;
  assert.deepEqual([file.subarray(workoutsStart, workoutsStart + 2).toString(), file[workoutsStart + 3]], ["HF", 41]);
  const first = fields(file.subarray(workoutsStart + 16, workoutsStart + 16 + file.readUInt32LE(workoutsStart + 8)));
  assert.equal(fields(first.get(1)[0]).get(12)[0], 5n, "id_in_plan");
  const secondStart = workoutsStart + 16 + file.readUInt32LE(workoutsStart + 8);
  const second = fields(file.subarray(secondStart + 16, secondStart + 16 + file.readUInt32LE(secondStart + 8)));
  assert.equal(fields(second.get(2)[0]).get(3)[0].toString(), "Warm-up", "an unnamed step gets its type's name");
  assert.equal(secondStart + 16 + file.readUInt32LE(secondStart + 8), file.length);
});

await test("weather: Open-Meteo forecast → the app's WeatherForecastUI in file 80", async () => {
  assert.deepEqual([0, 1, 2, 3, 45, 61, 65, 71, 95, 999].map(appleWeatherCode), [0, 5, 7, 1, 3, 14, 13, 25, 37, 255]);
  const hour0 = 1_792_400_400; // 2026-10-19 03:00:00 UTC, the hour under way
  const now = hour0 + 2700;
  const series = (count, value) => Array.from({ length: count }, (_, index) => value(index));
  const hours = 100, times = series(hours + 1, (index) => hour0 + (index - 1) * 3600);
  const forecastJson = (overrides = {}) => ({
    utc_offset_seconds: 25_200,
    current: { time: now, temperature_2m: -2.44, apparent_temperature: -6.06, relative_humidity_2m: 81, weather_code: 3, wind_speed_10m: 12.46,
      wind_direction_10m: 200, uv_index: 3.6, precipitation_probability: null },
    hourly: {
      time: times, temperature_2m: series(hours + 1, (index) => index === 1 ? -2.4 : 10 + index / 10), apparent_temperature: series(hours + 1, (index) => index === 1 ? -6 : 9),
      relative_humidity_2m: series(hours + 1, (index) => index === 1 ? 80 : 55.5), precipitation_probability: series(hours + 1, (index) => index === 1 ? 35 : 100),
      weather_code: series(hours + 1, (index) => index === 1 ? 3 : 61), wind_speed_10m: series(hours + 1, () => 20), wind_direction_10m: series(hours + 1, (index) => index === 1 ? 350 : 22.5),
      uv_index: series(hours + 1, (index) => index === 1 ? 4.4 : 11.6)
    },
    daily: { time: series(14, (index) => hour0 - 36_000 + index * 86_400), weather_code: series(14, (index) => index ? 61 : 3),
      temperature_2m_max: series(14, (index) => index ? 4 : 1.55), temperature_2m_min: series(14, (index) => index ? -1 : -5), precipitation_probability_max: series(14, (index) => index ? 80 : 35) },
    ...overrides
  });
  const airJson = { current: { time: hour0, us_aqi: 57 }, hourly: { time: times.slice(0, 60), us_aqi: series(60, (index) => index === 1 ? 51 : 42) } };
  const requests = [];
  const stub = (respond = {}) => async (url) => {
    const asked = new URL(url);
    requests.push(asked);
    assert.match(asked.hostname, /^(api|air-quality-api)\.open-meteo\.com$/, "no COROS service");
    if (asked.hostname === "air-quality-api.open-meteo.com") {
      if (respond.air === "fail") throw new Error("offline");
      return respond.air === 500 ? { ok: false, status: 500 } : { ok: true, json: async () => airJson };
    }
    return { ok: true, json: async () => respond.forecast ?? forecastJson() };
  };
  const forecast = await fetchWatchForecast(10.7769, 106.7009, stub());
  const asked = requests.find((url) => url.hostname === "api.open-meteo.com");
  for (const part of ["current", "hourly"]) {
    assert.deepEqual(asked.searchParams.get(part).split(",").sort(), ["apparent_temperature", "precipitation_probability", "relative_humidity_2m", "temperature_2m",
      "uv_index", "weather_code", "wind_direction_10m", "wind_speed_10m"], `${part} variables`);
  }
  assert.deepEqual(asked.searchParams.get("daily").split(",").sort(), ["precipitation_probability_max", "temperature_2m_max", "temperature_2m_min", "weather_code"]);
  assert.deepEqual(requests.find((url) => url.hostname === "air-quality-api.open-meteo.com").searchParams.get("hourly"), "us_aqi");
  assert.equal(forecast.hourly[0].time, hour0, "from the hour under way: the watch shows it as now");
  assert.equal(forecast.hourly.length, 96, "as many hours as the watch keeps");
  assert.equal(forecast.daily.length, 14);
  assert.equal(forecast.current.precipitationProbability, 35, "a value Open-Meteo has no current reading for comes from the hour under way");
  assert.deepEqual(forecast.hourly[0], { ...forecast.current, time: hour0 }, "the hour under way carries the current readings");

  const file = encodeWatchWeather(forecast, "Ho Chi Minh City", new Date(now * 1000));
  assert.deepEqual([file.subarray(0, 2).toString(), file[3]], ["HF", 80]);
  assert.ok(file.length <= 4096, `one transfer block (${file.length} bytes)`);
  const ui = fields(file.subarray(16));
  const signed = (value) => BigInt.asIntN(64, value);
  const entry = (bytes) => { const map = fields(bytes); return Object.fromEntries([...map].map(([field, [value]]) => [field, typeof value === "bigint" ? signed(value) : value])); };
  const current = entry(ui.get(1)[0]);
  // Units the PACE 4 reads (see corosWatchWeather.ts): tenths of °C, tenths of %, %, tenths of km/h, sector 0–7, whole UV index, US AQI, Unix seconds.
  assert.deepEqual(current, { 2: 1n, 3: -24n, 4: -61n, 5: 810n, 6: 4n, 8: 125n, 11: 35n, 12: 4n, 13: 57n, 14: BigInt(now) },
    "current: cloudy, -2.4 °C, feels -6.1 °C, 81 %, wind from the south at 12.5 km/h, 35 % rain, UV 4, AQI 57");
  const hourly = ui.get(2).map(entry);
  assert.equal(hourly.length, 96);
  assert.deepEqual(hourly[0], { ...current, 14: BigInt(hour0) }, "the hour the watch shows as now: every field, at the start of the hour");
  assert.equal(entry(ui.get(2)[2])[6], 1n, "22.5° rounds to north-east");
  assert.deepEqual(hourly[1], { 2: 14n, 3: 102n, 4: 90n, 5: 555n, 6: 1n, 8: 200n, 11: 100n, 12: 12n, 13: 42n, 14: BigInt(hour0 + 3600) }, "rain, 10.2 °C, 55.5 %, NE, UV 12");
  assert.equal(hourly[60][13], 0xffffn, "an hour without air quality hides the AQI (-1 on the watch)");
  for (const hour of hourly) assert.deepEqual([1, 7, 9, 10].filter((field) => field in hour), [], "fields the watch drops are not sent");
  const daily = ui.get(3).map(entry);
  assert.equal(daily.length, 14);
  // The place (UTC+7) starts 2026-10-19 at hour0 - 10 h. The watch names a day in its own zone, this computer's.
  const watchMidnight = (y, m, d) => Date.UTC(y, m, d) / 1000 - Math.trunc(-new Date(now * 1000).getTimezoneOffset() / 15) * 900;
  assert.equal(forecast.daily[0].date, "2026-10-19");
  assert.deepEqual(daily[0], { 2: 1n, 9: -50n, 10: 16n, 11: 35n, 14: BigInt(watchMidnight(2026, 9, 19) + 3600) },
    "day: conditions, low/high in tenths of °C, chance of rain; the watch's midnight + 1 h, which its day list takes an hour off");
  assert.deepEqual(daily[1], { 2: 14n, 9: -10n, 10: 40n, 11: 80n, 14: BigInt(watchMidnight(2026, 9, 20) + 3600) });
  assert.deepEqual([ui.get(4)[0], ui.get(5)[0], ui.get(6)[0]], [3n, 3n, BigInt(now)], "provider, AQI provider (shows the AQI), sent at");
  assert.equal(ui.has(7), false, "no time zone: the watch doesn't read it");
  const unzig = (value) => (value >> 1n) ^ -(value & 1n);
  assert.equal(unzig(ui.get(8)[0]), 107_769_000n, "latitude × 10⁷ (sint32)");
  assert.equal(unzig(ui.get(9)[0]), 1_067_009_000n);
  assert.equal(ui.get(10)[0].toString(), "Ho Chi Minh City");
  assert.equal(ui.get(1)[0][0], 0x10, "starts with current (field 1), not a struct-per-entry header");

  // Air quality is optional: without it the forecast goes without AQI.
  for (const air of ["fail", 500]) {
    const plain = await fetchWatchForecast(10.7769, 106.7009, stub({ air }));
    assert.equal(plain.airQuality, false);
    const plainUi = fields(encodeWatchWeather(plain, "", new Date(now * 1000)).subarray(16));
    assert.equal(plainUi.has(5), false, "no AQI provider");
    assert.equal([...plainUi.get(2), ...plainUi.get(1)].some((bytes) => fields(bytes).has(13)), false, "no AQI");
  }
  // Days below freezing, where every temperature takes 10 bytes: all 96 hours still fit one block, the far ones without "feels like".
  const cold = forecastJson();
  Object.assign(cold.hourly, { temperature_2m: series(hours + 1, () => -12.3), apparent_temperature: series(hours + 1, () => -20.7) });
  const coldAir = { ...airJson, hourly: { time: times, us_aqi: series(hours + 1, () => 42) } };
  const coldStub = (forecastBody) => async (url) => ({ ok: true, json: async () => new URL(url).hostname.startsWith("air") ? coldAir : forecastBody });
  const frozen = await fetchWatchForecast(10.7769, 106.7009, coldStub(cold));
  const frozenFile = encodeWatchWeather(frozen, "Ho Chi Minh City", new Date(now * 1000));
  const frozenHours = fields(frozenFile.subarray(16)).get(2).map(entry);
  assert.ok(frozenFile.length <= 4096, `${frozenFile.length} bytes`);
  assert.equal(frozenHours.length, 96);
  assert.equal(frozenHours[1][4], -207n, "the next hours keep it");
  assert.equal(frozenHours[95][4], undefined);
  assert.equal(frozenHours[95][3], -123n);
  // A whole week below freezing: the furthest hours go rather than the file growing past one block.
  Object.assign(cold.daily, { temperature_2m_max: series(14, () => -3), temperature_2m_min: series(14, () => -15) });
  const trimmed = encodeWatchWeather(await fetchWatchForecast(10.7769, 106.7009, coldStub(cold)), "Ho Chi Minh City", new Date(now * 1000));
  const trimmedHours = fields(trimmed.subarray(16)).get(2).length;
  assert.ok(trimmed.length <= 4096 && trimmedHours >= 84 && trimmedHours <= 96, `${trimmedHours} hours in ${trimmed.length} bytes`);
  await assert.rejects(fetchWatchForecast(91, 0, stub()), /Invalid location/);
});

await test("weather: each day keeps its name on the watch, whatever the place's zone or a daylight-saving change", async () => {
  // The firmware's day list: obs_timestamp - 1 h, named in the watch's zone, which is the offset the clock message
  // set (encodeSyncTime, 15-minute units) and stays until the next clock sync, also across a DST change.
  const offsetSeconds = (zone, ms) => {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(new Date(ms)).find((part) => part.type === "timeZoneName").value;
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60) : 0;
  };
  const placeMidnight = (zone, date) => {
    let guess = Date.parse(`${date}T00:00:00Z`);
    for (let i = 0; i < 3; i++) guess = Date.parse(`${date}T00:00:00Z`) - offsetSeconds(zone, guess) * 1000;
    return guess / 1000;
  };
  const dates = (first) => Array.from({ length: 14 }, (_, index) => new Date(Date.parse(`${first}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
  let checked = 0;
  // Places ahead of and behind every zone the script runs under; windows across European, North American and New Zealand changes.
  for (const zone of ["Pacific/Auckland", "Europe/Paris", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    for (const nowIso of ["2026-03-22T09:30:00Z", "2026-10-25T20:15:00Z", "2026-03-30T12:00:00Z", "2026-07-01T02:00:00Z"]) {
      const nowMs = Date.parse(nowIso);
      const now = new Date(nowMs);
      const first = new Date(nowMs + offsetSeconds(zone, nowMs) * 1000).toISOString().slice(0, 10);
      const days = dates(first);
      const json = {
        utc_offset_seconds: offsetSeconds(zone, nowMs), timezone: zone,
        current: { time: Math.floor(nowMs / 1000), temperature_2m: 12 },
        hourly: { time: [Math.floor(nowMs / 3_600_000) * 3600], temperature_2m: [12] },
        daily: { time: days.map((date) => placeMidnight(zone, date)), weather_code: days.map(() => 3), temperature_2m_max: days.map(() => 14), temperature_2m_min: days.map(() => 4) }
      };
      const forecast = await fetchWatchForecast(1, 1, async (url) => ({ ok: true, json: async () => (new URL(url).hostname.startsWith("air") ? {} : json) }));
      assert.deepEqual(forecast.daily.map((day) => day.date), days, `${zone} at ${nowIso}: the place's dates`);
      const clock = encodeSyncTime(now, false);
      const watchOffset = clock.readInt8(5) * 900;
      const ui = fields(encodeWatchWeather(forecast, "", now).subarray(16));
      const named = ui.get(3).map((bytes) => new Date((Number(fields(bytes).get(14)[0]) - 3600 + watchOffset) * 1000).toISOString().slice(0, 10));
      assert.deepEqual(named, days, `${zone} at ${nowIso} under ${process.env.TZ}: every day named as at the place`);
      checked += 1;
    }
  }
  assert.equal(checked, 24);
});

await test("training profile: the watch's UserInfo, edited and written back packed", () => {
  // Built the way the watch sends it: repeated values one by one, with fields CorosLink keeps untouched.
  const varint = (value) => { const out = []; let v = BigInt.asUintN(64, BigInt(value)); do { out.push(Number(v & 0x7fn) | (v > 0x7fn ? 0x80 : 0)); v >>= 7n; } while (v); return out; };
  const int = (field, value) => [...varint(field << 3), ...varint(value)];
  const text = (field, value) => [...varint((field << 3) | 2), value.length, ...Buffer.from(value)];
  const each = (field, values) => values.flatMap((value) => int(field, value));
  const watch = Buffer.from([
    ...each(1, [100, 120, 140, 160, 180]), ...each(2, [130, 150, 165, 175, 185]), ...each(3, [130, 145, 155, 165, 172]),
    ...each(4, [360000, 320000, 300000, 280000, 260000, 240000]), ...each(5, [150, 200, 250, 300, 350]),
    ...int(6, 12345), ...text(7, "Runner"),
    ...int(9, 200), ...int(10, 50), ...int(11, 170), ...int(12, 3), ...int(13, 280000), ...int(14, 300), ...int(15, 250),
    ...each(16, [100, 140, 180, 210, 240, 280]), ...text(17, "V4")
  ]);
  const profile = decodeWatchProfile(watch);
  assert.deepEqual([profile.maxHr, profile.restingHr, profile.thresholdHr, profile.hrZoneType, profile.thresholdPace, profile.criticalPower, profile.ftp], [200, 50, 170, 3, 280000, 300, 250]);
  assert.deepEqual(profile.thresholdHrZones, [130, 145, 155, 165, 172]);
  assert.deepEqual(profile.passthrough.map((item) => item.field), [6, 7, 17]);
  const written = encodeWatchProfile(profile);
  assert.ok(written.length < watch.length, "lists go back packed");
  assert.deepEqual(decodeWatchProfile(written), { ...profile, passthrough: profile.passthrough }, "a round trip keeps every value");
  assert.ok(written.includes(Buffer.from("Runner")) && written.includes(Buffer.from("V4")), "untouched fields go back as they came");

  const edited = editWatchProfile(profile, { maxHr: 190, restingHr: 60, thresholdHr: 175, thresholdPace: 266000, hrZoneType: 1 });
  assert.deepEqual(edited.maxHrZones, [95, 114, 133, 152, 171], "% of max HR keeps its percentages");
  assert.deepEqual(edited.thresholdHrZones, [134, 149, 160, 170, 177], "% of threshold HR");
  assert.equal(edited.reserveHrZones[0], Math.round(60 + (130 - 50) * 130 / 150), "heart-rate reserve keeps its fraction");
  assert.equal(edited.paceZones[3], 266000, "the threshold pace zone follows the threshold");
  assert.deepEqual(edited.runPowerZones, profile.runPowerZones, "zones without a new reference stay");
  assert.equal(edited.hrZoneType, 1);
  assert.throws(() => editWatchProfile(profile, { maxHr: 160 }), /increase in that order/);
  assert.throws(() => editWatchProfile(profile, { restingHr: 10 }), /between 25 and 120/);
  assert.throws(() => editWatchProfile(profile, { thresholdPace: 4.5 }), /Threshold pace/);

  const account = accountFromWatchProfile(edited);
  assert.deepEqual([account.maxHr, account.restingHr, account.lthr, account.thresholdPace], [190, 60, 175, 266000]);
  assert.deepEqual(account.lthrZone[0], { index: 1, hr: 134 });

  const long = Buffer.alloc(300, 7);
  const settings = encodeSettings([[SETTING_USER_INFO, long], [1, Buffer.from([2])]]);
  assert.deepEqual([settings[0], settings[1], settings[257], settings[258]], [10, 255, 10, 45], "values over 255 bytes split into entries of the same type");
  const decoded = decodeSettings(settings);
  assert.deepEqual([decoded.get(SETTING_USER_INFO).equals(long), [...decoded.get(1)]], [true, [2]]);
  assert.throws(() => decodeSettings(Buffer.from([10, 5, 1])), /truncated/);
  assert.deepEqual([...encodeSettingsRequest([SETTING_USER_INFO])], [0, 10], "asked for with the switches, as the app does");
});

await test("satellite data: chip and expiry from the bind reply", () => {
  const reply = (version, word) => { const bytes = Buffer.alloc(17); bytes[0] = (version << 4) | 1; bytes.writeUInt32LE(word >>> 0, 11); return bytes; };
  const midnight = Date.UTC(2026, 9, 19) / 1000;
  const gpsHour = Math.round((midnight - (315_964_800 - 18)) / 3600);
  const sonyHour = Math.round((midnight - WATCH_EPOCH) / 3600);
  const lto = decodeBindGpsAssistance(reply(4, sonyHour | (1 << 24) | (3 << 27)));
  assert.deepEqual([lto.format, lto.bindVersion, lto.durationHours, lto.startHour, lto.source], ["synaptics-lto", 4, 144, sonyHour, "bind"], "v4: 24-bit hour, 3-bit type, 5-bit chip");
  assert.equal(lto.validUntil, (midnight + 144 * 3600) * 1000, "all-systems data counts from the watch's 2014 epoch");
  const gpsOnly = decodeBindGpsAssistance(reply(4, gpsHour));
  assert.ok(Math.abs(gpsOnly.validUntil - (midnight + 144 * 3600) * 1000) < 3_600_000, "GPS-only data: GPS hours from 1980");
  assert.equal(decodeBindGpsAssistance(reply(4, sonyHour | (3 << 27))).format, "unknown", "LTO is always all-systems data");
  const sony = decodeBindGpsAssistance(reply(4, sonyHour | (1 << 27)));
  assert.equal(sony.validUntil, (midnight + 144 * 3600) * 1000, "Sony data counts from the watch's 2014 epoch");
  const v3 = decodeBindGpsAssistance(reply(3, gpsHour | (24 << 24)));
  assert.deepEqual([v3.format, v3.durationHours], ["mtk-epo", 144], "v3: 6-bit count of 6-hour blocks");
  assert.equal(decodeBindGpsAssistance(reply(4, 0)).validUntil, undefined, "nothing loaded");
  assert.throws(() => decodeBindGpsAssistance(Buffer.alloc(4)), /length/);
});

await test("satellite data: EPO receivers get nothing", () => {
  const reply = (version, word) => { const bytes = Buffer.alloc(17); bytes[0] = (version << 4) | 1; bytes.writeUInt32LE(word >>> 0, 11); return bytes; };
  const hour = Math.floor((Date.UTC(2026, 9, 19) / 1000 - (315_964_800 - 18)) / 3600);
  // What the 3.2008.0 firmware of all five models sends in the bind reply: version 3, 24 blocks, the type bit set, chip bit 0.
  const firmware = decodeBindGpsAssistance(reply(3, hour | (24 << 24) | (1 << 30)));
  assert.deepEqual([firmware.bindVersion, firmware.epoType, firmware.chipType, firmware.durationHours], [3, 1, 0, 144]);
  assert.equal(firmware.format, "airoha-epo", "chip 0 with all systems is the app's EPO_GR");
  // A reply asking for GPS-only data names MediaTek EPO; no model's firmware was found to take either.
  const gpsOnly = decodeBindGpsAssistance(reply(3, hour | (24 << 24)));
  assert.equal(gpsOnly.format, "mtk-epo");
  for (const model of ["pace-4", "pace-4-pro", "pace-pro", "apex-4", "pace-3", undefined]) {
    assert.deepEqual(satelliteFilesFor(firmware, model), [], `${model}: no EPO_GR`);
    assert.deepEqual(satelliteFilesFor(gpsOnly, model), [], `${model}: no GPS-only EPO`);
  }
});

await test("watch features: what CorosLink writes, by model", () => {
  const checked = ["pace-4", "pace-4-pro", "pace-pro", "apex-4", "pace-3"];
  for (const feature of ["settings", "profile", "clockFormat", "weather", "workouts", "calendar"]) {
    assert.deepEqual([...WATCH_FEATURE_MODELS[feature]].sort(), [...checked].sort(), feature);
    for (const model of checked) assert.equal(watchSupports(feature, model), true, `${feature} on ${model}`);
    for (const model of ["pace-2", "nomad", "vertix-2", "vertix-2s", "apex-2"]) assert.equal(watchSupports(feature, model), false, `${feature} not on ${model}`);
    assert.equal(watchSupports(feature, undefined), false);
  }
  // Satellite data: every checked model takes some format; each format only on the models checked for it.
  assert.deepEqual([...WATCH_FEATURE_MODELS.satelliteData].sort(), [...checked].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(SATELLITE_FORMAT_MODELS).map(([format, models]) => [format, [...models].sort()])), {
    elpo: ["pace-3", "pace-4", "pace-4-pro"], "elpo-ahead": ["pace-3"],
    "synaptics-lto": ["apex-4", "pace-4", "pace-pro"], "synaptics-rto": ["apex-4", "pace-4", "pace-pro"]
  });
  for (const model of ["pace-2", "nomad", "vertix-2", "apex-2", undefined]) {
    assert.equal(watchSupports("satelliteData", model), false, `no satellite data for ${model}`);
    for (const format of Object.keys(SATELLITE_FORMAT_MODELS)) assert.equal(watchTakesSatelliteFormat(format, model), false);
  }
  assert.deepEqual([...EXPERIMENTAL_SYNC_MODELS].sort(), [...checked].sort(), "sync: the same five");
});

await test("system switches: firmware layout, one field changes, the rest stay", () => {
  // A PACE 4's main word as read on connecting (12-hour time and left wrist confirmed on the watch).
  const raw = 0x0e2d2085;
  const values = decodeSwitches(raw);
  assert.deepEqual([values.backlight, values.wristGesture, values.timeFormat, values.units, values.wrist, values.doNotDisturb, values.raiseToWake, values.screenRotation, values.barometerRange],
    [1, 1, 1, 0, 0, 0, 1, 0, 3]);
  assert.equal(setSwitch(raw, "notificationsInActivity", 1), (raw | 0x40000000) >>> 0);
  assert.equal(setSwitch(raw, "notificationsInActivity", 3), (raw | 0xc0000000) >>> 0, "bits 30-31 are one field");
  assert.equal(setSwitch(raw, "raiseToWake", 2), (raw & ~0x600000 | 0x400000) >>> 0, "a 2-bit field");
  assert.equal(setSwitch(setSwitch(raw, "notificationsInActivity", 2), "notificationsInActivity", 0), raw, "bit 31 round-trips");
  assert.throws(() => setSwitch(raw, "raiseToWake", 4), /Invalid/);

  // Extended switches: the firmware's positions (one above the app's struct in the first word).
  const ext = Buffer.alloc(8);
  ext.writeUInt32LE(((1 << 12) | (1 << 13) | (3 << 5) | (1 << 30)) >>> 0, 0);
  ext.writeUInt32LE(((1 << 9) | (2 << 22) | (1 << 20) | (1 << 28) | (1 << 18) | 1) >>> 0, 4);
  const extValues = decodeExtSwitches(ext);
  assert.deepEqual([extValues.dailyHeartRate, extValues.wristHeartRateOff, extValues.cycleReminderDays, extValues.hrvStressOff, extValues.temperatureUnit, extValues.alwaysOnDaily, extValues.raiseToWakeActivity, extValues.brightness],
    [1, 1, 3, 1, 2, 1, 1, 1]);
  assert.equal(extValues.touchscreen, 5, "touchscreen mode spans both words (bits 30-33)");
  assert.throws(() => decodeExtSwitches(Buffer.alloc(4)), /too short/);

  // Edits: only the listed values of editable settings; the rest of both records is kept.
  const longExt = Buffer.concat([ext, Buffer.from([0xaa, 0xbb])]);
  const edited = applySettingEdits(raw, longExt, { raiseToWake: 2, alwaysOnDaily: 0, brightness: 2 });
  assert.equal(decodeSwitches(edited.word).raiseToWake, 2);
  assert.equal(edited.word & ~0x600000, raw & ~0x600000, "other main fields unchanged");
  assert.deepEqual([decodeExtSwitches(edited.ext).alwaysOnDaily, decodeExtSwitches(edited.ext).brightness, decodeExtSwitches(edited.ext).dailyHeartRate], [0, 2, 1]);
  assert.deepEqual([...edited.ext.subarray(8)], [0xaa, 0xbb], "bytes past the known fields go back as they came");
  assert.equal(edited.extChanged, true);
  assert.equal(applySettingEdits(raw, longExt, { units: 1 }).extChanged, false, "the extended record isn't written for main-word edits");
  assert.throws(() => applySettingEdits(raw, longExt, { wristHeartRateOff: 1 }), /can't make this change/, "sensor settings stay on the watch");
  assert.throws(() => applySettingEdits(raw, longExt, { raiseToWake: 3 }), /can't make this change/, "only listed values");
  assert.throws(() => applySettingEdits(raw, undefined, { brightness: 1 }), /read all its settings/);
});

await test("system switches: per-model fields (memory-in-pixel APEX 4 and PACE 3)", () => {
  const raw = 0x0e2d2085;
  const ext = Buffer.alloc(8);
  // Touchscreen 4 (bits 30-33), Night Mode on (bit 28), brightness High (50), always-on daily on (52), °F (54).
  ext.writeUInt32LE(((1 << 28) | (1 << 12)) >>> 0, 0);
  ext.writeUInt32LE((1 | (1 << 18) | (1 << 20) | (1 << 22)) >>> 0, 4);
  // The PACE 4 table is unchanged, and is what an unknown model gets.
  for (const model of [undefined, "pace-4", "pace-4-pro", "pace-pro"]) {
    assert.equal(switchFieldsFor(model), SWITCH_FIELDS, `${model}: the PACE 4 main table`);
    assert.equal(extSwitchFieldsFor(model), EXT_SWITCH_FIELDS, `${model}: the PACE 4 extended table`);
  }
  const pace4 = decodeExtSwitches(ext, "pace-4");
  assert.deepEqual([pace4.brightness, pace4.alwaysOnDaily, pace4.touchscreen, "nightMode" in pace4], [1, 1, 4, false], "PACE 4: no Night Mode field; bit 28 stays a raw bit");
  for (const model of ["apex-4", "pace-3"]) {
    const keys = extSwitchFieldsFor(model).map(field => field.key);
    for (const gone of ["brightness", "alwaysOnDaily", "alwaysOnActivity", "raiseToWakeActivity"]) {
      assert.equal(keys.includes(gone), false, `${model}: no ${gone}`);
      assert.throws(() => applySettingEdits(raw, ext, { [gone]: gone === "raiseToWakeActivity" ? 1 : 0 }, model), /can't make this change/, `${model}: ${gone} not written`);
    }
    const values = decodeExtSwitches(ext, model);
    assert.deepEqual([values.nightMode, values.touchscreen, values.temperatureUnit, "brightness" in values], [1, 4, 1, false], model);
    const night = extSwitchFieldsFor(model).find(field => field.key === "nightMode");
    assert.deepEqual([night.bit, night.width, night.status, night.edit], [28, 1, "confirmed", undefined], `${model}: Night Mode display only`);
    assert.throws(() => applySettingEdits(raw, ext, { nightMode: 0 }, model), /can't make this change/);
    assert.deepEqual(keys, [...keys].sort((a, b) => extSwitchFieldsFor(model).find(f => f.key === a).bit - extSwitchFieldsFor(model).find(f => f.key === b).bit), "bit order");
    // Everything else edits as on a PACE 4.
    const edited = applySettingEdits(raw, ext, { pressureUnit: 1, timeFormat: 0 }, model);
    assert.deepEqual([decodeExtSwitches(edited.ext, model).pressureUnit, decodeExtSwitches(edited.ext, model).temperatureUnit, decodeSwitches(edited.word).timeFormat], [1, 1, 0]);
    assert.throws(() => applySettingEdits(raw, ext, { temperatureUnit: 0 }, model), /can't make this change/, "temperature unit is read only");
    assert.equal(decodeExtSwitches(edited.ext, model).nightMode, 1, "Night Mode kept");
  }
  // Touchscreen names: the PACE 3's control centre differs from the PACE 4's and APEX 4's.
  const touch = (model) => extSwitchFieldsFor(model).find(field => field.key === "touchscreen").values;
  assert.deepEqual([touch("pace-3")[4], touch("pace-3")[5], touch("pace-3")[0]], ["Navigation & activity screens", "Always on", "Navigation only"]);
  assert.deepEqual(touch("apex-4"), touch("pace-4"));
  // The PACE 3 reads main bit 19 (follow the phone's time); elsewhere nothing does.
  const fromPhone = (model) => switchFieldsFor(model).find(field => field.key === "timeFromPhone");
  assert.deepEqual([fromPhone("pace-3").status, fromPhone("pace-3").values[1], fromPhone("pace-3").edit], ["likely", "Follows the phone", undefined]);
  assert.equal(fromPhone("apex-4").status, "unused");
});

await test("protobuf integers: out-of-range or non-finite values are refused, never looped on", () => {
  // -1e20 must not loop forever (a negative BigInt shifted right never reaches 0).
  for (const value of [-1e20, 1e20, -(2n ** 63n) - 1n, 2n ** 64n, NaN, Infinity, -Infinity]) {
    assert.throws(() => new ProtoWriter().int(1, value), WorkoutNotSendableError, String(value));
  }
  assert.throws(() => new ProtoWriter().packed(1, [1, -1e20]), WorkoutNotSendableError);
  assert.throws(() => new ProtoWriter().sint(1, 2 ** 63), WorkoutNotSendableError);
  assert.equal(new ProtoWriter().int(1, -(2n ** 63n)).toBuffer().toString("hex"), "0880808080808080808001", "int64 minimum");
  assert.equal(new ProtoWriter().int(1, 2n ** 64n - 1n).toBuffer().toString("hex"), "08ffffffffffffffffff01", "uint64 maximum");
  assert.equal(new ProtoWriter().int(1, -1).toBuffer().toString("hex"), "08ffffffffffffffffff01", "negative int as 64-bit two's complement");
  const started = Date.now();
  assert.throws(() => encodeProgramLite({ ...program, exercises: [{ ...program.exercises[0], targetValue: -1e20 }] }), WorkoutNotSendableError);
  assert.throws(() => encodeProgramLite({ ...program, exercises: [{ ...program.exercises[0], targetValue: 2 ** 60 }] }), /can't take/);
  assert.ok(Date.now() - started < 1000);
  // The calendar leaves such a workout off rather than hanging.
  const now = new Date(2026, 9, 21, 9, 0);
  const { workouts, skipped } = encodeTrainingPlan([{ idInPlan: 5, happenDay: "20261023", program: { ...program, exercises: [{ ...program.exercises[0], targetValue: -1e20 }] } }], now);
  assert.deepEqual([workouts, skipped], [0, { invalid: 1 }]);
});

/** YYYYMMDD of the calendar window's day `offset` (the window of 2026-10-21 starts on Monday 2026-10-19). */
const planDay = (offset) => { const date = new Date(2026, 9, 19 + offset); return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`; };

await test("training calendar: workouts left off the watch are counted by reason", () => {
  const now = new Date(2026, 9, 21, 9, 0);
  const run = { ...program, id: "77" };
  const zoned = { ...program, id: "78", exercises: [{ id: 1, name: "Z2", targetType: 2, targetValue: 600, intensityType: 2, intensityCustom: 2 }] };
  const long = { ...program, id: "79", exercises: Array.from({ length: 400 }, (_, index) => ({ id: index + 1, name: `Step ${index + 1}`, targetType: 2, targetValue: 60, sets: 1 })) };
  const day = (id, happenDay, workout) => ({ idInPlan: id, happenDay, program: workout });
  const entries = [
    // An unsendable workout doesn't use one of the day's slots: twelve sendable ones on the same day keep eleven.
    day(1, "20261022", zoned), day(2, "20261022", { ...run, exercises: [] }),
    ...Array.from({ length: 12 }, (_, index) => day(10 + index, "20261022", run)),
    day(40, "20261023", long)
  ];
  const { workouts, skipped } = encodeTrainingPlan(entries, now);
  assert.equal(workouts, 11);
  assert.deepEqual(skipped, { zoneTargets: 1, invalid: 1, perDay: 1, fileSize: 1 });
  assert.deepEqual(encodeTrainingPlan([day(5, "20261023", run)], now).skipped, {}, "nothing left off");
  // The calendar file's size limit: later days drop first, and are counted.
  const many = Array.from({ length: 35 * 11 }, (_, index) => day(100 + index, planDay(Math.floor(index / 11)), run));
  const full = encodeTrainingPlan(many, now);
  assert.ok(full.workouts > 0 && full.workouts < many.length);
  assert.deepEqual(full.skipped, { fileSize: many.length - full.workouts });
});

await test("training calendar: the version comes from the content, so an unchanged calendar is recognised", () => {
  const now = new Date(2026, 9, 21, 9, 0);
  const entries = [{ idInPlan: 5, happenDay: "20261023", program: { ...program, id: "77" } }];
  const first = encodeTrainingPlan(entries, now);
  const again = encodeTrainingPlan(entries, new Date(2026, 9, 25, 20, 0));
  assert.equal(first.workouts, 1);
  assert.equal(again.contentHash, first.contentHash, "same calendar, later in the same week");
  assert.deepEqual(again.file, first.file, "same bytes");
  assert.notEqual(encodeTrainingPlan([{ ...entries[0], happenDay: "20261024" }], now).contentHash, first.contentHash, "a moved workout is new content");
  assert.notEqual(encodeTrainingPlan(entries, new Date(2026, 9, 28, 9, 0)).contentHash, first.contentHash, "a new week is new content");
  assert.equal(encodeTrainingPlan([], now).workouts, 0);
  assert.equal(LOCAL_PLAN_ENTRY_ID, "1");
});

await test("satellite data: settings type 13 names the receiver and the files, by model", () => {
  const today = watchHour(Date.UTC(2026, 9, 20, 9, 30));
  const start = today - 9;
  const read = (report) => applyFwInfoGpsAssistance(decodeBindGpsAssistance(report.bind), report.settings);
  const files = (assist, model) => satelliteFilesFor(assist, model).map(({ spec, watchStartHour }) => [spec.serverType, spec.fileId, watchStartHour]);

  // ELPO (PACE 4 variant 1, PACE 4 Pro): 24 blocks = 144 hours -> the 6-day file (ELPO_7, type 62) in file 13.
  const elpo = read(REPORTS.elpo(start));
  assert.deepEqual([elpo.format, elpo.source, elpo.chipType, elpo.epoType, elpo.durationHours, elpo.startHour], ["elpo", "settings", 2, 1, 144, start]);
  assert.equal(elpo.validUntil, unixMsOfWatchHour(start + 144), "hours since 2014");
  assert.equal(elpo.raw, REPORTS.elpo(start).bind.subarray(11, 15).toString("hex"));
  assert.equal(elpo.settingsRaw, REPORTS.elpo(start).settings.toString("hex"));
  assert.equal(elpo.eph.fileType, 0x10000, "an ELPO ephemeris type the app has no file for");
  for (const model of ["pace-4", "pace-4-pro", "pace-3"]) assert.deepEqual(files(elpo, model), [[62, 13, start]], model);
  for (const model of ["pace-pro", "apex-4", "pace-2", undefined]) assert.deepEqual(files(elpo, model), [], `${model}: ELPO not checked`);

  // PACE 3: 72 hours (ELPO_3, type 61) in file 13 and the next 96 (ELPO_4, type 63) in file 68, compared with its second start.
  const twoFiles = read(REPORTS.elpoTwoFiles(start, start + 72));
  assert.deepEqual([twoFiles.durationHours, twoFiles.second], [72, { startHour: start + 72, durationHours: 96 }]);
  assert.deepEqual(files(twoFiles, "pace-3"), [[61, 13, start], [63, 68, start + 72]]);
  assert.deepEqual(files(twoFiles, "pace-4"), [[61, 13, start]], "file 68 only where it was checked (the PACE 3)");

  // LTO (PACE Pro, APEX 4, PACE 4 variant 2): the RTO ephemeris first (file 70), then LTO (file 13), as the app sends them.
  const lto = read(REPORTS.lto(start, today - 2));
  assert.deepEqual([lto.format, lto.durationHours, lto.eph], ["synaptics-lto", 168, { epoType: 1, fileType: 0x10001, startHour: today - 2, durationHours: 4 }]);
  for (const model of ["pace-pro", "apex-4", "pace-4"]) assert.deepEqual(files(lto, model), [[81, 70, today - 2], [82, 13, start]], model);
  for (const model of ["pace-4-pro", "pace-3"]) assert.deepEqual(files(lto, model), [], `${model}: LTO not checked, nothing sent`);

  // PACE 4 variant 0: no figures in type 13, so the bind decides: all-systems EPO (EPO_GR), which no model is checked for.
  const epo = read(REPORTS.epo());
  assert.deepEqual([epo.format, epo.source, epo.startHour, epo.settingsRaw], ["airoha-epo", "bind", 0, REPORTS.epo().settings.toString("hex")]);
  for (const model of ["pace-4", "pace-4-pro", "pace-pro", "apex-4", "pace-3"]) assert.deepEqual(files(epo, model), [], `${model}: EPO_GR not sent`);

  // Without type 13 the bind alone (version 3, chip 0, all systems) can't name the receiver: nothing is sent.
  for (const report of [REPORTS.elpo(start), REPORTS.lto(start, start)]) {
    const bind = decodeBindGpsAssistance(report.bind);
    for (const model of ["pace-4", "pace-4-pro", "pace-pro", "apex-4", "pace-3"]) assert.deepEqual(files(bind, model), [], `${model}: bind only`);
  }
  assert.equal(applyFwInfoGpsAssistance(undefined, Buffer.alloc(3)), undefined, "a short reply changes nothing");
  assert.deepEqual(files(undefined, "pace-4"), []);
  // The app's choice by reported duration.
  assert.deepEqual([[144, 2, 1, 0], [168, 2, 1, 0], [72, 2, 1, 0], [96, 2, 1, 1], [168, 3, 1, 0], [4, 0x10001, 1, 0], [0, 0, 1, 0], [4, 0x10000, 1, 0], [144, 1, 0, 0]]
    .map((args) => cepFileFor(...args)?.serverType ?? null), [62, 62, 61, 63, 82, 81, null, null, null]);
  assert.deepEqual([satelliteFormat(0, 0), satelliteFormat(0, 1), satelliteFormat(1, 0), satelliteFormat(2, 1), satelliteFormat(3, 1), satelliteFormat(9, 1)],
    ["mtk-epo", "airoha-epo", "sony", "elpo", "synaptics-lto", "unknown"]);
});

await test("satellite data: COROS files are checked before they are sent", () => {
  const start = watchHour(Date.UTC(2026, 9, 20));
  const elpo = parseCepFile(elpoFile(start), CEP_FILES[62]);
  assert.deepEqual([elpo.format, elpo.serverType, elpo.startHour, elpo.hours, elpo.startSeconds], ["elpo", 62, start, 144, start * 3600]);
  assert.equal(parseCepFile(elpoFile(start, 72), CEP_FILES[61]).hours, 72);
  const ltoStart = start * 3600 + 1023;
  const lto = parseCepFile(synapticsFile(ltoStart), CEP_FILES[82]);
  assert.deepEqual([lto.format, lto.startHour, lto.startSeconds, lto.hours], ["synaptics-lto", start, ltoStart, 168], "an LTO start need not be on the hour");
  const rto = parseCepFile(synapticsFile(ltoStart, 4, 3), CEP_FILES[81]);
  assert.deepEqual([rto.format, rto.hours], ["synaptics-rto", 4]);

  const refused = (bytes, spec, why) => assert.throws(() => parseCepFile(bytes, spec), /expected format|out of order/, why);
  refused(elpoFile(start), CEP_FILES[82], "an ELPO file is not LTO");
  refused(synapticsFile(ltoStart), CEP_FILES[81], "LTO is not RTO (subtype)");
  refused(synapticsFile(ltoStart, 4, 3), CEP_FILES[82], "RTO is not LTO");
  refused(elpoFile(start, 72), CEP_FILES[62], "a 72-hour file is not the 6-day one");
  refused(Buffer.concat([elpoFile(start), Buffer.alloc(1)]), CEP_FILES[62], "trailing bytes");
  refused(elpoFile(start).subarray(0, 5000), CEP_FILES[62], "cut short");
  const first = section(start * 3600, 144, 5, 1, elpoRecords(start * 3600, 144));
  refused(Buffer.concat([section(start * 3600, 72, 4, 1, Buffer.alloc(9)), first]), CEP_FILES[62], "section 5 first");
  refused(Buffer.concat([first, section(start * 3600, 72, 4, 1, Buffer.alloc(9)), section(start * 3600, 72, 4, 1, Buffer.alloc(9))]), CEP_FILES[62], "a section twice");
  refused(Buffer.concat([first, section(start * 3600, 72, 9, 1, Buffer.alloc(9))]), CEP_FILES[62], "an unknown section");
  const restamped = Buffer.from(elpoFile(start)); restamped.writeUIntLE(1, 16 + 56 * 72 * 3, 3);
  refused(restamped, CEP_FILES[62], "a satellite record stamped with another hour");
  refused(section(start * 3600 + 60, 144, 5, 1, elpoRecords(start * 3600, 144)), CEP_FILES[62], "ELPO starts on the hour");
  refused(synapticsFile(ltoStart, 168, 2, 262_144 - 16 - 16 + 1), CEP_FILES[82], "more than the watch takes");
  refused(Buffer.alloc(16), CEP_FILES[82], "empty");
  assert.equal(parseCepFile(synapticsFile(ltoStart, 168, 2, 262_144 - 32), CEP_FILES[82]).data.length, 262_144 - 16, "exactly 256 KB with the HF header");

  // What goes over SendFile: an HF file of the file's id, its start as the file time, CRC-16 of the body; the start hour in the extra bytes.
  for (const [file, id] of [[elpo, 13], [lto, 13], [rto, 70]]) {
    const { fileId, bytes, extra } = encodeCepTransfer(file);
    assert.deepEqual([fileId, bytes.subarray(0, 2).toString("latin1"), bytes[2], bytes[3], bytes.readUInt32LE(4), bytes.readUInt32LE(8)], [id, "HF", 0, id, file.startSeconds, file.data.length]);
    assert.equal(bytes.readUInt16LE(12), crc16Ccitt(file.data));
    assert.equal(bytes.readUInt16LE(14), crc16Ccitt(bytes.subarray(0, 14)));
    assert.deepEqual(bytes.subarray(16), file.data);
    assert.deepEqual(extra, [file.startHour & 255, (file.startHour >> 8) & 255, file.startHour >> 16]);
    const header = encodeTrainingBlockHeader(fileId, bytes.subarray(4096, 8192), 4096, bytes.length, extra);
    assert.deepEqual([...header.subarray(0, 3), header.readUInt32LE(3), header.readUInt32LE(9), ...header.subarray(16, 20)], [0x78, 0, id, 4096, bytes.length - 4096, ...extra, 3]);
  }
  assert.ok(encodeTrainingBlockHeader(68, Buffer.alloc(10), 0, 262_144, [255, 255, 255]), "satellite files: up to 256 KB, any hour byte");
  assert.throws(() => encodeTrainingBlockHeader(70, Buffer.alloc(10), 0, 262_145, [1, 2, 3]), /Invalid/);
  assert.throws(() => encodeTrainingBlockHeader(41, Buffer.alloc(10), 0, 65_537, 1), /Invalid/, "other files keep their 64 KB");
  assert.throws(() => encodeTrainingBlockHeader(69, Buffer.alloc(10), 0, 10, [1, 2, 3]), /Invalid/);

  // When to send, as the app decides: a newer start than the watch's, and never data that has run out.
  const now = start + 5;
  assert.equal(cepFileIsNewer(start - 24, elpo, now), true, "yesterday's data on the watch");
  assert.equal(cepFileIsNewer(0, elpo, now), true, "nothing on the watch");
  assert.equal(cepFileIsNewer(undefined, elpo, now), true);
  assert.equal(cepFileIsNewer(start, elpo, now), false, "the same file");
  assert.equal(cepFileIsNewer(start + 24, elpo, now), false, "the watch has newer data");
  assert.equal(cepFileIsNewer(0, elpo, start + 144), false, "run out");
  assert.equal(cepFileIsNewer(0, rto, start + 4), false, "an RTO 4 hours old");
});

await test("satellite data: the cep/query list and downloads are checked", async () => {
  const start = watchHour(Date.now()) - 3;
  const files = { 62: elpoFile(start), 82: synapticsFile(start * 3600 + 7), 81: synapticsFile(start * 3600 + 7, 4, 3) };
  const md5 = (bytes) => crypto.createHash("md5").update(bytes).digest("hex");
  const entry = (type, extra = {}) => ({ happenDay: 20261020, md5: md5(files[type]), timestamp: WATCH_EPOCH + start * 3600, type, url: `https://s3.coros.com/cep_v5/x/${type}.DAT`, ...extra });
  const requests = [];
  const server = (data, bodies = files) => async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).startsWith("https://epo.coros.com/cep/query")) return new Response(JSON.stringify({ data, message: "OK", result: "0000" }));
    return new Response(bodies[Number(String(url).match(/\/(\d+)\.DAT$/)[1])]);
  };
  const index = await fetchCepIndex(server([entry(62), entry(82), { type: 5, url: 7 }, null, entry(81, { md5: "nope" })]));
  assert.deepEqual(index.map((item) => item.type), [62, 82], "malformed entries are dropped");
  assert.match(requests[0].url, /^https:\/\/epo\.coros\.com\/cep\/query\?r=\d+$/, "a GET with only a random number, as the app sends");
  assert.equal(requests[0].init.method, undefined);
  assert.equal(requests[0].init.headers, undefined, "no account, token or cookie");
  for (const type of [62, 82, 81]) {
    const file = await fetchCepFile(CEP_FILES[type], server([entry(type)]));
    assert.deepEqual([file.serverType, file.startHour], [type, start]);
  }
  await assert.rejects(fetchCepFile(CEP_FILES[62], server([entry(82)])), /sent no data/, "no file of that type");
  await assert.rejects(fetchCepFile(CEP_FILES[62], server([entry(62, { md5: "0".repeat(32) })])), /damaged during download/);
  for (const url of ["http://s3.coros.com/cep_v5/x/62.DAT", "https://evil.example/cep_v5/x/62.DAT", "https://s3.coros.com.evil.example/62.DAT", "not a link"]) {
    await assert.rejects(fetchCepFile(CEP_FILES[62], server([entry(62, { url })])), /unexpected download link/, url);
  }
  await assert.rejects(fetchCepFile(CEP_FILES[62], server([entry(62, { timestamp: WATCH_EPOCH + (start - 72) * 3600 })])), /expected format/, "not the file the list dates");
  await assert.rejects(fetchCepFile(CEP_FILES[82], server([entry(82, { md5: md5(files[62]) })], { 82: files[62] })), /expected format/, "an ELPO file listed as LTO");
  // Sizes are capped while reading, declared or not.
  const huge = Buffer.alloc(300_000, 1);
  const streamed = (bytes) => new ReadableStream({ start(controller) { for (let at = 0; at < bytes.length; at += 4096) controller.enqueue(bytes.subarray(at, at + 4096)); controller.close(); } });
  await assert.rejects(fetchCepFile(CEP_FILES[82], async (url) => String(url).includes("cep/query")
    ? new Response(JSON.stringify({ data: [entry(82, { md5: md5(huge) })] })) : new Response(streamed(huge))), /larger than expected/);
  await assert.rejects(fetchCepIndex(async () => new Response(streamed(Buffer.alloc(100_000, 0x20)))), /larger than expected/, "the list too");
  await assert.rejects(fetchCepIndex(async () => new Response("null")), /sent no data/);
  await assert.rejects(fetchCepIndex(async () => new Response(JSON.stringify({ data: "x" }))), /sent no data/);
  await assert.rejects(fetchCepIndex(async () => new Response("", { status: 503 })), /isn't available right now/);
});

console.log(`watch commands (${process.env.TZ ?? "UTC"}): ${passed} checks passed`);
