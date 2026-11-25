// Moved from CorosLink scripts/test-coros-watchface-service.mjs (c2ff5110): the assertions on the config, info.json
// and package rules that moved to desktop/watchface/archive. Account, gear and share-link checks stay in CorosLink
// until those services come over (docs/studio-port.md).
import assert from "node:assert/strict";
import {
  applyCorosWatchfaceConfigOverrides, extractDecimalProperty, finalizeCorosWatchfaceBarometerConfig,
  normalizeWatchfaceIdOverride, repairStandaloneBatteryConfigOverrides, setWatchfaceTemplateId, setWatchfaceTemplateName,
  stripBlankCorosWatchfaceConfigKeys, synthesizeScaledCorosAodConfig, validateConfigTextReplacements,
} from "../archive/config";
import { standardizeWatchfacePackage } from "../archive/distribution";
import { duplicateName as createDuplicateProjectName } from "../../main/watchface/studio";

const configWithoutWeather = "[time_hour_high_pos]={1,2}\r\n";
assert.equal(
  createDuplicateProjectName("Morning Run", []),
  "Morning Run copy"
);
assert.equal(
  createDuplicateProjectName("Morning Run", [
    "Morning Run copy",
    "morning run COPY 2"
  ]),
  "Morning Run copy 3",
  "duplicate names should be unique regardless of casing"
);
assert.equal(
  createDuplicateProjectName("Morning Run copy", ["Morning Run copy"]),
  "Morning Run copy 2",
  "duplicating an existing copy should increment the suffix"
);
assert.equal(
  createDuplicateProjectName("Morning Run copy 2", ["Morning Run copy 2"]),
  "Morning Run copy 3",
  "duplicating a numbered copy should continue from its suffix"
);
assert.equal(
  createDuplicateProjectName("x".repeat(80), []).length,
  80,
  "duplicate names must stay within the project-name limit"
);
assert.equal(
  setWatchfaceTemplateId(
    '{"o_template_id":251134,"o_diy_version":1}',
    "478814257230741704"
  ),
  '{"o_template_id":478814257230741704,"o_diy_version":1}',
  "template ID override must preserve IDs larger than Number.MAX_SAFE_INTEGER"
);
assert.throws(
  () => setWatchfaceTemplateId('{"o_template_id":251134}', "not-a-number"),
  /1–20 decimal digits/
);
assert.equal(normalizeWatchfaceIdOverride("54"), "54");
assert.equal(normalizeWatchfaceIdOverride("0x3B9ACE60"), "0x3B9ACE60");
assert.equal(
  normalizeWatchfaceIdOverride("0x26"),
  "0x00000026",
  "short hex watch-face IDs are padded to 8 digits like AODconfig"
);
assert.throws(
  () => normalizeWatchfaceIdOverride("not-an-id"),
  /32-bit decimal or 0x hex/
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[watchface_id]=0\r\n[time_hour_high_pos]={1,2}\r\n",
    { watchface_id: "0x3B9ACE60" }
  ),
  "[watchface_id]=0x3B9ACE60\r\n[time_hour_high_pos]={1,2}\r\n",
  "watch-face ID override must rewrite config.txt [watchface_id]"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[watchface_id]=0x00000026\r\n[background_icon]=background.png\r\n",
    { watchface_id: "0x3B9ACE60" }
  ),
  "[watchface_id]=0x3B9ACE60\r\n[background_icon]=background.png\r\n",
  "watch-face ID override must rewrite AODconfig.txt [watchface_id]"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[english_date_day_rect]={1,1,2,2}\n[english_date_day_font]=13x19\n[english_date_week_rect]={5,5,6,6}\n[germany_date_day_rect]={1,1,2,2}\n[chinese_tw_date_day_font]=13x19\n" +
      "[french_date_day_rect]={1,1,2,2}\n[germany_date_week_rect]={5,5,6,6}\n[control_germany_date_day_rect]={7,7,8,8}\n",
    { english_date_day_rect: "{9,9,40,20}", english_date_day_font: "studio\\day", french_date_day_rect: "{0,0,1,1}", english_date_week_rect: "{3,3,4,4}" }
  ),
  "[english_date_day_rect]={9,9,40,20}\n[english_date_day_font]=studio\\day\n[english_date_week_rect]={3,3,4,4}\n[germany_date_day_rect]={9,9,40,20}\n[chinese_tw_date_day_font]=studio\\day\n" +
    "[french_date_day_rect]={0,0,1,1}\n[germany_date_week_rect]={5,5,6,6}\n[control_germany_date_day_rect]={7,7,8,8}\n",
  "English month/day edits must reach every declared language table; weekday and control slots stay untouched"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[background_icon]=background.png\r\n",
    { watchface_id: "0x3B9ACE60" }
  ),
  "[background_icon]=background.png\r\n[watchface_id]=0x3B9ACE60\r\n",
  "watch-face ID override must append [watchface_id] when AOD omits it"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[bg_color]=0x000000\r\n",
    { background_icon_pos: "{0,0}", background_icon: "studio\\aod_background\\00.png" }
  ),
  "[bg_color]=0x000000\r\n[background_icon_pos]={0,0}\r\n[background_icon]=studio\\aod_background\\00.png\r\n",
  "independent AOD artwork may add a background to a color-only config"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[bg_color]=0x000000\r\n",
    {
      kcal_progress_arc: "{208,208,185,185,-135,135,10,0}",
      kcal_progress_arc_color: "0xFF8800",
      kcal_progress_rect: "{108,382,308,394,left|vcenter}",
      kcal_progress_color: "0xFF8800",
      exercise_progress_arc: "{208,208,166,166,-135,135,10,0}",
      exercise_progress_arc_color: "0x00CCFF",
      exercise_progress_rect: "{108,364,308,376,left|vcenter}",
      exercise_progress_color: "0x00CCFF"
    }
  ),
  "[bg_color]=0x000000\r\n[kcal_progress_arc]={208,208,185,185,-135,135,10,0}\r\n[kcal_progress_arc_color]=0xFF8800\r\n[kcal_progress_rect]={108,382,308,394,left|vcenter}\r\n[kcal_progress_color]=0xFF8800\r\n[exercise_progress_arc]={208,208,166,166,-135,135,10,0}\r\n[exercise_progress_arc_color]=0x00CCFF\r\n[exercise_progress_rect]={108,364,308,376,left|vcenter}\r\n[exercise_progress_color]=0x00CCFF\r\n",
  "native calorie and exercise progress keys must be appendable to sparse current and AOD configs"
);
assert.deepEqual(
  [...validateConfigTextReplacements([
    {
      path: "watchface_416x416/AODconfig.txt",
      text: "[watchface_id]=0x3B9ACE60\r\n"
    }
  ])],
  [["watchface_416x416/AODconfig.txt", "[watchface_id]=0x3B9ACE60\r\n"]],
  "config text replacements must accept AODconfig paths"
);
assert.throws(
  () =>
    validateConfigTextReplacements([
      { path: "watchface_416x416/missing.ini", text: "x" }
    ]),
  /existing template config file/
);
assert.throws(
  () =>
    validateConfigTextReplacements([
      {
        path: "watchface_416x416/config.txt",
        text: "a"
      },
      {
        path: "watchface_416x416/config.txt",
        text: "b"
      }
    ]),
  /duplicated config file/
);

