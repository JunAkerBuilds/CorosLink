import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { blankWatchfaceDesign } from "../watchface/engine/watchfaceBlankStart";
import { deriveEditorLayers } from "../watchface/engine/watchfaceEditorModel";
import { chartPageFillers, chartReadoutHidden, chartSourceOf } from "../watchface/engine/chartReadouts";
import { addChartPageField, addNativeField, chartPagesOnFace, libraryItems, type LibraryContext } from "./studioLibrary";
import { chartFixBlock, chartPageRows, chartStartOptions, chartStylesInUse, fixChartReadout, fixedChartReadouts, unfixChartReadout, nextChartPage, removeChartReadout, setChartPageOn, setChartReadout, showChartPage } from "./studioCharts";

/** A small template with no chart of its own: time at 800 and 416. */
function template(extra: Record<string, string> = {}): CorosWatchfaceTemplateDetails {
  const resolution = (width: number) => {
    const directory = `watchface_${width}x${width}`;
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `${directory}/digits/${String(i).padStart(2, "0")}.png`, width: 18, height: 28 }));
    return {
      directory, width, height: width,
      config: { background_icon: "background.png", time_hour_high_pos: "{150,300}", time_hour_high_font: "digits", ...extra },
      aodConfig: {},
      spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files }],
      icons: [{ path: `${directory}/background.png`, width, height: width }],
    };
  };
  return { templateId: "charts-test", resolutions: [resolution(800), resolution(416)] } as unknown as CorosWatchfaceTemplateDetails;
}

const details = template();
const face = { width: 800, height: 800 };
const ctxFor = (design: ReturnType<typeof makeDefaultDesign>, d = details): LibraryContext => ({ details: d, layers: deriveEditorLayers(d, design), face });
const blank = () => blankWatchfaceDesign({ ...makeDefaultDesign(), artwork: null }, details);
const startWith = (page: string) => addChartPageField(blank(), page, ctxFor(blank()));
const on = (design: ReturnType<typeof blank>, d = details) => chartPageRows(design, d).filter((r) => r.on).map((r) => r.id);
const row = (design: ReturnType<typeof blank>, id: string, d = details) => chartPageRows(design, d).find((r) => r.id === id)!;

