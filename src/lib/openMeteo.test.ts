import { describe, expect, it } from "vitest";
import { addMinutes, compass, sky, weatherFrom, weatherUrl, currentWeatherUrl, weatherNowFrom } from "./openMeteo";

const hours = Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? "20" : "21"}T${String(i % 24).padStart(2, "0")}:00`);
const answer = {
  hourly: {
    time: hours,
    temperature_2m: hours.map((_, i) => i),
    apparent_temperature: hours.map((_, i) => i - 2),
    relative_humidity_2m: hours.map(() => 80),
    dew_point_2m: hours.map(() => 4),
    wind_speed_10m: hours.map(() => 12),
    wind_direction_10m: hours.map(() => 225),
    wind_gusts_10m: hours.map(() => 30),
    weather_code: hours.map(() => 61),
  },
};

describe("Open-Meteo weather", () => {
  it("asks the forecast API for recent days and the archive for old ones, with a coarse location", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const recent = weatherUrl(51.50734, -0.12776, "2026-11-20T07:30", "2026-11-20T08:15", now);
    expect(recent).toContain("https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13&start_date=2026-11-20&end_date=2026-11-20");
    expect(weatherUrl(1, 2, "2026-01-02T07:30", "2026-01-02T08:00", now)).toContain("archive-api.open-meteo.com");
  });
  it("reads the start between hours and the finish", () => {
    const w = weatherFrom(answer, "2026-11-20T07:30", "2026-11-20T09:00")!;
    expect(w).toMatchObject({ tempC: 7.5, feelsC: 5.5, humidityPct: 80, dewPointC: 4, windKmh: 12, gustKmh: 30, windFrom: "SW", finishTempC: 9, sky: "Rain" });
  });
  it("crosses midnight", () => {
    expect(weatherFrom(answer, "2026-11-20T23:30", "2026-11-21T00:40")?.finishTempC).toBeCloseTo(24 + 40 / 60, 6);
    expect(addMinutes("2026-11-20T23:30", 70)).toBe("2026-11-21T00:40");
  });
  it("gives nothing when the hour has no temperature", () => {
    expect(weatherFrom({ hourly: { time: hours, temperature_2m: hours.map(() => null) } }, "2026-11-20T07:30", "2026-11-20T08:00")).toBeNull();
    expect(weatherFrom(null, "2026-11-20T07:30", "2026-11-20T08:00")).toBeNull();
  });
  it("names wind and sky", () => {
    expect([compass(0), compass(350), compass(90), compass(200)]).toEqual(["N", "N", "E", "S"]);
    expect([sky(0), sky(3), sky(45), sky(95)]).toEqual(["Clear", "Overcast", "Fog", "Thunderstorm"]);
  });
});

describe("weather now", () => {
  it("asks for current weather with today's range", () => {
    const url = new URL(currentWeatherUrl(51.5074, -0.1278));
    expect(url.searchParams.get("latitude")).toBe("51.51");
    expect(url.searchParams.get("current")).toContain("weather_code");
  });
  it("reads temperature, sky and range", () => {
    expect(weatherNowFrom({ current: { temperature_2m: 8.4, weather_code: 3, is_day: 0 }, daily: { temperature_2m_max: [11], temperature_2m_min: [4] } }))
      .toEqual({ tempC: 8.4, code: 3, isDay: false, highC: 11, lowC: 4 });
    expect(weatherNowFrom({ current: {} })).toBeNull();
  });
});
