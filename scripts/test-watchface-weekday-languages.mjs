import assert from "node:assert/strict";
import { applyWeekdayLanguageOverrides } from "../src/watchfaces/watchfaceStudio.ts";
const files = Array.from({ length: 7 }, (_, i) => ({ path: `260/english_week/${String(i).padStart(2, "0")}.png`, width: 76, height: 35 }));
const withMetrics = { resolutions: [null, { directory: "260", width: 260, height: 260, config: {
  english_date_week_font: "english_week", english_date_week_rect: "{108,209,152,231,hcenter|vcenter}", english_date_week_font_color: "0xFFBD00"
}, spriteFolders: [{ folder: "english_week", kind: "week", files }] }] };
const sizedWeekdayComposition = { replacements: files.map((_, i) => ({ path: `260/cl_weekday/${String(i).padStart(2, "0")}.png`, dataUrl: `fixture-weekday-${i}` })), configOverrides: [{ path: "260/config.txt", values: { english_date_week_rect: "{108,209,152,231,hcenter|vcenter}" } }] };
  const localeResolution = structuredClone(withMetrics.resolutions[1]);
  const englishFolder = localeResolution.spriteFolders.find(
    ({ folder }) => folder === localeResolution.config.english_date_week_font
  );
  assert.ok(englishFolder);
  const frenchFolder = { ...englishFolder, folder: "french_week", files: englishFolder.files.map(
    (file, index) => ({ ...file, path: `${localeResolution.directory}/french_week/${String(index).padStart(2, "0")}.png` })
  ) };
  localeResolution.spriteFolders.push(frenchFolder);
  localeResolution.config.french_date_week_font = "french_week";
  localeResolution.config.french_date_week_rect = "{0,0,10,10,hcenter|vcenter}";
  localeResolution.config.french_date_week_font_color = "0x000000";
  const localeDetails = { archiveId: "locales", resolutions: [localeResolution] };
  for (const overwriteAllLanguages of [undefined, false]) {
    assert.equal(applyWeekdayLanguageOverrides(localeDetails, { weekday: { scale: 1, overwriteAllLanguages } }, sizedWeekdayComposition), sizedWeekdayComposition,
      "Default/off must preserve localized assets and configuration");
  }
  const allLanguages = applyWeekdayLanguageOverrides(localeDetails,
    { weekday: { scale: 1, width: 90, height: 36, overwriteAllLanguages: true } }, sizedWeekdayComposition);
  const localeConfig = allLanguages.configOverrides.at(-1).values;
  assert.equal(localeConfig.english_date_week_font, localeResolution.config.english_date_week_font);
  assert.equal(localeConfig.french_date_week_font, "french_week");
  assert.equal(localeConfig.french_date_week_rect, localeConfig.english_date_week_rect);
  assert.equal(localeConfig.french_date_week_font_color, "");
  for (const folder of [englishFolder, frenchFolder]) {
    for (let index = 0; index < 7; index++) {
      const replacement = allLanguages.replacements.find(({ path }) => path === folder.files[index].path);
      const source = sizedWeekdayComposition.replacements.find(({ path }) => path.endsWith(`/cl_weekday/${String(index).padStart(2, "0")}.png`));
      assert.equal(replacement.dataUrl, source.dataUrl);
      assert.equal(replacement.allowDimensionOverride, true);
    }
  }

const selectedFrench = applyWeekdayLanguageOverrides(localeDetails,
  { weekday: { scale: 1, overwriteLanguages: ["french"] } }, sizedWeekdayComposition);
assert.equal(selectedFrench.configOverrides.at(-1).values.french_date_week_font, "french_week");
const selectedMissing = applyWeekdayLanguageOverrides(localeDetails,
  { weekday: { scale: 1, overwriteLanguages: ["japanese"] } }, sizedWeekdayComposition);
assert.equal(selectedMissing.configOverrides.at(-1).values.french_date_week_font, undefined);
assert.ok(!selectedMissing.replacements.some(({ path }) => path.includes("/french_week/")));
const sharedDetails = structuredClone(localeDetails);
sharedDetails.resolutions[0].config.germany_date_week_font = "french_week";
const shared = applyWeekdayLanguageOverrides(sharedDetails,
  { weekday: { scale: 1, overwriteLanguages: ["french"] } }, sizedWeekdayComposition);
assert.equal(shared.configOverrides.at(-1).values.french_date_week_font, "cl_weekday_french");
assert.equal(shared.configOverrides.at(-1).values.germany_date_week_font, undefined);
assert.ok(!shared.replacements.some(({ path }) => path.includes("/french_week/")), "Preserve shared original folder for German");
assert.equal(shared.replacements.filter(({ path, create }) => path.includes("/cl_weekday_french/") && create).length, 7);
assert.equal(applyWeekdayLanguageOverrides(localeDetails,
  { weekday: { scale: 1, overwriteLanguages: [] } }, sizedWeekdayComposition), sizedWeekdayComposition);
console.log("Weekday language toggle checks passed");