assert.equal(
  setWatchfaceTemplateName(
    '{"m_name":"SLENDER","o_template_id":251134}',
    "TOP PART"
  ),
  '{"m_name":"TOP PART","o_template_id":251134}'
);
assert.throws(
  () => setWatchfaceTemplateName('{"m_name":"SLENDER"}', " "),
  /1–64 characters/
);
assert.deepEqual(
  repairStandaloneBatteryConfigOverrides(
    "[battery_icon_pos]={20,30}\r\n[battery_icon_dir]=\r\n",
    {},
    true
  ),
  { battery_icon_dir: "cl_battery_icon" },
  "a final Studio battery folder must be linked even if renderer overrides omit it"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[control_battery_icon_dir]=battery\r\n[control_step_icon]=icon\\step.png\r\n",
    { control_battery_icon_dir: "__COROSLINK_DELETE_CONFIG_KEY__" }
  ),
  "[control_step_icon]=icon\\step.png\r\n",
  "disabled selectable metrics must be removed instead of exported as blank pages"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[time_hour_high_pos]={1,2}\n[time_hour_high_pos]={3,4}\n",
    { time_hour_high_pos: "{5,6}" }
  ),
  "[time_hour_high_pos]={5,6}\n[time_hour_high_pos]={5,6}\n",
  "structured overrides must rewrite every duplicate raw-config declaration"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    weather_icon_pos: "{187,57}",
    weather_icon_dir: "weather"
  }),
  "[time_hour_high_pos]={1,2}\r\n[weather_icon_pos]={187,57}\r\n[weather_icon_dir]=weather\r\n",
  "confirmed optional weather keys should be appended without changing CRLF"
);
for (const newline of ["\n", "\r\n"]) {
  const statusOverrides = {
    bluetooth_off_icon: "studio\\bluetooth_off\\00.png",
    bluetooth_icon_pos: "{72,273}",
    bluetooth_on_icon: "studio\\bluetooth_on\\00.png",
    no_disturb_on_icon: "studio\\dnd_on\\00.png",
    no_disturb_off_icon: "studio\\dnd_off\\00.png",
    no_disturb_icon_pos: "{64,64}",
    airplane_icon: "studio\\airplane\\00.png",
    sleep_mode_icon: "studio\\sleep_mode\\00.png"
  };
  const baseline = `[time_hour_high_pos]={1,2}${newline}`;
  const result = applyCorosWatchfaceConfigOverrides(baseline, statusOverrides);
  assert.equal(
    result,
    baseline + Object.entries(statusOverrides)
      .map(([key, value]) => `[${key}]=${value}${newline}`).join(""),
    "Studio status icons and positions must export when absent from the template"
  );
  assert.equal(
    applyCorosWatchfaceConfigOverrides(result, statusOverrides),
    result,
    "reapplying status overrides must not duplicate declarations"
  );
}
const configWithSynthesizedBattery = applyCorosWatchfaceConfigOverrides(
  configWithoutWeather,
  {
    battery_icon_pos: "{20,30}",
    battery_icon_dir: "cl_battery_icon",
    battery_level_rect: "{10,40,90,60,hcenter|vcenter}",
    battery_level_font: "13x19",
    battery_level_font_color: "0xFFFFFF",
    control_step_font_color: "0x12ABEF",
    control_battery_level_font: "13x19",
    control_battery_level_font_color: "0x12ABEF"
  }
);

