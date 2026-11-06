import assert from "node:assert/strict";
import {
  addChartPage, chartDragSplit, chartGraphBounds, chartPageFillers, chartReadoutBounds, chartReadoutFolder, chartReadoutHidden, chartReadoutOnly, chartStoredReadout,
  dropChartReadout, moveChartGraph, moveChartReadout, newChartReadout, removeChartPage, setChartReadoutShown, storedChartReadouts, swapChartReadout
} from "../src/watchfaces/chartReadouts.ts";
import { defaultNativeDataStyle, nativePart } from "../src/watchfaces/nativeDataParts.ts";

// A chart added in Studio: stress, default parts, graph below the number.
const layer = { ...defaultNativeDataStyle("chart"), x: 280, y: 311 };
const plotOnFace = style => {
  const plot = nativePart("chart", style, "plot");
  return { x: style.x + plot.x * style.scale, y: style.y + plot.y * style.scale, width: plot.width * style.scale, height: plot.height * style.scale };
};
const graph = plotOnFace(layer);

// Stamina shares the first daily page: it goes beside stress, not on top of it.
const stamina = newChartReadout(layer, "chart_stamina", { width: 800, height: 800 });
assert.equal(stamina.chartSource, "chart_stamina");
assert.deepEqual(chartReadoutBounds(stamina), { x0: 428, y0: 311, x1: 564, y1: 359 }, "Stamina sits right of stress with a gap");
assert.equal(stamina.assets, undefined, "A new readout gets its own generated icon");

const two = swapChartReadout(layer, stamina);
assert.equal(two.chartSource, "chart_stamina", "The layer edits the new readout");
assert.deepEqual(Object.keys(two.readouts), ["chart_stress"], "Stress is stored, not replaced");
assert.deepEqual(plotOnFace(two), graph, "The shared graph stays where it was");
assert.deepEqual(chartReadoutBounds(two), chartReadoutBounds(stamina), "The edited readout stays where it was placed");
assert.deepEqual(chartReadoutBounds(two.readouts.chart_stress), chartReadoutBounds(layer), "The stored readout keeps its place");
assert.ok(Object.values(two.parts).every(part => part.x === undefined || part.x >= 0), "Part offsets stay nonnegative");

// Elevation is the page's lower slot: below both.
const three = swapChartReadout(two, newChartReadout(two, "chart_elevation", { width: 800, height: 800 }));
assert.deepEqual(chartReadoutBounds(three), { x0: 280, y0: 371, x1: 416, y1: 419 }, "Elevation goes below the page's readouts");
assert.deepEqual(Object.keys(three.readouts).sort(), ["chart_stamina", "chart_stress"]);

// Barometer is a page of its own: it takes the edited readout's spot.
const baro = newChartReadout(three, "chart_baro");
assert.deepEqual(chartReadoutBounds(baro), chartReadoutBounds(three), "Another page reuses the same spot");

// Swapping back restores stress exactly, and the graph never moves.
const back = swapChartReadout(three, three.readouts.chart_stress);
assert.equal(back.chartSource, "chart_stress");
assert.deepEqual(chartReadoutBounds(back), chartReadoutBounds(layer));
assert.deepEqual(plotOnFace(back), graph);
assert.deepEqual(Object.keys(back.readouts).sort(), ["chart_elevation", "chart_stamina"]);

// Stored readouts are drawn and exported without a graph of their own.
const stored = storedChartReadouts(back);
assert.deepEqual(stored.map(item => item.chartSource).sort(), ["chart_elevation", "chart_stamina"]);
assert.ok(stored.every(item => ["plot", "background", "mask", "noDataMask"].every(part => item.parts[part].enabled === false)));
assert.deepEqual(storedChartReadouts({ ...back, removedReadouts: ["chart_stamina"] }).map(item => item.chartSource), ["chart_elevation"], "Made-fixed readouts leave their page");

// Removing: a stored one just goes; the edited one hands over to a stored one.
assert.deepEqual(Object.keys(dropChartReadout(back, "chart_stamina").readouts), ["chart_elevation"]);
const dropped = dropChartReadout(back, "chart_stress");
assert.equal(dropped.chartSource, "chart_stamina");
assert.deepEqual(Object.keys(dropped.readouts), ["chart_elevation"]);
assert.deepEqual(plotOnFace(dropped), graph);
assert.equal(dropChartReadout(layer, "chart_stress"), null, "The last readout can't go");
assert.equal(dropChartReadout({ ...back, removedReadouts: ["chart_stamina", "chart_elevation"] }, "chart_stress"), null, "Made-fixed readouts don't count");

