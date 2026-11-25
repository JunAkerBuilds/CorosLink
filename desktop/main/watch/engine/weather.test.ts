// The weather against CorosKit: its WatchDataTests (weather file, tides, condition codes, day names) ported, and
// recorded Open-Meteo answers whose file bytes CorosKit itself built (fixtures/weather-*.bin, from the helper's
// Weather.swift parsing and WatchForecast.watchFile). Nothing here touches the network.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crc16Ccitt, sum8, u16, u32 } from "./bytes";
import { syncTime } from "./commands";
import { type CalendarDay, fromRefSeconds, refSeconds } from "./native";
import { fieldBytes, fieldVarint, type ProtoField, protoFields, ProtoWriter } from "./protobuf";
import { WatchSession } from "./session";
import type { BleLink } from "./transport";
import {
  airQualityURL, type Conditions, fetchForecast, forecastURL, type ForecastDay, sendWeather, sendWeatherIfDue, Tides,
  watchDayTime, watchForecast, weatherFile, weatherKitCode, weatherPlace,
} from "./weather";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name));
const int64 = (v: bigint) => Number(BigInt.asIntN(64, v));
const zig = (v: number) => (v < 0 ? -2 * v - 1 : 2 * v);
const unzig = (v: bigint) => Number((v >> 1n) ^ -(v & 1n));
const round = (v: number) => Math.floor(v + 0.5);
const grouped = (bytes: Uint8Array): Record<number, ProtoField[]> => {
  const out: Record<number, ProtoField[]> = {};
  for (const f of protoFields(bytes)) (out[f.number] ??= []).push(f);
  return out;
};
/** One WeatherUI entry's varints, as Int64. */
const entry = (bytes: Uint8Array): Record<number, number> =>
  Object.fromEntries(protoFields(bytes).map((f) => [f.number, int64(fieldVarint(f)!)]));

/**
 * A weather file read back as one WeatherForecastUI's fields: the kind-0 header's, 2 = the forecast hours (kind 2 with
 * a temperature), 3 = the days (kind 1). Also the pressure-only past hours and every [kind, index].
 */
function weatherView(file: Uint8Array) {
  const body = file.subarray(16);
  const forecast = new ProtoWriter(); const past: Buffer[] = []; const sections: number[][] = [];
  let i = 0;
  while (i < body.length) {
    const [kind, index, length] = [body[i], body[i + 1], body[i + 2] | (body[i + 3] << 8)];
    expect([body[i + 4], body[i + 5]]).toEqual([0, 0]);
    expect(length + 6).toBeLessThan(1024);
    const bytes = Buffer.from(body.subarray(i + 6, i + 6 + length));
    sections.push([kind, index]);
    if (kind === 0) forecast.raw(bytes);
    else if (kind === 1) forecast.message(3, bytes);
    else if (grouped(bytes)[3]) forecast.message(2, bytes);
    else past.push(bytes);
    i += 6 + length;
  }
  expect(i).toBe(body.length);
  return { ui: grouped(forecast.data), past, sections };
}

const addUTCDays = (d: CalendarDay, days: number): CalendarDay => {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
};

