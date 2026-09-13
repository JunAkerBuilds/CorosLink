import assert from "node:assert/strict";
import { fitGeneratedWatchfaceFontRects } from "../electron/watchfaceExportFontBounds.ts";

function pngHeader(width, height) {
  const b = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const root = "watchface_416x416";
const config = [
  "[background_icon]=background.png",
  "[step_font]=studio\\metric",
  "[step_rect]={82,234,155,253,left|vcenter}",
  "[exercise_font]=studio\\exercise",
  "[exercise_hour_rect]={187,389,216,401,left|vcenter}",
  "[control_sunset_font]=studio\\solar",
  "[control_sunset_hour_rect]={7,49,17,67,left|vcenter}",
  "[control_sunset_minute_rect]={36,49,46,67,left|vcenter}",
  "[english_date_day_font]=studio\\day",
  "[english_date_day_rect]={248,56,271,72,hcenter|vcenter}",
  "[temperature_font]=13x19",
  "[temperature_rect]={1,2,3,4,left|vcenter}",
  "[control_sunrise_hour_rect]=",
  "[elevation_font]=studio\\metric",
  "[elevation_rect]={100,100,120,120,right|bottom}"
].join("\r\n");
const entries = [
  { name: `${root}/config.txt`, data: Buffer.from(config) },
  ...[["metric",17,24],["exercise",13,18],["solar",10,18],["day",12,16]].map(([folder,w,h]) => ({
    name: `${root}/studio/${folder}/00.png`, data: pngHeader(w,h)
  })),
  { name: `${root}/13x19/00.png`, data: pngHeader(23,33) }
];
const result = fitGeneratedWatchfaceFontRects(entries);
const text = result[0].data.toString();
for (const line of [
  "[step_rect]={82,231,167,255,left|vcenter}",
  "[exercise_hour_rect]={187,386,216,404,left|vcenter}",
  "[control_sunset_hour_rect]={7,49,27,67,left|vcenter}",
  "[control_sunset_minute_rect]={36,49,56,67,left|vcenter}",
  "[english_date_day_rect]={247,56,271,72,hcenter|vcenter}",
  "[temperature_rect]={1,2,3,4,left|vcenter}",
  "[control_sunrise_hour_rect]=",
  "[elevation_rect]={35,96,120,120,right|bottom}"
]) assert.ok(text.split("\r\n").includes(line), line);
assert.deepEqual(fitGeneratedWatchfaceFontRects(result), result, "repair must be idempotent");
assert.equal(result[1], entries[1], "glyph bytes must remain untouched");
assert.equal(text.split("\r\n").length, config.split("\r\n").length);
console.log("Watchface export font bounds tests passed");