for (const expected of [
  "[battery_icon_pos]={20,30}",
  "[battery_icon_dir]=cl_battery_icon",
  "[battery_level_rect]={10,40,90,60,hcenter|vcenter}",
  "[battery_level_font]=13x19",
  "[battery_level_font_color]=0xFFFFFF",
  "[control_step_font_color]=0x12ABEF",
  "[control_battery_level_font]=13x19",
  "[control_battery_level_font_color]=0x12ABEF"
]) {
  assert.ok(
    configWithSynthesizedBattery.includes(expected),
    `confirmed Studio battery key should be appendable: ${expected}`
  );
}
const rawSavedResponse =
  '{"result":"0000","data":{"watchFaceTemplateId":478814257230741704}}';
assert.equal(
  extractDecimalProperty(rawSavedResponse, "watchFaceTemplateId"),
  "478814257230741704",
  "template IDs must remain lossless"
);
const configWithSynthesizedFixedMetrics = applyCorosWatchfaceConfigOverrides(
  configWithoutWeather,
  {
    heartreate_level_rect: "{20,40,80,64,hcenter|vcenter}",
    heartreate_level_font: "13x19",
    step_rect: "{90,40,180,64,hcenter|vcenter}",
    step_font: "13x19",
    kcal_rect: "{20,70,80,94,hcenter|vcenter}",
    kcal_font: "13x19",
    elevation_rect: "{90,70,180,94,hcenter|vcenter}",
    elevation_font: "13x19"
  }
);
for (const expected of [
  "[heartreate_level_rect]={20,40,80,64,hcenter|vcenter}",
  "[heartreate_level_font]=13x19",
  "[step_rect]={90,40,180,64,hcenter|vcenter}",
  "[step_font]=13x19",
  "[kcal_rect]={20,70,80,94,hcenter|vcenter}",
  "[kcal_font]=13x19",
  "[elevation_rect]={90,70,180,94,hcenter|vcenter}",
  "[elevation_font]=13x19"
]) {
  assert.ok(
    configWithSynthesizedFixedMetrics.includes(expected),
    `Studio fixed metric key should be appendable: ${expected}`
  );
}
assert.throws(
  () => applyCorosWatchfaceConfigOverrides(configWithoutWeather, { weather_typo: "x" }),
  /does not define: weather_typo/,
  "unknown config keys must still be rejected"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    control_temperature_rect: "{35,0,145,35,hcenter|vcenter}",
    control_temperature_font: "cl_ctemp",
    control_temperature_font_color: "0xFFFFFF",
    control_negative_sign_icon: "icon\\negative.png"
  }),
  "[time_hour_high_pos]={1,2}\r\n[control_temperature_rect]={35,0,145,35,hcenter|vcenter}\r\n[control_temperature_font]=cl_ctemp\r\n[control_temperature_font_color]=0xFFFFFF\r\n[control_negative_sign_icon]=icon\\negative.png\r\n",
  "confirmed control-temperature keys should be appendable"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    rect_control1_pos: "{0,0}",
    control_exercise_icon_pos: "{139,349}",
    control_exercise_icon: "studio\\exercise\\00.png",
    control_exercise_hour_rect: "{166,349,199,375,hcenter|vcenter}",
    control_exercise_minute_rect: "{216,349,248,375,hcenter|vcenter}",
    control_exercise_font: "02",
    control_exercise_font_color: ""
  }),
  [
    "[time_hour_high_pos]={1,2}",
    "[rect_control1_pos]={0,0}",
    "[control_exercise_icon_pos]={139,349}",
    "[control_exercise_icon]=studio\\exercise\\00.png",
    "[control_exercise_hour_rect]={166,349,199,375,hcenter|vcenter}",
    "[control_exercise_minute_rect]={216,349,248,375,hcenter|vcenter}",
    "[control_exercise_font]=02",
    "[control_exercise_font_color]=",
    ""
  ].join("\r\n"),
  "enabled missing Exercise controls should be appendable during archive export"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    exercise_hour_rect: "{140,300,205,340,hcenter|vcenter}",
    exercise_minute_rect: "{220,300,285,340,hcenter|vcenter}",
    exercise_font: "cl_exercise"
  }),
  [
    "[time_hour_high_pos]={1,2}",
    "[exercise_hour_rect]={140,300,205,340,hcenter|vcenter}",
    "[exercise_minute_rect]={220,300,285,340,hcenter|vcenter}",
    "[exercise_font]=cl_exercise",
    ""
  ].join("\r\n"),
  "fixed Exercise fields should be appendable during archive export"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    rect_control1_pos: "{0,0}",
    control_barometer_icon_pos: "{8,4}",
    control_barometer_down_icon: "icon\\coroslink_barometer_down.png",
    control_barometer_flat_icon: "icon\\coroslink_barometer_flat.png",
    control_barometer_up_icon: "icon\\coroslink_barometer_up.png",
    control_barometer_integer_rect: "{30,0,88,24,hcenter|vcenter}",
    control_barometer_decimal_rect: "{90,0,108,24,hcenter|vcenter}",
    control_barometer_font: "13x19",
    control_barometer_font_color: "",
    control_point_icon: "icon\\coroslink_control_point.png"
  }),
  [
    "[time_hour_high_pos]={1,2}",
    "[rect_control1_pos]={0,0}",
    "[control_barometer_icon_pos]={8,4}",
    "[control_barometer_down_icon]=icon\\coroslink_barometer_down.png",
    "[control_barometer_flat_icon]=icon\\coroslink_barometer_flat.png",
    "[control_barometer_up_icon]=icon\\coroslink_barometer_up.png",
    "[control_barometer_integer_rect]={30,0,88,24,hcenter|vcenter}",
    "[control_barometer_decimal_rect]={90,0,108,24,hcenter|vcenter}",
    "[control_barometer_font]=13x19",
    "[control_barometer_font_color]=",
    "[control_point_icon]=icon\\coroslink_control_point.png",
    ""
  ].join("\r\n"),
  "canonical barometer trend icons and split value rectangles should be appendable"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    rect_control1_pos: "{0,0}",
    control_barometer_icon_pos: "{8,4}",
    control_barometer_icon: "icon\\coroslink_barometer.png",
    control_barometer_rect: "{30,0,108,24,hcenter|vcenter}",
    control_barometer_font: "13x19",
    control_barometer_font_color: "",
    control_point_icon: "icon\\coroslink_control_point.png"
  }),
  [
    "[time_hour_high_pos]={1,2}",
    "[rect_control1_pos]={0,0}",
    "[control_barometer_icon_pos]={8,4}",
    "[control_barometer_icon]=icon\\coroslink_barometer.png",
    "[control_barometer_rect]={30,0,108,24,hcenter|vcenter}",
    "[control_barometer_font]=13x19",
    "[control_barometer_font_color]=",
    "[control_point_icon]=icon\\coroslink_control_point.png",
    ""
  ].join("\r\n"),
  "the experimental v4 static barometer branch should be appendable"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    temperature_rect: "{120,180,296,240,hcenter|vcenter}",
    temperature_font: "13x19",
    temperature_font_color: "0xFFFFFF",
    temperature_negative_sign_icon: "icon\\negative.png"
  }),
  "[time_hour_high_pos]={1,2}\r\n[temperature_rect]={120,180,296,240,hcenter|vcenter}\r\n[temperature_font]=13x19\r\n[temperature_font_color]=0xFFFFFF\r\n[temperature_negative_sign_icon]=icon\\negative.png\r\n",
  "confirmed fixed-temperature keys should be appendable"
);

