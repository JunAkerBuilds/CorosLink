import assert from "node:assert/strict";
import {
  attachWatchfaceFontSnapshots,
  collectWatchfaceFontUses,
  findMissingWatchfaceFonts,
  measureWatchfaceText,
  normalizeWatchfaceFontFamily,
  setWatchfaceCanvasFont,
  withoutWatchfaceFontSnapshots
} from "../src/watchfaces/watchfaceFontSnapshots.ts";

const baseDesign = {
  version: 1,
  fontFamily: "Futura",
  fontWeight: 500,
  fontStyle: "normal",
  metricStyles: {
    heartRate: { scale: 1 },
    steps: { scale: 1, fontFamily: "" }
  },
  timeStyles: {
    hours: { scale: 1, fontWeight: 700 },
    minutes: { scale: 1, fontFamily: "Avenir Next", fontStyle: "italic" }
  },
  dateStyles: { dateWeek: { scale: 1, fontFamily: "'Didot', serif" } },
  staticSeparators: {
    colon: { enabled: true, x: 0, y: 0, size: 40, color: "#fff" },
    dateSlash: { enabled: false, x: 0, y: 0, size: 40, color: "#fff", fontFamily: "Unused Face" }
  },
  backgroundElements: [
    { id: "t", kind: "text", text: "Run", fontFamily: "sans-serif", fontSize: 40, color: "#fff", weight: 400, align: "center", x: 0, y: 0 }
  ],
  modeDesigns: { aod: { timeStyles: { hours: { scale: 1, fontFamily: "Menlo" } } } },
  fontSnapshots: [{ family: "Futura" }]
};

const uses = collectWatchfaceFontUses(baseDesign);
const summary = uses.map((use) => `${use.usedBy}: ${use.family} ${use.weight} ${use.style}`);
// Component styles inherit the face-wide family and weight, as the renderers do.
assert.ok(summary.includes("Face-wide font: Futura 500 normal"));
assert.ok(summary.includes("Metrics: Futura 500 normal"));
assert.ok(summary.includes("Time: Futura 700 normal"));
assert.ok(summary.includes("Time: Avenir Next 500 italic"));
// Quoted family lists resolve to their first family.
assert.ok(summary.includes("Date: Didot 500 normal"));
// Separator glyphs are always drawn bold.
assert.ok(summary.includes("Separators: Futura 700 normal"));
assert.ok(summary.includes("Time (always-on): Menlo 500 normal"));
// An explicit "" selects a PNG font; disabled separators and generic families draw nothing local.
assert.ok(!uses.some((use) => use.family === "" || use.family === "Unused Face" || use.family === "sans-serif"));

assert.equal(normalizeWatchfaceFontFamily(' "Helvetica Neue" , Arial'), "Helvetica Neue");
assert.equal(normalizeWatchfaceFontFamily("system-ui"), "");
assert.equal(normalizeWatchfaceFontFamily(undefined), "");

// Snapshots never enter the editor's live design state.
assert.equal("fontSnapshots" in withoutWatchfaceFontSnapshots(baseDesign), false);
const plain = { version: 1, fontFamily: "" };
assert.equal(withoutWatchfaceFontSnapshots(plain), plain);

// Without a DOM nothing can be captured, so saving drops stale snapshots
// instead of writing ones the renderer could not verify.
const saved = await attachWatchfaceFontSnapshots(baseDesign);
assert.equal("fontSnapshots" in saved, false);
assert.equal(saved.fontFamily, "Futura");

// Without a DOM every family counts as drawable, and measuring falls through
// to the context untouched.
assert.deepEqual(findMissingWatchfaceFonts(baseDesign), []);
const context = {
  font: "10px sans-serif",
  textAlign: "left",
  textBaseline: "alphabetic",
  measureText: (text) => ({
    width: text.length * 10,
    actualBoundingBoxLeft: 1,
    actualBoundingBoxRight: text.length * 10 - 1,
    actualBoundingBoxAscent: 7,
    actualBoundingBoxDescent: 2
  })
};
setWatchfaceCanvasFont(context, { family: "Futura", size: 20 }, '20px "Futura"');
assert.equal(context.font, '20px "Futura"');
const metrics = measureWatchfaceText(context, "12");
assert.equal(metrics.width, 20);
assert.equal(metrics.actualBoundingBoxAscent, 7);

console.log("Watchface font snapshot tests passed");
