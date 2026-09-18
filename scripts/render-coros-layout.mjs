#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";
const { PNG } = pngjs;

// This is an intentionally small reference renderer for recovered geometry,
// not an emulation of the watch firmware. Every sampled layer is logged.
export async function renderLayoutPreviews(layout, root) {
  const samples = {
    time: "06:23:35", month: "4", day: "17", weekdayFrame: 0,
    battery: "100", batteryFrame: 10, stamina: "100", staminaFrame: 10,
    heartRate: "68", temperature: "27", weatherFrame: 0, wind: "3", windDirectionFrame: 1,
    control: "sunset", controlHour: "19", controlMinute: "23",
    // NOMAD cycles chart_index % 5 groups; the catalog thumbnail shows the sun group.
    chartGroup: "sunrise", chartHour: "19", chartMinute: "20", sunAngle: "36", sunProgress: 0.3, modes: []
  };
  const chartGroups = { sunrise: ["sunrise", "sunAngle"], moonrise: ["moonrise", "moonPercent"], barometer: ["barometer"], tide: ["tide"], general: ["stress", "stamina", "elevation"] };
  const chartReadouts = chartGroups[samples.chartGroup] ?? [];
  const images = new Map();
  const assetMap = new Map(layout.assets.map((a) => [a.index, a]));
  const frame = async (reference, index = 0) => {
    const asset = assetMap.get(reference?.group);
    if (!asset) return null;
    const file = asset.files[Math.min(index, asset.files.length - 1)];
    if (!images.has(file)) images.set(file, PNG.sync.read(await fs.readFile(path.join(root, file))));
    return images.get(file);
  };
  for (const mode of layout.modes) {
    const output = new PNG({ width: layout.screen.width, height: layout.screen.height });
    for (let i = 3; i < output.data.length; i += 4) output.data[i] = 255;
    const log = { mode: mode.mode, rendered: [], skipped: [] };
    const byId = new Map(mode.elements.map((e) => [e.id, e]));
    const draw = (image, x, y) => {
      if (!image) return;
      x = Math.round(x); y = Math.round(y);
      for (let sy = 0; sy < image.height; sy++) {
        const dy = y + sy;
        if (dy < 0 || dy >= output.height) continue;
        for (let sx = 0; sx < image.width; sx++) {
          const dx = x + sx;
          if (dx < 0 || dx >= output.width) continue;
          const s = (sy * image.width + sx) * 4, d = (dy * output.width + dx) * 4;
          const alpha = image.data[s + 3] / 255;
          for (let c = 0; c < 3; c++) output.data[d + c] = Math.round(image.data[s + c] * alpha + output.data[d + c] * (1 - alpha));
        }
      }
    };
    const aligned = (images, rect, origin = { x: 0, y: 0 }) => {
      const visible = images.filter(Boolean);
      const w = visible.reduce((sum, image) => sum + image.width, 0), h = Math.max(0, ...visible.map((i) => i.height));
      let x = rect.x0 + origin.x + (rect.horizontal === "right" ? rect.x1 - rect.x0 - w : rect.horizontal === "center" ? (rect.x1 - rect.x0 - w) / 2 : 0);
      const y = rect.y0 + origin.y + (rect.vertical === "bottom" ? rect.y1 - rect.y0 - h : rect.vertical === "center" ? (rect.y1 - rect.y0 - h) / 2 : 0);
      for (const image of visible) { draw(image, x, y); x += image.width; }
      return { x: x - w, y, width: w, height: h };
    };
    const digits = async (element, value) => Promise.all([...value].map((digit) => frame(element.asset, Number(digit))));
    const values = {
      "battery.value": samples.battery, "stamina.value": samples.stamina,
      heartRate: samples.heartRate, "heartRate.legacy": samples.heartRate,
      "weather.temperature": samples.temperature, "weather.wind": samples.wind, "exercise.hours": "00", "exercise.minutes": "00",
      "control.sunset.hour": samples.controlHour, "control.sunset.minute": samples.controlMinute,
      "chart.sunrise.hour": samples.chartHour, "chart.sunrise.minute": samples.chartMinute, "chart.sunAngle.value": samples.sunAngle
    };
    // The sun angle shares the temperature slot; the watch shows one per group.
    if (chartReadouts.includes("sunAngle") && byId.get("chart.sunAngle.value")?.active) delete values["weather.temperature"];
    const timeValues = { hour_high: 0, hour_low: 6, minute_high: 2, minute_low: 3, second_high: 3, second_low: 5 };
    for (const element of mode.elements) {
      if (!element.active || element.kind === "resource") continue;
      if (element.control && element.control !== samples.control) { log.skipped.push({ id: element.id, reason: "different selectable control" }); continue; }
      if (element.chart && !chartReadouts.includes(element.chart)) { log.skipped.push({ id: element.id, reason: "different chart group" }); continue; }
      if (["chart.background", "chart.barMask", "chart.noDataMask", "chart.item3.background", "chart.item3.mask"].includes(element.id) && element.id !== "chart.background") {
        log.skipped.push({ id: element.id, reason: "chart mask / alternate chart layout" }); continue;
      }
      const origin = element.control ? mode.controlOrigin : { x: 0, y: 0 };
      if (element.kind === "combinedDate") {
        const first = await Promise.all([...samples.month].map((n) => frame(element.assets[0], Number(n))));
        const separator = await frame(element.assets[2]);
        const last = await Promise.all([...samples.day].map((n) => frame(element.assets[1], Number(n))));
        const bounds = aligned([...first, separator, ...last], element.rect);
        log.rendered.push({ id: element.id, sample: `${samples.month}/${samples.day}`, bounds, inferred: true });
        continue;
      }
      if (element.kind === "number") {
        let imgs;
        let sample = values[element.id];
        if (element.id === "date.english.week") { imgs = [await frame(element.asset, samples.weekdayFrame)]; sample = `frame ${samples.weekdayFrame}`; }
        else if (sample !== undefined) imgs = await digits(element, sample);
        else { log.skipped.push({ id: element.id, reason: "no preview sample / alternate language" }); continue; }
        const bounds = aligned(imgs, element.rect, origin);
        log.rendered.push({ id: element.id, sample, bounds });
        // Percent and degree glyphs are separate resources. Their placement is
        // a preview convention; only their pointer (not an XY pair) is stored.
        const suffixId = { "battery.value": "battery.percent", "stamina.value": "stamina.percent", "weather.temperature": "weather.unit", "chart.sunAngle.value": "chart.degree" }[element.id];
        if (suffixId && byId.has(suffixId)) {
          const suffix = await frame(byId.get(suffixId).asset);
          draw(suffix, bounds.x + bounds.width, bounds.y);
          log.rendered.push({ id: suffixId, placement: "inferred suffix after value" });
        }
        continue;
      }
      let index = 0;
      if (element.id.startsWith("time.") && element.id.slice(5) in timeValues) index = timeValues[element.id.slice(5)];
      else if (element.id === "battery.states") index = samples.batteryFrame;
      else if (element.id === "stamina.states") index = samples.staminaFrame;
      else if (element.id === "weather.day") index = samples.weatherFrame;
      else if (element.id === "weather.direction") index = samples.windDirectionFrame;
      else if (element.id === "chart.sunrise.icon" || element.id === "chart.moonrise.icon") { log.skipped.push({ id: element.id, reason: "sample shows the set icon" }); continue; }
      else if (!["background", "bluetooth.off", "doNotDisturb.on", "control.sunset.icon", "weather.windIcon", "chart.background", "chart.sunrise.setIcon", "chart.moonrise.setIcon"].includes(element.id) && !/^chart\.[a-zA-Z]+\.icon$/.test(element.id)) {
        log.skipped.push({ id: element.id, reason: "alternate state / no preview behavior" }); continue;
      }
      const x = element.position.x + origin.x, y = element.position.y + origin.y;
      draw(await frame(element.asset, index), x, y);
      log.rendered.push({ id: element.id, frame: index, x, y });
    }
    // Sample sun path inside the shared chart rectangle. The watch computes the
    // real curve from the day's sunrise/sunset; only geometry and colors are recovered.
    if (mode.chart && chartReadouts.includes("sunrise")) {
      const { rect, curvesWidth } = mode.chart;
      const width = rect.x1 - rect.x0, height = rect.y1 - rect.y0, horizon = rect.y0 + height * 0.55;
      const paint = (x, y, color, size) => {
        for (let dy = -Math.floor(size / 2); dy < Math.ceil(size / 2); dy++) for (let dx = -Math.floor(size / 2); dx < Math.ceil(size / 2); dx++) {
          const px = Math.round(x + dx), py = Math.round(y + dy);
          if (px < rect.x0 || px >= rect.x1 || py < rect.y0 || py >= rect.y1 || (dx * dx + dy * dy) * 4 > size * size + 1) continue;
          const d = (py * output.width + px) * 4;
          output.data[d] = (color >> 16) & 255; output.data[d + 1] = (color >> 8) & 255; output.data[d + 2] = color & 255;
        }
      };
      for (let x = rect.x0; x < rect.x1; x++) paint(x, horizon, mode.chart.curvesLowerColor, 1);
      for (let x = rect.x0; x < rect.x1; x++) {
        const t = (x - rect.x0) / width;
        const y = horizon - Math.cos((t - 0.5) * Math.PI * 2) * height * 0.42;
        paint(x, y, y <= horizon ? mode.chart.curvesUpperColor : mode.chart.curvesLowerColor, Math.max(1, curvesWidth));
      }
      const sunX = rect.x0 + width * samples.sunProgress;
      paint(sunX, horizon - Math.cos((samples.sunProgress - 0.5) * Math.PI * 2) * height * 0.42, 0x000000, 12);
      log.rendered.push({ id: "chart.curve", sample: `sun path, progress ${samples.sunProgress}`, rect, inferred: true });
    }
    // Shared colons between the recovered hour/minute rectangles.
    for (const [hourId, minuteId, colonId] of [["exercise.hours", "exercise.minutes", "colon"], ["control.sunset.hour", "control.sunset.minute", "control.colon"], ["chart.sunrise.hour", "chart.sunrise.minute", "chart.colon"], ["chart.moonrise.hour", "chart.moonrise.minute", "chart.colon"]]) {
      const hour = byId.get(hourId), minute = byId.get(minuteId), colon = byId.get(colonId);
      if (!hour?.active || !minute?.active || !colon) continue;
      const image = await frame(colon.asset);
      const origin = hour.control ? mode.controlOrigin : { x: 0, y: 0 };
      draw(image, (hour.rect.x1 + minute.rect.x0 - image.width) / 2 + origin.x,
        (hour.rect.y0 + hour.rect.y1 - image.height) / 2 + origin.y);
      log.rendered.push({ id: colonId, placement: "inferred between hour/minute rectangles" });
    }
    await fs.writeFile(path.join(root, `preview-${mode.mode}.png`), PNG.sync.write(output));
    samples.modes.push(log);
  }
  await fs.writeFile(path.join(root, "preview-samples.json"), `${JSON.stringify(samples, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: node scripts/render-coros-layout.mjs <layout.json>");
  const file = path.resolve(input);
  await renderLayoutPreviews(JSON.parse(await fs.readFile(file, "utf8")), path.dirname(file));
  console.log(`Rendered previews in ${path.dirname(file)}`);
}
