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