// Graph styling and artwork stay with the layer, not the stored readout.
const styled = { ...layer, color: "#ff0000", chartStyle: { barWidth: 6 }, assets: { background: { 0: "data:image/png;base64,AA==" } }, parts: { background: { enabled: true } } };
const swapped = swapChartReadout(styled, { ...newChartReadout(styled, "chart_baro"), color: "#00ff00" });
assert.equal(swapped.chartStyle.barWidth, 6);
assert.equal(swapped.assets.background[0], styled.assets.background[0]);
assert.equal(swapped.readouts.chart_stress.chartStyle, undefined, "Stored readouts carry no graph style");
assert.equal(swapped.readouts.chart_stress.assets, undefined, "Stored readouts carry no graph artwork");
assert.equal(nativePart("chart", swapped, "plot").color, "#ff0000", "The graph keeps its color under a differently colored readout");

// A readout at another scale re-expresses the graph in its own frame.
const big = { ...layer, scale: 1.5 };
const small = swapChartReadout(big, { ...chartReadoutOnly(layer), chartSource: "chart_baro", x: 100, y: 100 });
assert.deepEqual(plotOnFace(small), plotOnFace(big), "The graph keeps its size and place across scales");

assert.equal(chartReadoutFolder("chart_moon_percent"), "cl_nd_cr_moon_percent");

// Moving: the edited readout and the graph move apart; stored readouts stay.
const shifted = (box, dx, dy) => ({ x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy });
const movedReadout = moveChartReadout(two, two.x + 50, two.y + 20);
assert.deepEqual(chartReadoutBounds(movedReadout), shifted(chartReadoutBounds(two), 50, 20));
assert.deepEqual(plotOnFace(movedReadout), graph, "Dragging a readout leaves the graph");
assert.deepEqual(chartReadoutBounds(movedReadout.readouts.chart_stress), chartReadoutBounds(two.readouts.chart_stress));
const baroLayer = { ...layer, chartSource: "chart_baro" };
assert.equal(chartGraphBounds(layer), null, "A daily page draws no graph, so it has no graph box");
const plotBox = chartGraphBounds(baroLayer);
const movedGraph = moveChartGraph(baroLayer, plotBox.x0 + 15, plotBox.y0 - 300);
assert.deepEqual(chartGraphBounds(movedGraph), shifted(plotBox, 15, -300), "Dragging the graph moves only the graph, even above the readout");
assert.deepEqual(chartReadoutBounds(movedGraph), chartReadoutBounds(baroLayer));
assert.ok(Object.values(movedGraph.parts).every(part => part.x === undefined || part.x >= 0), "Offsets stay nonnegative after the graph moves above the readout");

// The drag preview splits the chart: only the grabbed part follows the pointer.
const movingHalf = chartDragSplit(two, "readout", true), stillHalf = chartDragSplit(two, "readout", false);
assert.ok(!nativePart("chart", movingHalf, "plot").enabled && movingHalf.readouts === undefined && nativePart("chart", movingHalf, "value").enabled);
assert.ok(nativePart("chart", stillHalf, "plot").enabled && !nativePart("chart", stillHalf, "value").enabled && stillHalf.readouts);

// Firmware page rules (PACE Pro 3.2008.0): a daily page needs all three readouts,
// the sun page a sunrise readout, the moon page a moonrise readout.
assert.deepEqual(chartPageFillers(["chart_stress", "chart_stamina", "chart_step", "chart_sunrise"]), ["chart_elevation", "chart_kcal", "chart_heart_rate"], "The user's face gets the three readouts T7 proved on the watch");
assert.deepEqual(chartPageFillers(["chart_stress", "chart_stamina", "chart_elevation"]), [], "A complete page and an empty one need nothing");
assert.deepEqual(chartPageFillers(["chart_sun_angle"]), ["chart_sunrise"]);
assert.deepEqual(chartPageFillers(["chart_moon_percent", "chart_baro"]), ["chart_moonrise"]);
assert.deepEqual(chartPageFillers(["chart_baro", "chart_tide", "chart_sunrise"]), [], "Bar pages depend on the bar width, not on readouts");
assert.deepEqual(chartPageFillers(["chart_stamina"]), ["chart_stress", "chart_elevation"], "A hidden readout of a page in use comes back invisibly");

