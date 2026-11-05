import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { coreFrench } from '../src/i18n/fr/core.ts';
import { trainingFrench } from '../src/i18n/fr/training.ts';
import { toolsFrench } from '../src/i18n/fr/tools.ts';
import { watchfacesFrench } from '../src/i18n/fr/watchfaces.ts';
import { coreSpanish } from '../src/i18n/es/core.ts';
import { trainingSpanish } from '../src/i18n/es/training.ts';
import { toolsSpanish } from '../src/i18n/es/tools.ts';
import { watchfacesSpanish } from '../src/i18n/es/watchfaces.ts';
import { coreGerman } from '../src/i18n/de/core.ts';
import { trainingGerman } from '../src/i18n/de/training.ts';
import { toolsGerman } from '../src/i18n/de/tools.ts';
import { watchfacesGerman } from '../src/i18n/de/watchfaces.ts';
import { germanMessages } from '../src/i18n/allCatalogs.ts';
import { LANGUAGES, initializeLanguage, getLanguage, getLocale, setLanguage, translate, t, subscribeLanguage, formatDate, formatNumber, LANGUAGE_STORAGE_KEY } from '../src/i18n/locale.ts';
import { nativeGerman } from '../electron/localizationGerman.ts';
import { preferredLanguage, resolveLanguage } from '../electron/appLanguage.ts';
import { t as trainingT } from '../src/i18n/trainingLocale.ts';
import { t as toolsT } from '../src/i18n/toolsLocale.ts';
import { localizedText, renderLocalizedText } from '../src/i18n/messages.ts';

const storage = new Map();
const nativeCalls = [];
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, corosLink: { setLanguage: async value => nativeCalls.push(value) } };
globalThis.document = { documentElement: { lang: '' } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['de-CH', 'en-US'], language: 'de-CH' } });

// German has one catalog in standard German: every German locale, Austria and Switzerland included, gets "de".
for (const locale of ['de', 'DE', 'de-DE', 'de_DE', 'de-AT', 'de-CH', 'de_CH', 'de-LI', 'de-LU', 'de-BE', 'de-IT']) assert.equal(resolveLanguage(locale), 'de', locale);
for (const locale of ['dex', 'deu', 'dsb-DE', 'hsb-DE', 'nds-DE', 'gsw-CH', 'it-CH', 'rm-CH']) assert.equal(resolveLanguage(locale), 'en', locale);
assert.equal(preferredLanguage(['it-IT', 'de-AT', 'zh-CN']), 'de');
assert.equal(preferredLanguage(['de-CH', 'fr-CH']), 'de');
assert.equal(preferredLanguage(['fr-CH', 'de-CH']), 'fr');
assert.deepEqual(LANGUAGES.filter(entry => entry.value.startsWith('de')).map(entry => [entry.value, entry.label]), [['de', 'Deutsch']]);

initializeLanguage();
assert.equal(getLanguage(), 'de', 'a Swiss German system gets German');
assert.equal(getLocale(), 'de-DE', 'every German region formats like Germany, matching the catalog text');
assert.equal(storage.get(LANGUAGE_STORAGE_KEY), 'de');
assert.equal(document.documentElement.lang, 'de');
assert.ok(nativeCalls.includes('de'));
assert.equal(t('Settings'), 'Einstellungen');
assert.equal(formatNumber(12345.5), '12.345,5');
assert.equal(formatDate(new Date(2026, 9, 15), { month: 'long' }), 'Oktober');
assert.notEqual(trainingT('Open'), toolsT('Open'));
for (const value of ['constructor', '__proto__', 'toString', 'Back $& mein Training.fit']) assert.equal(t(value), value);
assert.equal(translate('{{name}}/{{name}}/{{missing}}', 'de', { name: '$& {{literal}}' }), '$& {{literal}}/$& {{literal}}/{{missing}}');
assert.equal(translate('No translation', 'de'), 'No translation');