describe("weather file (WatchDataTests)", () => {
  it("is in the units the watch reads", () => {
    const hour0 = 1_792_400_400; // 2026-10-19 03:00 UTC, the hour under way
    const nowSeconds = hour0 + 2700;
    const now = new Date(nowSeconds * 1000);
    const current: Conditions = { time: nowSeconds, condition: 1, temperature: -2.44, feelsLike: -6.06, humidity: 81, windSpeedKmh: 12.46,
      windDirection: 200, uvIndex: 3.6, usAQI: 57, pressureHpa: 1012.3 };
    const hours: Conditions[] = Array.from({ length: 101 }, (_, index) => {
      const time = hour0 + (index - 1) * 3600;
      if (index === 1) {
        return { time, condition: 1, temperature: -2.4, feelsLike: -6, humidity: 80, precipitationChance: 35, windSpeedKmh: 20,
          windDirection: 350, uvIndex: 4.4, usAQI: 51, pressureHpa: 1000.1 };
      }
      return { time, condition: 14, temperature: 10 + index / 10, feelsLike: 9, humidity: 55.5, precipitationChance: 100,
        windSpeedKmh: 20, windDirection: 22.5, uvIndex: 11.6, usAQI: index < 60 ? 42 : undefined, pressureHpa: 1000 + index / 10 };
    });
    const days: ForecastDay[] = Array.from({ length: 14 }, (_, index) => ({
      date: addUTCDays({ year: 2026, month: 10, day: 19 }, index), condition: index === 0 ? 1 : 14,
      low: index === 0 ? -5 : -1, high: index === 0 ? 1.55 : 4, precipitationChance: index === 0 ? 35 : 80,
    }));
    const past = [{ time: hour0 - 3600, hpa: 1000 }];
    const forecast = watchForecast({ latitude: 10.7769, longitude: 106.7009, current, hourly: hours, pastPressure: past, daily: days, airQuality: true });
    expect(forecast.hourly.length).toBe(96);
    expect(forecast.hourly[0].time).toBe(hour0);
    expect(forecast.current.precipitationChance).toBe(35);

    const zone = "Asia/Ho_Chi_Minh";
    const file = weatherFile(forecast, "Ho Chi Minh City", now, zone);
    expect([...file.subarray(0, 4)]).toEqual([0x48, 0x46, 0, 80]);
    expect(file.length).toBeLessThanOrEqual(4096);
    const view = weatherView(file);
    const ui = view.ui;
    const now0 = entry(fieldBytes(ui[1][0])!);
    expect(now0).toEqual({ 2: 1, 3: -24, 4: -61, 5: 810, 6: 4, 8: 125, 11: 35, 12: 4, 13: 57, 14: nowSeconds, 16: zig(101_230) });
    const hourly = ui[2].map((f) => entry(fieldBytes(f)!));
    expect(hourly.length).toBe(95);
    expect(view.past.map(entry)).toEqual([{ 2: 255, 14: hour0 - 3600, 16: zig(100_000) }]);
    expect(view.sections.slice(0, 2)).toEqual([[0, 0], [1, 0]]);
    const hourIndexes = view.sections.filter((s) => s[0] === 2).map((s) => s[1]);
    expect(hourIndexes).toEqual(hourIndexes.map((_, i) => i));
    expect([fieldVarint(ui[11][0]), fieldVarint(ui[12][0])]).toEqual([3600n, 259_200n]);
    expect([...file.subarray(16, 18)]).toEqual([0, 0]);
    expect(hourly[0]).toEqual({ ...now0, 14: hour0 });
    expect(hourly[2][6]).toBe(1);
    expect(hourly[1]).toEqual({ 2: 14, 3: 102, 4: 90, 5: 555, 6: 1, 8: 200, 11: 100, 12: 12, 13: 42, 14: hour0 + 3600, 16: zig(100_020) });
    expect(hourly[60][13]).toBe(0xffff);
    const daily = ui[3].map((f) => entry(fieldBytes(f)!));
    expect(daily.length).toBe(14);
    const watchMidnight = 1_792_368_000 - 7 * 3600; // 2026-10-19 00:00 at UTC+7
    expect(daily[0]).toEqual({ 2: 1, 9: -50, 10: 16, 11: 35, 14: watchMidnight + 3600 });
    expect(daily[1]).toEqual({ 2: 14, 9: -10, 10: 40, 11: 80, 14: watchMidnight + 86_400 + 3600 });
    expect([fieldVarint(ui[4][0]), fieldVarint(ui[5][0]), fieldVarint(ui[6][0])]).toEqual([3n, 3n, BigInt(nowSeconds)]);
    expect(ui[7]).toBeUndefined();
    expect(unzig(fieldVarint(ui[8][0])!)).toBe(107_769_000);
    expect(unzig(fieldVarint(ui[9][0])!)).toBe(1_067_009_000);
    expect(fieldBytes(ui[10][0])!.toString("utf8")).toBe("Ho Chi Minh City");

    // Without air quality: no AQI provider and no AQI.
    const plain = watchForecast({ latitude: 10.7769, longitude: 106.7009, current, hourly: hours, daily: days });
    const plainUI = weatherView(weatherFile(plain, "", now, zone)).ui;
    expect(plainUI[5]).toBeUndefined();
    expect(plainUI[2].some((f) => entry(fieldBytes(f)!)[13] !== undefined)).toBe(false);

    // Below freezing every temperature takes 10 bytes: the far hours go without "feels like", then the furthest go.
    const cold = hours.map((h) => ({ ...h, temperature: -12.3, feelsLike: -20.7, usAQI: 42 }));
    const frozen = watchForecast({ latitude: 10.7769, longitude: 106.7009, current, hourly: cold, pastPressure: past, daily: days, airQuality: true });
    const frozenFile = weatherFile(frozen, "Ho Chi Minh City", now, zone);
    expect(frozenFile.length).toBeLessThanOrEqual(4096);
    const frozenHours = weatherView(frozenFile).ui[2].map((f) => entry(fieldBytes(f)!));
    expect(frozenHours.length).toBeGreaterThanOrEqual(48);
    expect(frozenHours.length).toBeLessThan(95);
    expect(frozenHours[1][4]).toBe(-207);
    expect(frozenHours[frozenHours.length - 1][4]).toBeUndefined();
  });

  it("reads tides from Open-Meteo marine", () => {
    const start = 1_792_400_400; // 2026-10-19 03:00 UTC
    // A semi-diurnal tide, 1.2 m either way: high at 06:00, 18:25 and 06:50 UTC, low at 12:12 and 00:37.
    const period = 12.42 * 3600;
    const heights = Array.from({ length: 30 }, (_, hour) => 1.2 * Math.cos(2 * Math.PI * (hour * 3600 - 3 * 3600) / period));
    const answer = JSON.stringify({ hourly: { time: Array.from({ length: 32 }, (_, i) => start + i * 3600), sea_level_height_msl: [...heights, null, null] } });
    const tides = Tides.parse(answer)!;
    expect(tides.readings.length).toBe(30);
    expect(Tides.parse(JSON.stringify({ hourly: { time: [start, start + 3600], sea_level_height_msl: [null, null] } }))).toBeNull();
    const t0 = start;
    expect(tides.meters(t0 + 1800)).toBeCloseTo((heights[0] + heights[1]) / 2, 9);
    expect(tides.meters(t0 - 1)).toBeUndefined();

    const turns = tides.turns;
    expect(turns.map((t) => t.isHigh)).toEqual([true, false, true, false, true]);
    [3.0, 3 + 6.21, 3 + 12.42, 3 + 18.63, 3 + 24.84].forEach((hours, i) => {
      expect(Math.abs((turns[i].time - t0) / 3600 - hours)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(Math.abs(turns[i].meters) - 1.2)).toBeLessThanOrEqual(0.02);
    });
    expect(tides.next(t0 + 4 * 3600).map((t) => t.isHigh)).toEqual([false, true]);

    // On the watch: tide height in centimetres (sint32, field 15) on past hours and hours ahead.
    const hour0 = t0 + 6 * 3600;
    const hours: Conditions[] = Array.from({ length: 24 }, (_, i) => ({ time: hour0 + i * 3600, condition: 0, temperature: 10 }));
    const forecast = watchForecast({ latitude: 50, longitude: -1, current: hours[0], hourly: hours, pastPressure: [{ time: hour0 - 3600, hpa: 1000 }], daily: [], tides });
    const view = weatherView(weatherFile(forecast, "", new Date(hour0 * 1000), "UTC"));
    const tide = (bytes: Uint8Array) => { const f = protoFields(bytes).find((x) => x.number === 15); return f ? unzig(fieldVarint(f)!) : undefined; };
    expect(tide(view.past[0])).toBe(round(heights[5] * 100));
    expect(view.ui[2].slice(0, 3).map((f) => tide(fieldBytes(f)!))).toEqual(heights.slice(6, 9).map((h) => round(h * 100)));
    const inland = watchForecast({ latitude: 50, longitude: -1, current: hours[0], hourly: hours, daily: [] });
    expect(weatherView(weatherFile(inland, "", new Date(hour0 * 1000))).ui[2].some((f) => tide(fieldBytes(f)!) !== undefined)).toBe(false);
  });

  it("maps WeatherKit conditions to Apple codes", () => {
    expect(["clear", "mostlyClear", "partlyCloudy", "cloudy", "foggy", "rain", "heavyRain", "snow", "thunderstorms", "drizzle", "nonsense"]
      .map(weatherKitCode)).toEqual([0, 5, 7, 1, 3, 14, 13, 25, 37, 12, 255]);
  });

  it("keeps each day's name across time zones", () => {
    const offsetMinutes = (zone: string, at: Date) => {
      const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")!.value;
      const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name)!;
      return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    };
    for (const zone of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata", "America/St_Johns"]) {
      const now = new Date(1_792_400_400 * 1000);
      const day = { year: 2026, month: 10, day: 25 };
      const sent = watchDayTime(day, now, zone);
      const clock = syncTime(now, false, offsetMinutes(zone, now));
      const watchOffset = ((clock[5] << 24) >> 24) * 900;
      const shown = new Date((sent - 3600 + watchOffset) * 1000);
      expect({ year: shown.getUTCFullYear(), month: shown.getUTCMonth() + 1, day: shown.getUTCDate() }, zone).toEqual(day);
    }
  });
});