assert.equal(
  stripBlankCorosWatchfaceConfigKeys(
    "//comment\r\n[control_step_rect]={1,2,3,4,hcenter|vcenter}\r\n[control_barometer_icon_pos]=\r\n[control_barometer_font]= \r\n\r\n[control_hr_font]=cl_control\r\n"
  ),
  "//comment\r\n[control_step_rect]={1,2,3,4,hcenter|vcenter}\r\n\r\n[control_hr_font]=cl_control\r\n",
  "blank [key]= lines should be removed; values, comments and spacing kept"
);
assert.equal(
  stripBlankCorosWatchfaceConfigKeys("[a]=1\n[b]=\n[c]=2\n"),
  "[a]=1\n[c]=2\n",
  "blank-key stripping should preserve LF newlines"
);

const completeDirectionalBarometer = [
  "[rect_control1_pos]={0,0}",
  "[control_barometer_icon_pos]={8,4}",
  "[control_barometer_down_icon]=icon\\down.png",
  "[control_barometer_flat_icon]=icon\\flat.png",
  "[control_barometer_up_icon]=icon\\up.png",
  "[control_barometer_integer_rect]={0,0,92,24,hcenter|vcenter}",
  "[control_barometer_decimal_rect]={96,0,119,24,hcenter|vcenter}",
  "[control_barometer_font]=13x19",
  "[control_barometer_font_color]=",
  "[control_point_icon]=icon\\point.png",
  ""
].join("\r\n");
assert.equal(
  finalizeCorosWatchfaceBarometerConfig(
    `${completeDirectionalBarometer}[control_barometer_icon]=\r\n[control_barometer_rect]=\r\n`
  ),
  completeDirectionalBarometer,
  "a complete directional branch should survive while blank static keys are removed"
);
assert.throws(
  () => finalizeCorosWatchfaceBarometerConfig(
    "[control_barometer_icon_pos]={8,4}\n[control_barometer_down_icon]=icon/down.png\n"
  ),
  /directional barometer config is incomplete/,
  "partial directional configs should be blocked before archive creation"
);
const completeStaticBarometer = [
  "[rect_control1_pos]={0,0}",
  "[control_barometer_icon_pos]={8,4}",
  "[control_barometer_icon]=icon\\static.png",
  "[control_barometer_rect]={0,0,119,24,hcenter|vcenter}",
  "[control_barometer_font]=13x19",
  "[control_barometer_font_color]=",
  "[control_point_icon]=icon\\point.png",
  ""
].join("\r\n");
assert.equal(
  finalizeCorosWatchfaceBarometerConfig(
    `${completeStaticBarometer}[control_barometer_down_icon]=\r\n[control_barometer_integer_rect]=\r\n`
  ),
  completeStaticBarometer,
  "a complete static branch should survive while blank directional keys are removed"
);
assert.throws(
  () => finalizeCorosWatchfaceBarometerConfig(
    `${completeStaticBarometer}[control_barometer_down_icon]=icon/down.png\n`
  ),
  /mixes Static and Directional parser branches/,
  "mixed barometer parser branches should be blocked before archive creation"
);