// Live switching re-renders feedback without rebuilding it.
const feedback = localizedText(() => t('Settings saved.'));
let notifications = 0;
const unsubscribe = subscribeLanguage(() => notifications++);
setLanguage('de');
assert.equal(notifications, 0);
assert.equal(renderLocalizedText(feedback), germanMessages['Settings saved.']);
setLanguage('en');
assert.equal(renderLocalizedText(feedback), 'Settings saved.');
setLanguage('de');
assert.equal(renderLocalizedText(feedback), germanMessages['Settings saved.']);
unsubscribe();
assert.equal(notifications, 2);

// A saved choice wins over the system.
storage.set(LANGUAGE_STORAGE_KEY, 'en');
initializeLanguage();
assert.equal(getLanguage(), 'en', 'saved English wins over a German system');
storage.set(LANGUAGE_STORAGE_KEY, 'de');
navigator.languages = ['fr-FR'];
initializeLanguage();
assert.equal(getLanguage(), 'de', 'saved German wins over a French system');
for (const saved of ['de-DE', 'de-AT']) {
  storage.set(LANGUAGE_STORAGE_KEY, saved);
  initializeLanguage();
  assert.equal(getLanguage(), 'de', `a saved ${saved} preference resolves to de over a French system`);
}

// German covers every key Spanish does (Spanish is a superset of French).
for (const [domain, spanish, catalog] of [['core', coreSpanish, coreGerman], ['training', trainingSpanish, trainingGerman], ['tools', toolsSpanish, toolsGerman], ['watchfaces', watchfacesSpanish, watchfacesGerman]]) {
  for (const key of Object.keys(spanish)) assert.ok(Object.hasOwn(catalog, key), `Missing ${domain} message: ${key}`);
}
for (const [domain, french, catalog, spanish] of [['core', coreFrench, coreGerman, coreSpanish], ['training', trainingFrench, trainingGerman, trainingSpanish], ['tools', toolsFrench, toolsGerman, toolsSpanish], ['watchfaces', watchfacesFrench, watchfacesGerman, watchfacesSpanish]]) {
  for (const key of Object.keys(french)) assert.ok(Object.hasOwn(catalog, key), `Missing ${domain} message: ${key}`);
  for (const [key, text] of Object.entries(catalog)) {
    assert.ok(text.trim(), `Empty ${domain} message: ${key}`);
    assert.ok(!/ZXQ|QXZ|⟪\d+⟫/.test(text), `Translation artifact: ${key}`);
    // German quotation marks „…“, never the English closing ”.
    assert.ok(!text.includes('\u201D') && (!text.includes('\u201C') || text.includes('\u201E')), `English quotes in German text: ${key}`);
    // A copied Spanish sentence, not a shared single word such as Volumen.
    assert.ok(text !== spanish[key] || text === key.replace(/^[a-z][A-Za-z]*:(?=\S)/, '') || text.trim().split(/\s+/).length < 3, `Spanish text left in German: ${key}`);
    const parameters = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]);
    const sourceParameters = [...key.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]);
    // German may use neutral forms like "Titel" or "Training(s)" instead of English plural suffixes.
    const pluralSuffixes = [...key.matchAll(/\b(?:track|download|workout|item|plan|file|PNG|label|sprite|state|group|time|song|set|digit|route|minute|hour|step|week|day|exercise|model|book|session)\{\{(\w+)\}\}/gi)].map(match => match[1]);
    if (key === '{{value1}} {{value2}}{{value3}} refreshed.') pluralSuffixes.push('value3');
    for (const parameter of sourceParameters) assert.ok(parameters.includes(parameter) || pluralSuffixes.includes(parameter), `Lost content interpolation ${parameter}: ${key}`);
    for (const parameter of parameters) assert.ok(sourceParameters.includes(parameter), `Unknown interpolation ${parameter}: ${key}`);
    const values = Object.fromEntries(sourceParameters.map(parameter => [parameter, '$& Back Training']));
    assert.ok(!/\{\{\w+\}\}/.test(translate(key, 'de', values, catalog)), `Unresolved interpolation: ${key}`);
  }
}