// MARK: Open-Meteo answers through CorosKit

/** A fetch that answers from the recorded files, and remembers what was asked. */
function recorded(place: "lisbon" | "denver", missing: ("air" | "marine")[] = []) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("C-LINK");
    const kind = url.includes("air-quality") ? "air" : url.includes("marine") ? "marine" : "forecast";
    if (kind !== "forecast" && missing.includes(kind)) return new Response("busy", { status: 500 });
    return new Response(fixture(`weather-${place}-${kind}.json`), { status: 200 });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

describe("Open-Meteo", () => {
  const now = new Date(1_795_628_123_750);
  const variables = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,uv_index,pressure_msl";

  it("asks with the helper's URLs, at the place rounded to two decimals", async () => {
    const { asked, fetchImpl } = recorded("lisbon");
    await fetchForecast(38.7223, -9.1393, fetchImpl);
    expect(asked.sort()).toEqual([
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=38.7200&longitude=-9.1400&current=us_aqi&hourly=us_aqi&timeformat=unixtime&forecast_days=5",
      `https://api.open-meteo.com/v1/forecast?latitude=38.7200&longitude=-9.1400&current=${variables}&hourly=${variables}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timeformat=unixtime&timezone=auto&forecast_days=14&past_days=1`,
      "https://marine-api.open-meteo.com/v1/marine?latitude=38.7200&longitude=-9.1400&hourly=sea_level_height_msl&timeformat=unixtime&past_hours=7&forecast_hours=97",
    ]);
    expect(forecastURL(-0, 0.5)).toContain("latitude=-0.0000&longitude=0.5000");
    expect(airQualityURL(1, 2)).toContain("latitude=1.0000&longitude=2.0000");
  });

  it("builds CorosKit's file byte for byte, at the coast with air quality and tides", async () => {
    const forecast = await fetchForecast(38.7223, -9.1393, recorded("lisbon").fetchImpl);
    expect(forecast.tides).not.toBeNull();
    expect(forecast.airQuality).toBe(true);
    expect(weatherFile(forecast, "Lisboa", now, "Europe/Lisbon").equals(fixture("weather-lisbon.bin"))).toBe(true);
  });

  it("builds CorosKit's file byte for byte without air quality or tides", async () => {
    const forecast = await fetchForecast(38.7223, -9.1393, recorded("lisbon", ["air", "marine"]).fetchImpl);
    expect([forecast.tides, forecast.airQuality]).toEqual([null, false]);
    expect(weatherFile(forecast, "Lisboa", now, "Europe/Lisbon").equals(fixture("weather-lisbon-plain.bin"))).toBe(true);
  });

  it("builds CorosKit's file byte for byte inland, west of UTC, with a long city", async () => {
    const forecast = await fetchForecast(39.7392, -104.9903, recorded("denver").fetchImpl);
    expect(forecast.tides).toBeNull();
    const file = weatherFile(forecast, "  Denver, Colorado, United States of América 🇺🇸 \n", now, "America/Denver");
    expect(file.equals(fixture("weather-denver.bin"))).toBe(true);
  });

  it("fails when the forecast doesn't come", async () => {
    const down = (async () => new Response("", { status: 503 })) as typeof fetch;
    await expect(fetchForecast(1, 2, down)).rejects.toThrow("The weather service didn't answer.");
    const empty = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await expect(fetchForecast(1, 2, empty)).rejects.toThrow("The weather service returned no current conditions.");
  });
});

