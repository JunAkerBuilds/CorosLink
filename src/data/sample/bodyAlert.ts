// The sample athlete's Body Alert: 26 calm nights, then two with sleeping heart rate up, as in the phone's screenshot.
import type { AlertNight, BodyAlertData } from "@/lib/bodyAlert";
import { SAMPLE_TODAY } from "../core";
import { dayKey } from "@/lib/format";
import { addDays, scatter } from "@/lib/health";

export function sampleBodyAlert(): BodyAlertData {
  const nights: AlertNight[] = [];
  for (let back = 27; back >= 0; back--) {
    const off = back <= 1;
    const hr = off ? 56.6 + (1 - back) * 0.4 : 54.2 + scatter(back, 31) * 1.6;
    const hrv = Math.log(off ? 79 : 80 + scatter(back, 32) * 9);
    const br = off ? 14.4 : 14.6 + scatter(back, 33) * 0.5;
    const zHr = (hr - 54.4) / 1.1;
    const cls: AlertNight["nightClass"] = back === 12 ? "noData" : off ? (back === 0 ? "strong" : "deviating") : zHr > 1 ? "deviating" : "normal";
    nights.push({
      day: dayKey(addDays(SAMPLE_TODAY, -back)),
      state: back === 0 ? "strain" : back === 1 ? "watch" : "normal",
      nightClass: cls,
      level: cls === "strong" ? 4.3 : cls === "deviating" ? 2.9 : Math.max(0.3, 1 + zHr * 0.6),
      signals: cls === "noData" ? [] : [
        { signal: "heart", channel: "sleepHR", value: hr, usual: 54.4, spread: 1.1, z: zHr },
        { signal: "hrv", channel: "lnRMSSD", value: hrv, usual: Math.log(80), spread: 0.09, z: (Math.log(80) - hrv) / 0.09 },
        { signal: "breathing", channel: "breathing", value: br, usual: 14.6, spread: 0.4, z: (br - 14.6) / 0.4 },
      ],
    });
  }
  return { on: true, state: "strain", nightsLearned: 14, nights };
}
