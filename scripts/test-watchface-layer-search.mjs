import assert from "node:assert/strict";
import { getLanguage, setLanguage } from "../src/i18n/locale.ts";
import { t } from "../src/i18n/watchfacesLocale.ts";
import {
  createCollapsedWatchfaceLayerSections,
  watchfaceLayerMatchesSearch
} from "../src/watchfaces/watchfaceLayerSearch.ts";

const previousLanguage = getLanguage();
try {
  setLanguage("en");
  assert.equal(watchfaceLayerMatchesSearch("Hours", " HOURS "), true);
  assert.equal(watchfaceLayerMatchesSearch("Hours", "heures"), false);
  const englishCollapsed = createCollapsedWatchfaceLayerSections();

  setLanguage("fr");
  assert.equal(t("Hours"), "Heures");
  assert.equal(watchfaceLayerMatchesSearch("Hours", "heures"), true);
  assert.equal(watchfaceLayerMatchesSearch("Hours", "hours"), true);
  assert.equal(watchfaceLayerMatchesSearch("Weather", "METEO"), true);
  assert.equal(watchfaceLayerMatchesSearch("Weather", "me\u0301te\u0301o"), true);
  assert.equal(watchfaceLayerMatchesSearch("Weekday", "jour de semaine"), true);
  assert.equal(watchfaceLayerMatchesSearch("Hours", "meteo"), false);
  assert.equal(watchfaceLayerMatchesSearch("Mon été 2026", "ETE 2026"), true);
  assert.equal(watchfaceLayerMatchesSearch("Hours", "  "), true);

  const frenchCollapsed = createCollapsedWatchfaceLayerSections();
  assert.deepEqual(frenchCollapsed, englishCollapsed);
  assert.equal(frenchCollapsed.has("Template assets"), true);
  assert.equal(frenchCollapsed.has("Always-on assets"), true);
  assert.equal(frenchCollapsed.has(t("Template assets")), false);
  frenchCollapsed.delete("Template assets");
  assert.equal(createCollapsedWatchfaceLayerSections().has("Template assets"), true);

  setLanguage("zh-CN");
  assert.equal(watchfaceLayerMatchesSearch("Hours", "小时"), true);
  assert.equal(watchfaceLayerMatchesSearch("Hours", "hours"), true);
  assert.equal(watchfaceLayerMatchesSearch("Weather", "天气"), true);
  assert.equal(watchfaceLayerMatchesSearch("Weekday", "星期"), true);
  assert.equal(watchfaceLayerMatchesSearch("我的夏天 2026", "夏天"), true);
  assert.deepEqual(createCollapsedWatchfaceLayerSections(), englishCollapsed);
  setLanguage("en");
  assert.equal(watchfaceLayerMatchesSearch("Hours", "heures"), false);
  assert.equal(watchfaceLayerMatchesSearch("Hours", "hours"), true);
} finally {
  setLanguage(previousLanguage);
}

console.log("Watchface layer search and collapse identity tests passed.");