// MARK: Sending

function fakeSession(name = "COROS PACE Pro 2F1A6C") {
  const sent: { header: Buffer; block: Buffer; fileIndex: number }[] = [];
  const link = {
    isConnected: true,
    info: { name, maximumWriteBytes: 244 },
    async sendFileBlock(header: Uint8Array, block: Uint8Array, fileIndex: number) { sent.push({ header: Buffer.from(header), block: Buffer.from(block), fileIndex }); },
  };
  const session = new WatchSession(link as unknown as BleLink);
  session.authenticatedAt = new Date();
  return { session, sent };
}

describe("sending", () => {
  it("sends the file in one SendFile block, as the data file test and simulated watch expect", async () => {
    const { session, sent } = fakeSession();
    const forecast = watchForecast({ latitude: 1, longitude: 2, current: { time: 0, condition: 0, temperature: 1 }, hourly: [], daily: [] });
    const file = weatherFile(forecast, "", new Date(0), "UTC");
    await sendWeather(session, file);
    expect(sent.length).toBe(1);
    const { header, block, fileIndex } = sent[0];
    expect(fileIndex).toBe(80);
    expect(block.equals(file)).toBe(true);
    expect([...block.subarray(0, 4)]).toEqual([0x48, 0x46, 0, 80]);
    expect(u32(block, 8)).toBe(block.length - 16);
    expect(u16(block, 12)).toBe(crc16Ccitt(block.subarray(16)));
    expect(u16(block, 14)).toBe(crc16Ccitt(block.subarray(0, 14)));
    expect([...header.subarray(0, 3)]).toEqual([0x78, 0, 80]);
    expect([u32(header, 3), u16(header, 7), u32(header, 9)]).toEqual([0, file.length, file.length]);
    expect([...header.subarray(16, 20)]).toEqual([0, 0, 0, 3]);
    expect(header[20]).toBe(sum8(header.subarray(2, 20)));
  });

  it("refuses without authentication, on unchecked watches and when too large", async () => {
    const { session } = fakeSession();
    await expect(sendWeather(session, Buffer.alloc(4097))).rejects.toThrow("The weather file is too large.");
    session.authenticatedAt = null;
    await expect(sendWeather(session, Buffer.alloc(20))).rejects.toThrow("Connect and authenticate your watch first.");
    await expect(sendWeather(fakeSession("COROS NOMAD 123456").session, Buffer.alloc(20))).rejects.toThrow("Not available on this watch.");
  });

  it("reads a place as the helper does", () => {
    expect(weatherPlace({ latitude: 38.7, longitude: -9.1, city: "Lisboa" })).toEqual({ latitude: 38.7, longitude: -9.1, city: "Lisboa" });
    expect(weatherPlace({ latitude: 38, longitude: -9 })).toEqual({ latitude: 38, longitude: -9, city: "" });
    expect(weatherPlace({ latitude: 91, longitude: 0 })).toBeNull();
    expect(weatherPlace({ latitude: 0, longitude: -180.5 })).toBeNull();
    expect(weatherPlace({ latitude: "1", longitude: 0 })).toBeNull();
    expect(weatherPlace(null)).toBeNull();
    expect(weatherPlace({ latitude: 0, longitude: 0, city: "🇺🇸".repeat(41) })!.city).toBe("🇺🇸".repeat(40));
  });

  it("sends again only for a new place, after 30 minutes or when forced, keeping weather.json as the helper did", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "clink-weather-"));
    try {
      const keptFile = path.join(folder, "weather.json");
      const place = { latitude: 38.7223, longitude: -9.1393, city: "Lisboa" };
      // As the Swift helper's JSONEncoder wrote it.
      await writeFile(keptFile, '{"place":{"latitude":38.7223,"longitude":-9.1393,"city":"Lisboa"},"at":816000000.25}');
      const sentAt = fromRefSeconds(816_000_000.25).getTime();
      const { session, sent } = fakeSession();
      const deps = (minutes: number) => ({ fetchImpl: recorded("lisbon").fetchImpl, now: () => new Date(sentAt + minutes * 60_000) });

      expect(await sendWeatherIfDue(session, place, folder, false, deps(29))).toBe(false);
      expect(await sendWeatherIfDue(session, { ...place, city: "Lisbon" }, folder, false, deps(29))).toBe(true);
      expect(await sendWeatherIfDue(session, { ...place, city: "Lisbon" }, folder, true, deps(30))).toBe(true);
      expect(await sendWeatherIfDue(session, place, folder, false, deps(31))).toBe(true);
      expect(sent.length).toBe(3);
      expect(JSON.parse(await readFile(keptFile, "utf8"))).toEqual({ at: refSeconds(new Date(sentAt + 31 * 60_000)), place });
      expect(await sendWeatherIfDue(session, place, folder, false, deps(40))).toBe(false);
      expect(await sendWeatherIfDue(session, place, null, false, deps(40))).toBe(true);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