assert.equal(
  synthesizeScaledCorosAodConfig(
    [
      "[bg_color]=0x000000",
      "[watchface_id]=0x00000029",
      "[arc_cut_icon_pos]={132,163}",
      "[arc_cut_icon]=icon\\aod_cut.png",
      "[control_english_date_week_font]=aod_",
      "[time_hour_high_pos]={111,197}",
      "[time_hour_high_font]=aod_32x45",
      "[english_date_week_rect]={92,152,214,207,hcenter|vcenter}",
      "[english_date_week_font]=aod_english_week",
      "[kcal_progress_arc]={208,208,185,185,-135,135,10,0}",
      "[exercise_progress_arc]={208,208,166,166,-135,135,10,0}",
      "[empty_key]=",
      ""
    ].join("\r\n"),
    800 / 416,
    new Set([
      "watchface_800x800/icon/aod_cut.png",
      "watchface_800x800/32x45/00.png",
      "watchface_800x800/english_week/00.png"
    ]),
    "watchface_800x800"
  ),
  [
    "[bg_color]=0x000000",
    "[watchface_id]=0x00000029",
    "[arc_cut_icon_pos]={254,313}",
    "[arc_cut_icon]=icon\\aod_cut.png",
    "[time_hour_high_pos]={213,379}",
    "[time_hour_high_font]=32x45",
    "[english_date_week_rect]={177,292,412,398,hcenter|vcenter}",
    "[english_date_week_font]=english_week",
    "[kcal_progress_arc]={400,400,356,356,-135,135,19,0}",
    "[exercise_progress_arc]={400,400,319,319,-135,135,19,0}",
    "[empty_key]=",
    ""
  ].join("\r\n"),
  "AOD synthesis should scale coordinates, preserve arc angles/flags, remap aod_ assets and drop danglers"
);
{
  const conforming = standardizeWatchfacePackage([
    { name: "info.json", data: Buffer.from('{"m_name":"A","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_template_id":1,"o_diy_version":1}') },
    { name: "watchface_customize.png", data: Buffer.from("PNG") },
    { name: "watchface_800x800/config.txt", data: Buffer.from("") },
    { name: "watchface_800x800/watchface.bin", data: Buffer.from("cached build") },
    { name: "watchface_800x800/digits/Thumbs.db", data: Buffer.from("cache") },
    { name: "watchface_800x800/digits/PDF/0.pdf", data: Buffer.from("pdf") }
  ], ["watchface_800x800/", "watchface_800x800/digits/"]);
  assert.equal(conforming.changed, false);
  assert.deepEqual(conforming.removed, []);
  const staleApp = standardizeWatchfacePackage([
    { name: "info.json", data: Buffer.from('{"m_app":"watchface_800x800","m_preview":"thmb.png","o_template_id":7,"o_diy_version":1}') },
    { name: "watchface_customize.png", data: Buffer.from("PNG") },
    { name: "watchface_416x416/config.txt", data: Buffer.from("") },
    { name: "watchface_240x240/config.txt", data: Buffer.from("") }
  ], ["watchface_800x800/"], "Fallback name");
  assert.equal(staleApp.changed, true);
  assert.deepEqual(JSON.parse(staleApp.entries[0].data.toString("utf8")), {
    m_name: "Fallback name",
    m_app: "watchface_416x416",
    m_preview: "watchface_customize.png",
    o_template_id: 7,
    o_diy_version: 1
  });
  const strayDirectory = standardizeWatchfacePackage([
    { name: "info.json", data: Buffer.from('{"m_name":"A","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_template_id":1,"o_diy_version":1}') },
    { name: "watchface_customize.png", data: Buffer.from("PNG") },
    { name: "watchface_800x800/config.txt", data: Buffer.from("") }
  ], ["__MACOSX/"]);
  assert.equal(strayDirectory.changed, true, "Finder directory records force a rebuild");
  assert.deepEqual(strayDirectory.removed, []);

}
console.log("Config, info.json and package rules passed.");