describe("the chart's pages", () => {
  it("lists all six in Back order, numbered where on, and agrees with the Add library", () => {
    const design = startWith("sun");
    const rows = chartPageRows(design, details);
    expect(rows.map((r) => r.id)).toEqual(["barometer", "tide", "sun", "moon", "daily-a", "daily-b"]);
    expect(rows.map((r) => r.number)).toEqual([null, null, 1, null, null, null]);
    expect(rows.map((r) => r.graph)).toEqual(["bars", "bars", "line", "line", "none", "none"]);
    expect(on(design)).toEqual(chartPagesOnFace(design, details));
    expect(row(design, "sun")).toMatchObject({ shown: true, canShow: true, locked: true, label: "Sun" });
  });

  it("says what each page needs and what is optional", () => {
    const sun = row(startWith("sun"), "sun").readouts;
    expect(sun.map((r) => [r.source, r.required, r.state])).toEqual([["chart_sunrise", true, "shown"], ["chart_sun_angle", false, "missing"]]);
    const daily = row(startWith("daily-a"), "daily-a").readouts;
    expect(daily.every((r) => r.required && r.state === "shown" && r.hasFixedTwin)).toBe(true);
    expect(row(startWith("sun"), "sun").readouts[0]!.hasFixedTwin).toBe(false);
  });

  it("turning a page on brings the readouts the watch needs for it", () => {
    const design = setChartPageOn(startWith("sun"), "daily-b", true, details, face);
    expect(on(design)).toEqual(["sun", "daily-b"]);
    const chart = design.nativeData!.chart!;
    expect(chartPageFillers([chartSourceOf(chart), ...Object.keys(chart.readouts ?? {})])).toEqual([]);
    expect(chartPageRows(design, details).map((r) => r.locked)).toEqual([false, false, false, false, false, false]);
  });

  it("Barometer and Tide come and go together", () => {
    let design = setChartPageOn(startWith("sun"), "tide", true, details, face);
    expect(on(design)).toEqual(["barometer", "tide", "sun"]);
    expect(chartStylesInUse(chartPageRows(design, details))).toEqual({ line: true, bars: true });
    design = setChartPageOn(design, "barometer", false, details, face);
    expect(on(design)).toEqual(["sun"]);
    expect(design.nativeData!.chart!.chartStyle?.barWidth).toBe(0);
    expect(chartStylesInUse(chartPageRows(design, details))).toEqual({ line: true, bars: false });
  });

  it("the last page stays, and the pair counts as one", () => {
    const sun = startWith("sun");
    expect(setChartPageOn(sun, "sun", false, details, face)).toBe(sun);
    const bars = startWith("bars");
    expect(chartPageRows(bars, details).filter((r) => r.on).every((r) => r.locked)).toBe(true);
    expect(setChartPageOn(bars, "tide", false, details, face)).toBe(bars);
  });

  it("turning off the page on screen moves on to another, and keeps a hidden number when only bars are left", () => {
    let design = setChartPageOn(startWith("sun"), "moon", true, details, face);
    design = showChartPage(design, "moon");
    design = setChartPageOn(design, "moon", false, details, face);
    expect(on(design)).toEqual(["sun"]);
    expect(row(design, "sun").shown).toBe(true);

    let withBars = setChartPageOn(startWith("sun"), "barometer", true, details, face);
    withBars = setChartPageOn(withBars, "sun", false, details, face);
    expect(on(withBars)).toEqual(["barometer", "tide"]);
    const chart = withBars.nativeData!.chart!;
    expect(chartSourceOf(chart)).toBe("chart_baro");
    expect(chartReadoutHidden(chart)).toBe(true);
  });

  it("shows a page in the preview and steps like the Back button", () => {
    let design = setChartPageOn(startWith("sun"), "daily-a", true, details, face);
    expect(row(design, "daily-a").shown).toBe(true);
    design = showChartPage(design, "sun");
    expect(row(design, "sun").shown).toBe(true);
    expect(nextChartPage(chartPageRows(design, details))).toBe("daily-a");
    design = showChartPage(design, nextChartPage(chartPageRows(design, details))!);
    expect(nextChartPage(chartPageRows(design, details))).toBe("sun");
    expect(nextChartPage(chartPageRows(startWith("sun"), details))).toBeNull();
  });

  it("hides a needed readout without losing the page, adds and removes an optional one", () => {
    let design = setChartReadout(startWith("daily-a"), "chart_elevation", false, face);
    expect(row(design, "daily-a").readouts.map((r) => r.state)).toEqual(["shown", "shown", "hidden"]);
    expect(on(design)).toEqual(["daily-a"]);
    expect(removeChartReadout(design, "chart_elevation")).toBe(design);

    design = setChartReadout(startWith("sun"), "chart_sun_angle", true, face);
    expect(row(design, "sun").readouts.map((r) => r.state)).toEqual(["shown", "shown"]);
    design = removeChartReadout(design, "chart_sun_angle");
    expect(row(design, "sun").readouts.map((r) => r.state)).toEqual(["shown", "missing"]);
  });

  it("names the fields the watch hides on a page", () => {
    let design = startWith("sun");
    for (const id of ["weather_temp", "weather_wind"]) design = addNativeField(design, id, ctxFor(design));
    const ids = (list: { id: string }[]) => list.map((f) => f.id).sort();
    expect(ids(row(design, "sun").hides)).toContain("weather_temp");
    expect(ids(row(design, "sun").shows)).toContain("weather_wind");
    expect(ids(row(design, "daily-a").hides)).toContain("weather_wind");
    expect(ids(row(design, "daily-a").shows)).toContain("weather_temp");
  });

  it("a page only the template declares can be taken off the watch and brought back", () => {
    const font = (s: string) => ({ [`${s}_font`]: "digits", [`${s}_rect`]: "{0,0,40,20,left|vcenter}" });
    const withDaily = template({ ...font("chart_stress"), ...font("chart_stamina"), ...font("chart_elevation") });
    const start = blankWatchfaceDesign({ ...makeDefaultDesign(), artwork: null }, withDaily);
    let design = addChartPageField(start, "sun", ctxFor(start, withDaily));
    expect(row(design, "daily-a", withDaily).fromTemplate).toBe(true);
    design = setChartPageOn(design, "daily-a", false, withDaily, face);
    expect(design.chartPageModes).toEqual({ "daily-a": "removed" });
    expect(on(design, withDaily)).toEqual(["sun"]);
  });

  it("offers five ways to start, each a row of the Add library, with what the watch will hide", () => {
    let design = blank();
    for (const id of ["weather_temp", "weather_wind"]) design = addNativeField(design, id, ctxFor(design));
    const options = chartStartOptions(design, details);
    expect(options.map((o) => o.key)).toEqual(["chart:sun", "chart:moon", "chart:daily-a", "chart:daily-b", "chart:bars"]);
    const keys = new Set(libraryItems(design, ctxFor(design)).map((i) => i.key));
    expect(options.every((o) => keys.has(o.key))).toBe(true);
    const by = Object.fromEntries(options.map((o) => [o.key, o]));
    expect(by["chart:daily-a"]!.sub).toBe("Stress, stamina, elevation");
    expect(by["chart:sun"]!.hides.map((f) => f.id)).toContain("weather_temp");
    expect(by["chart:daily-b"]!.hides.map((f) => f.id)).toContain("weather_wind");
    expect(by["chart:bars"]!.note).toBe("Blank until the phone syncs");
    // Each starts the chart on that page.
    for (const o of options) expect(chartPageRows(addChartPageField(blank(), o.key.slice(6), ctxFor(blank())), details).some((r) => r.on)).toBe(true);
  });

  it("shows a readout on every page as the native field with its parts, and puts it back", () => {
    const start = startWith("daily-a");
    expect(chartFixBlock(start, details, "chart_stress")).toBeNull();
    expect(chartFixBlock(startWith("sun"), details, "chart_sunrise")).toBe("This one only lives on its page.");
    const fixed = fixChartReadout(start, "chart_stress", details);
    expect(fixed.nativeData!.stress).toMatchObject({ enabled: true });
    expect(fixed.nativeData!.chart!.removedReadouts).toEqual(["chart_stress"]);
    expect(chartSourceOf(fixed.nativeData!.chart!)).not.toBe("chart_stress");
    // The page stays (export fills stress in invisibly), and the row says where stress went.
    expect(on(fixed)).toEqual(["daily-a"]);
    expect(row(fixed, "daily-a").readouts.map((r) => r.state)).toEqual(["fixed", "shown", "shown"]);
    expect(fixedChartReadouts(chartPageRows(fixed, details))).toEqual([{ source: "chart_stress", label: "Stress", page: "Daily stats" }]);
    expect(chartFixBlock(fixed, details, "chart_stress")).not.toBeNull();
    // The field sits where the readout's number was.
    const before = start.nativeData!.chart!;
    expect(Math.abs(fixed.nativeData!.stress!.x - before.x)).toBeLessThan(200);

    const back = unfixChartReadout(fixed, "chart_stress");
    // As in CorosLink, the field it became stays on the face.
    expect(back.nativeData!.stress!.enabled).toBe(true);
    expect(back.nativeData!.chart!.removedReadouts).toBeUndefined();
    expect(row(back, "daily-a").readouts.map((r) => r.state)).toEqual(["shown", "shown", "shown"]);
  });

  it("makes steps, calories, elevation and heart rate fixed in the readout's own digit art, with the icon as an image", () => {
    const px = "data:image/png;base64,AAAA";
    let design = startWith("daily-b");
    const chart = design.nativeData!.chart!;
    // The readout carries digit art and an icon, as one from a template or an import does.
    const digits = Object.fromEntries(Array.from({ length: 10 }, (_, d) => [String(d), `${px}${d}`]));
    const withArt = (style: typeof chart) => ({ ...style, assets: { ...style.assets, digits, icon: { "0": `${px}i` } } });
    design = { ...design, nativeData: { ...design.nativeData, chart: chartSourceOf(chart) === "chart_kcal" ? withArt(chart)
      : { ...chart, readouts: { ...chart.readouts, chart_kcal: withArt(chart.readouts!.chart_kcal!) } } } };
    expect(chartFixBlock(design, details, "chart_kcal")).toBeNull();
    const art = { spriteId: "sprite-1", icon: { width: 24, height: 24 }, digit: { width: 20, height: 30 }, ink: { height: 0.8, baseline: 0.9 } };
    const fixed = fixChartReadout(design, "chart_kcal", details, art);

    expect(fixed.nativeData!.chart!.removedReadouts).toEqual(["chart_kcal"]);
    expect(fixed.metricChanges?.calories).toBe(true);
    const style = fixed.metricStyles!.calories!;
    expect(style.align).toBe("center");
    expect(style.fontSize).toBeUndefined();
    expect(style.rasterFont).toMatchObject({ label: "Calories chart digits", glyphs: "0123456789", columns: 10, tint: false });
    expect(Object.keys(style.rasterFont!.sprites!)).toHaveLength(10);
    expect(style.rasterFont!.sprites!["7"]).toBe(`${px}7`);
    expect(style.scale).toBeGreaterThanOrEqual(0.5);
    // The icon is its own image layer, named after the readout, where the readout's icon was.
    const sprite = fixed.designSprites!.at(-1)!;
    expect(sprite).toMatchObject({ id: "sprite-1", name: "Calories icon", dataUrl: `${px}i`, width: 24, height: 24, visible: true });
    // The number is on the face, and its page is still there.
    expect(deriveEditorLayers(details, fixed).find((l) => l.metricId === "calories")?.visible).toBe(true);
    expect(on(fixed)).toEqual(["daily-b"]);
    expect(chartFixBlock(fixed, details, "chart_kcal")).not.toBeNull();

    const back = unfixChartReadout(fixed, "chart_kcal");
    expect(back.nativeData!.chart!.removedReadouts).toBeUndefined();
    expect(back.metricChanges?.calories).toBe(true);
  });

  it("without measured art it still makes the number fixed, in the readout's font", () => {
    const fixed = fixChartReadout(startWith("daily-b"), "chart_heart_rate", details);
    expect(fixed.metricChanges?.heartRate).toBe(true);
    expect(fixed.metricStyles!.heartRate!.rasterFont).toBeUndefined();
    expect(fixed.designSprites ?? []).toHaveLength(startWith("daily-b").designSprites?.length ?? 0);
  });

  it("the chart's last readout can't leave it", () => {
    const bars = startWith("bars");
    expect(chartFixBlock(bars, details, "chart_baro")).toBe("The chart's last readout stays on it.");
    expect(fixChartReadout(bars, "chart_baro", details)).toBe(bars);
  });
});
