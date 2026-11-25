import { describe, expect, it } from "vitest";
import { buildManualTcx, cleanManualActivity } from "./tcx";

describe("a hand-entered activity as TCX", () => {
  it("is one activity with one lap, as the desktop app writes it", () => {
    expect(buildManualTcx({ sport: "run", startTimeIso: "2026-11-18T05:40:00.000Z", durationSec: 2520, distanceM: 8200, calories: 571, avgHr: 148 })).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n` +
      `  <Activities>\n` +
      `    <Activity Sport="Running">\n` +
      `      <Id>2026-11-18T05:40:00.000Z</Id>\n` +
      `      <Lap StartTime="2026-11-18T05:40:00.000Z">\n` +
      `        <TotalTimeSeconds>2520</TotalTimeSeconds>\n` +
      `        <DistanceMeters>8200</DistanceMeters>\n` +
      `        <Calories>571</Calories>\n` +
      `        <AverageHeartRateBpm><Value>148</Value></AverageHeartRateBpm>\n` +
      `        <Intensity>Active</Intensity>\n` +
      `        <TriggerMethod>Manual</TriggerMethod>\n` +
      `      </Lap>\n` +
      `    </Activity>\n` +
      `  </Activities>\n` +
      `</TrainingCenterDatabase>\n`,
    );
  });

  it("knows only running, biking and other", () => {
    const of = (sport: "run" | "bike" | "other") => /Sport="([^"]+)"/.exec(buildManualTcx({ sport, startTimeIso: "2026-11-18T05:40:00.000Z", durationSec: 60, distanceM: 0 }))?.[1];
    expect([of("run"), of("bike"), of("other")]).toEqual(["Running", "Biking", "Other"]);
  });

  it("leaves heart rate out when it isn't known, and writes zero distance and calories", () => {
    const tcx = buildManualTcx({ sport: "other", startTimeIso: "2026-11-18T05:40:00.000Z", durationSec: 1800.4, distanceM: 0 });
    expect(tcx).not.toContain("AverageHeartRateBpm");
    expect(tcx).toContain("<TotalTimeSeconds>1800</TotalTimeSeconds>");
    expect(tcx).toContain("<DistanceMeters>0</DistanceMeters>");
    expect(tcx).toContain("<Calories>0</Calories>");
  });

  it("escapes the start time", () => {
    expect(buildManualTcx({ sport: "run", startTimeIso: `"><x a="&`, durationSec: 60, distanceM: 0 })).toContain(`<Id>&quot;&gt;&lt;x a=&quot;&amp;</Id>`);
  });
});

describe("what the server takes for a logged activity", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const good = { sport: "bike", startTimeIso: "2026-11-18T06:40:00+01:00", durationSec: 2520, distanceM: 41_370, calories: 571, avgHr: 148 };

  it("writes the start as a UTC instant and keeps what was given", () => {
    expect(cleanManualActivity(good, now)).toEqual({ sport: "bike", startTimeIso: "2026-11-18T05:40:00.000Z", durationSec: 2520, distanceM: 41_370, calories: 571, avgHr: 148 });
  });

  it("drops extras that aren't positive numbers instead of guessing", () => {
    expect(cleanManualActivity({ ...good, distanceM: "abc", calories: -4, avgHr: null }, now)).toEqual({ sport: "bike", startTimeIso: "2026-11-18T05:40:00.000Z", durationSec: 2520, distanceM: 0 });
  });

  it("refuses a missing duration, a bad or future start, an unknown sport, and more than a day", () => {
    expect(cleanManualActivity({ ...good, durationSec: 0 }, now)).toBe("Add a duration to log this activity.");
    expect(cleanManualActivity({ ...good, durationSec: "x" }, now)).toBe("Add a duration to log this activity.");
    expect(cleanManualActivity({ ...good, startTimeIso: "yesterday" }, now)).toBe("The start time isn't valid.");
    expect(cleanManualActivity({ ...good, startTimeIso: "2026-11-21T06:40:00Z" }, now)).toBe("Logging is for activities that have already started.");
    expect(cleanManualActivity({ ...good, sport: "swim" }, now)).toBe("That activity type isn't one this app knows.");
    expect(cleanManualActivity({ ...good, durationSec: 90_000 }, now)).toBe("A logged activity can be at most 24 hours long.");
  });
});