// Pages: Add page brings a page's required readouts, edited from the first.
const face = { width: 800, height: 800 };
const daily = addChartPage(layer, "daily-b", face);
assert.equal(daily.chartSource, "chart_kcal");
assert.deepEqual(Object.keys(daily.readouts).sort(), ["chart_heart_rate", "chart_step", "chart_stress"]);
assert.deepEqual(plotOnFace(daily), graph, "Adding a page leaves the graph alone");
const sunPage = addChartPage(layer, "sun", face);
assert.equal(sunPage.chartSource, "chart_sunrise");

// Hide keeps the readout and its place; Show brings it back as it was.
const hid = setChartReadoutShown(daily, "chart_step", false);
assert.ok(chartReadoutHidden({ ...hid.readouts.chart_step, chartSource: "chart_step" }));
assert.deepEqual(storedChartReadouts(hid).map(item => item.chartSource).filter(source => source === "chart_step"), ["chart_step"], "A hidden readout stays stored");
const back2 = setChartReadoutShown(hid, "chart_step", true);
assert.deepEqual(chartReadoutBounds(back2.readouts.chart_step), chartReadoutBounds(daily.readouts.chart_step));
assert.ok(chartReadoutHidden(setChartReadoutShown(daily, "chart_kcal", false)), "The edited readout can be hidden too");
const shownNew = setChartReadoutShown(layer, "chart_elevation", true, face);
assert.equal(shownNew.chartSource, "chart_elevation", "Showing a slot the face lacks adds it and edits it");
// From a hidden edited readout, a new one still shows: its page turns on.
const hiddenStress = setChartReadoutShown(layer, "chart_stress", false);
const shownFromHidden = setChartReadoutShown(hiddenStress, "chart_elevation", true, face);
assert.equal(shownFromHidden.chartSource, "chart_elevation");
assert.equal(chartReadoutHidden(shownFromHidden), false, "A readout added beside a hidden one is shown");
// A stored readout without chartSource (AI-written) swaps in as its key, not stress.
const unsourced = { ...layer, readouts: { chart_baro: { ...chartReadoutOnly(layer), chartSource: undefined } } };
assert.equal(swapChartReadout(unsourced, chartStoredReadout(unsourced, "chart_baro")).chartSource, "chart_baro");
assert.equal(dropChartReadout(unsourced, "chart_stress")?.chartSource, "chart_baro", "Removing the edited readout moves on to the stored one");

// Remove page takes its Studio readouts off; the last page can't go.
const removed = removeChartPage(daily, "daily-b");
assert.deepEqual([removed.chartSource, ...Object.keys(removed.readouts ?? {})], ["chart_stress"]);
assert.equal(removeChartPage(layer, "daily-a"), null, "The chart keeps at least one page");
console.log("watchface chart readouts: ok");

// A page whose readouts are all hidden stays on: export fills its missing
// required readouts instead of dropping the page.
{
  assert.deepEqual(chartPageFillers([], ["chart_stress"]), ["chart_stress", "chart_stamina", "chart_elevation"], "Hidden stress keeps daily page A");
  assert.deepEqual(chartPageFillers(["chart_stress"], ["chart_stamina"]), ["chart_stamina", "chart_elevation"]);
  assert.deepEqual(chartPageFillers([]), [], "A face with no readouts adds no page");
}