const nativeSource = fs.readFileSync(new URL('../electron/localization.ts', import.meta.url), 'utf8');
const nativeCatalog = ts.createSourceFile('localization.ts', nativeSource, ts.ScriptTarget.Latest, true);
function nativeCoverage(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(nativeCatalog) === 'french' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) assert.ok(Object.hasOwn(nativeGerman, property.name.text), `Missing German native message: ${property.name.text}`);
    }
  }
  ts.forEachChild(node, nativeCoverage);
}
nativeCoverage(nativeCatalog);
assert.equal((nativeSource.match(/\bde: `/g) ?? []).length, 3, 'German watch-removal, bulk-removal and file-type dialogs');
const packageConfig = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.ok(packageConfig.build.mac.extraResources.some(resource => resource.from === 'build/de.lproj' && resource.to === 'de.lproj'));
const permissions = fs.readFileSync(new URL('../build/de.lproj/InfoPlist.strings', import.meta.url), 'utf8');
for (const key of ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSLocalNetworkUsageDescription', 'NSLocationUsageDescription']) assert.ok(permissions.includes(`"${key}" = "`), key);

// Traverse actual source calls so a new reachable screen cannot silently ship
// English in German while catalog-parity tests continue to pass.
let translatedCalls = 0;
function assertCovered(key, filename, context) {
  const contextualKey = context ? `${context}:${key}` : key;
  assert.ok(!/[A-Za-z]{2}/.test(key) || Object.hasOwn(germanMessages, contextualKey) || Object.hasOwn(germanMessages, key), `Untranslated German message ${filename}: ${contextualKey}`);
}
function audit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'i18n') audit(filename); continue; }
    if (!/\.tsx?$/.test(filename)) continue;
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const context = node.arguments[2];
        assertCovered(node.arguments[0].text, filename, context && ts.isStringLiteral(context) ? context.text : undefined);
        translatedCalls++;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
audit(new URL('../src', import.meta.url).pathname);
// These labels are read through t(variable), so literal-call coverage cannot see them.
for (const [filename, declarations] of [
  ['src/maps/routes/routeMakeupModel.ts', ['WAY_GROUPS', 'SURFACE_ROWS']],
  ['src/maps/routes/constants.ts', ['routeSurfaceOptions']],
  ['src/overview/OverviewBriefing.tsx', ['VERDICTS']],
  ['src/training/components/ActivityChannels.tsx', ['buildChannelSpecs']],
  ['src/onboarding/OnboardingTour.tsx', ['CHAPTERS']],
  ['src/training/sportColors.ts', ['SPORT_COLOR_LABELS']],
  ['src/calendar/weekSportBreakdown.ts', ['WEEK_SPORT_FAMILY_META']],
  ['src/training/components/PersonalRecordsPanel.tsx', ['PERIOD_LABELS', 'BOARD_LABELS']]
]) {
  const source = ts.createSourceFile(filename, fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const allProperties = declarations.includes('VERDICTS') || declarations.includes('SPORT_COLOR_LABELS') || declarations.includes('PERIOD_LABELS');
  function labels(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer) &&
        (allProperties || ['label', 'hint', 'foot', 'bike', 'body', 'title', 'eyebrow', 'lede'].includes(node.name.getText(source)))) {
      assertCovered(node.initializer.text, filename, declarations.includes('CHAPTERS') ? 'onboarding' : undefined);
    }
    if (ts.isCallExpression(node) && ['plain', 'runPace'].includes(node.expression.getText(source)) && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) {
      assertCovered(node.arguments[1].text, filename);
    }
    ts.forEachChild(node, labels);
  }
  function declarationsWithLabels(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && declarations.includes(node.name.getText(source))) labels(node);
    else ts.forEachChild(node, declarationsWithLabels);
  }
  declarationsWithLabels(source);
}
console.log(`German localization passed: ${Object.keys(germanMessages).length} catalog keys, ${translatedCalls} source calls, locale matching (Austria and Switzerland included), saved preferences, live switching, interpolation, native menus and permission prompts.`);