// Template pages without a chart layer (SIMPLE 2607304: daily and sun
// readouts, no chart_rect), as the editor lists them and export writes them.
{
  const { templateChartPages, templateChartPageOverrides, onChartPageIds, removedChartPageKeys } = await import("../src/watchfaces/templateChartPages.ts");
  const { COROS_CONFIG_DELETE_VALUE: DELETE } = await import("../src/watchfaces/watchfaceStudio.ts");
  const digits = { folder: "recovered/group-13", kind: "digits", aod: false, files: Array.from({ length: 10 }, (_, i) => ({ path: `w/recovered/group-13/0${i}.png`, width: 20, height: 34 })) };
  const config = { chart_item3_bg: "item3.png", chart_item3_bg_pos: "{0,0}" };
  for (const source of ["chart_tide", "chart_baro", "chart_stress", "chart_stamina", "chart_elevation", "chart_kcal", "chart_step"]) {
    Object.assign(config, { [`${source}_font`]: "recovered\\group-13", [`${source}_rect`]: "{121,293,187,329,hcenter|vcenter}", [`${source}_icon_pos`]: "{77,293}" });
  }
  Object.assign(config, { chart_sunrise_font: "recovered\\group-13", chart_sunrise_hour_rect: "{172,346,218,380,hcenter|vcenter}", chart_sunrise_minute_rect: "{231,346,276,380,hcenter|vcenter}", chart_sunrise_icon_pos: "{129,346}" });
  const resolution = { config, directory: "w", icons: [], spriteFolders: [digits] };
  const pages = templateChartPages(resolution);
  assert.deepEqual(onChartPageIds(pages), ["sun", "daily-a"], "Sun and daily A are on; daily B lacks heart rate; no bars");
  assert.deepEqual(pages.map(page => page.id), ["barometer", "tide", "sun", "daily-a", "daily-b"], "Pages with readouts list even when off");
  assert.equal(pages.find(page => page.id === "daily-a").empty, false);

  const hidden = templateChartPages(resolution, { "daily-a": "hidden", sun: "removed" });
  assert.deepEqual(onChartPageIds(hidden), ["daily-a"]);
  assert.equal(hidden.find(page => page.id === "daily-a").empty, true, "A hidden page is on with nothing visible");

  // Codex's raw edit deleted every chart line: no page is left, so min/max can't draw.
  const bare = { ...resolution, config: {} };
  assert.deepEqual(templateChartPages(bare), []);
  assert.deepEqual(onChartPageIds(templateChartPages(bare, { "daily-a": "hidden" })), ["daily-a"], "A hidden daily page can be added from nothing");

  const blank = { icon: () => "cl_nd_blank_icon\\00.png", frames: folder => folder };
  const added = templateChartPageOverrides({}, { "daily-a": "hidden" }, blank);
  for (const source of ["chart_stress", "chart_stamina", "chart_elevation"]) {
    assert.equal(added[`${source}_font`], "cl_nd_chart_blank_digits");
    assert.equal(added[`${source}_rect`], "{0,0,8,4,left|vcenter}");
    assert.equal(added[`${source}_icon_pos`], "{0,0}", "The 4.9.9 parser needs the icon position");
  }
  const kept = templateChartPageOverrides(config, { "daily-a": "hidden" }, blank);
  assert.equal(kept.chart_stress_rect, undefined, "A template readout keeps its own rect");
  assert.equal(kept.chart_stress_font, "cl_nd_chart_blank_digits");
  assert.equal(kept.chart_item3_bg, "cl_nd_blank_icon\\00.png", "The daily divider hides with the only daily page");
  const removed = templateChartPageOverrides(config, { "daily-a": "removed" }, blank);
  assert.equal(removed.chart_stress_font, DELETE);
  assert.equal(removed.chart_item3_bg, DELETE, "The divider leaves with the last daily page");
  assert.equal(removed.chart_kcal_font, undefined, "Other pages' readouts stay");
  assert.equal(templateChartPages({ ...resolution, config: { ...config, chart_stress_font: "cl_nd_chart_blank_digits" } }).find(page => page.id === "daily-a").readouts[0].visible, false,
    "Studio's blank digits read back as an invisible readout");
  assert.ok(removedChartPageKeys({ sun: "removed" }).includes("chart_sunrise_font"));
}

// A turned-off chart layer clears every chart key, the template's own
// readouts too: hiding it takes all its pages off the watch (2LoT_v4test,
// chart off on chart_sun_angle, kept Sun + Daily A until 2026-11-06).
{
  const { templateChartPages, onChartPageIds, withoutTurnedOffChart, turnedOffChartKeys } = await import("../src/watchfaces/templateChartPages.ts");
  const config = { chart_rect: "{83,256,303,305,hcenter|vcenter}", chart_bar_width: "7", chart_sun_angle_font: "a", chart_sunrise_font: "b",
    chart_stress_font: "c", chart_stamina_font: "c", chart_elevation_font: "c", chart_tide_font: "c" };
  const resolution = { config, directory: "w", icons: [], spriteFolders: [] };
  assert.deepEqual(turnedOffChartKeys({ enabled: true, chartSource: "chart_sun_angle" }), []);
  const off = withoutTurnedOffChart(resolution, { enabled: false, chartSource: "chart_sun_angle" });
  assert.equal(off.config.chart_bar_width, undefined, "Turning the chart off clears the bars");
  assert.deepEqual(onChartPageIds(templateChartPages(off)), [], "No page of the template's stays on the watch");
  assert.equal(off.config.chart_stress_font, undefined, "The template's own readouts go too");
  assert.deepEqual(onChartPageIds(templateChartPages(off, { "daily-a": "hidden" })), ["daily-a"], "A page kept hidden on purpose stays");
}
