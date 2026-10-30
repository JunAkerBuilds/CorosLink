import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { coreFrench } from '../src/i18n/fr/core.ts';
import { trainingFrench } from '../src/i18n/fr/training.ts';
import { toolsFrench } from '../src/i18n/fr/tools.ts';
import { watchfacesFrench } from '../src/i18n/fr/watchfaces.ts';
import { corePortuguese } from '../src/i18n/pt/core.ts';
import { trainingPortuguese } from '../src/i18n/pt/training.ts';
import { toolsPortuguese } from '../src/i18n/pt/tools.ts';
import { watchfacesPortuguese } from '../src/i18n/pt/watchfaces.ts';
import { portugueseMessages } from '../src/i18n/allCatalogs.ts';
import { LANGUAGES, initializeLanguage, getLanguage, getLocale, setLanguage, translate, t, subscribeLanguage, formatDate, formatNumber, LANGUAGE_STORAGE_KEY } from '../src/i18n/locale.ts';
import { nativePortuguese } from '../electron/localizationPortuguese.ts';
import { preferredLanguage, resolveLanguage } from '../electron/appLanguage.ts';
import { t as trainingT } from '../src/i18n/trainingLocale.ts';
import { t as toolsT } from '../src/i18n/toolsLocale.ts';
import { localizedText, renderLocalizedText } from '../src/i18n/messages.ts';

const storage = new Map();
const nativeCalls = [];
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, corosLink: { setLanguage: async value => nativeCalls.push(value) } };
globalThis.document = { documentElement: { lang: '' } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['pt-BR', 'en-US'], language: 'pt-BR' } });

// Portuguese has one catalog, like French and Chinese: every Portuguese locale, Brazilian included, gets "pt" (European Portuguese).
for (const locale of ['pt', 'PT', 'pt-PT', 'pt_PT', 'pt-BR', 'pt_BR', 'pt-AO', 'pt-MZ']) assert.equal(resolveLanguage(locale), 'pt', locale);
for (const locale of ['ptx', 'por', 'gl-PT']) assert.equal(resolveLanguage(locale), 'en', locale);
assert.equal(resolveLanguage('es-PT'), 'es', 'Spanish in Portugal stays Spanish');
assert.equal(preferredLanguage(['de-DE', 'pt-PT', 'zh-CN']), 'pt');
assert.equal(preferredLanguage(['pt-BR', 'fr-FR']), 'pt');
assert.deepEqual(LANGUAGES.filter(entry => entry.value.startsWith('pt')).map(entry => [entry.value, entry.label]), [['pt', 'Português']]);

initializeLanguage();
assert.equal(getLanguage(), 'pt', 'a Brazilian system gets European Portuguese');
assert.equal(getLocale(), 'pt-PT', 'pt formats dates and numbers the European way');
assert.equal(storage.get(LANGUAGE_STORAGE_KEY), 'pt');
assert.equal(document.documentElement.lang, 'pt');
assert.ok(nativeCalls.includes('pt'));
assert.equal(t('Settings'), 'Definições');
assert.equal(formatNumber(1234.5), '1234,5');
assert.equal(formatDate(new Date(2026, 9, 15), { month: 'long' }), 'outubro', 'Intl prints lowercase months; catalogs cannot change that');
assert.notEqual(trainingT('Open'), toolsT('Open'));
for (const value of ['constructor', '__proto__', 'toString', 'Back $& o meu treino.fit']) assert.equal(t(value), value);
assert.equal(translate('{{name}}/{{name}}/{{missing}}', 'pt', { name: '$& {{literal}}' }), '$& {{literal}}/$& {{literal}}/{{missing}}');
assert.equal(translate('No translation', 'pt'), 'No translation');

// Live switching re-renders feedback without rebuilding it.
const feedback = localizedText(() => t('Settings saved.'));
let notifications = 0;
const unsubscribe = subscribeLanguage(() => notifications++);
setLanguage('pt');
assert.equal(notifications, 0);
assert.equal(renderLocalizedText(feedback), portugueseMessages['Settings saved.']);
setLanguage('en');
assert.equal(renderLocalizedText(feedback), 'Settings saved.');
setLanguage('pt');
assert.equal(renderLocalizedText(feedback), portugueseMessages['Settings saved.']);
unsubscribe();
assert.equal(notifications, 2);

// A saved choice wins over the system.
storage.set(LANGUAGE_STORAGE_KEY, 'en');
initializeLanguage();
assert.equal(getLanguage(), 'en', 'saved English wins over a Portuguese system');
storage.set(LANGUAGE_STORAGE_KEY, 'pt');
navigator.languages = ['fr-FR'];
initializeLanguage();
assert.equal(getLanguage(), 'pt', 'saved Portuguese wins over a French system');
for (const saved of ['pt-PT', 'pt-BR']) {
  storage.set(LANGUAGE_STORAGE_KEY, saved);
  initializeLanguage();
  assert.equal(getLanguage(), 'pt', `a saved ${saved} preference resolves to pt over a French system`);
}

// The catalog is European Portuguese, written before the 1990 Orthographic Agreement.
// JavaScript's \b treats accented letters as non-word characters, so word edges are spelled out.
const ao90Words = /(?<!\p{L})(?:atividades?|atua(?:l|is|lmente)|(?:des)?atualiz\p{L}*|(?:des|in|inter)?ativ(?:o|os|a|as|ar|ado|ada|ados|adas|e|ação)|aç(?:ão|ões)|seleciona\p{L}*|seleç(?:ão|ões)|direç(?:ão|ões)|coleç(?:ão|ões)|correç(?:ão|ões)|deteç(?:ão|ões)|detet\p{L}*|diret(?:o|os|a|as|amente)|objetos?|objetivos?|projet\p{L}+|trajetos?|aspetos?|respetiv\p{L}+|exat\p{L}+|ótim\p{L}+|elétric\p{L}+|noturn\p{L}+|tátil|seletor(?:es)?|carateres|(?:in)?corret(?:o|os|a|as|amente)|otimiz\p{L}*|eretor(?:es)?|exce(?:to|ç(?:ão|ões)|cional\p{L}*)|ret[âa]ngul\p{L}*|eletr\p{L}*|inspecion\p{L}*|pôr do sol)(?!\p{L})/iu;
// Pre-AO90 capitalises months and seasons, so only their lowercase forms are AO90.
const lowercaseMonths = /(?<!\p{L})(?:janeiro|fevereiro|março|abril|junho|julho|agosto|setembro|outubro|novembro|dezembro|primavera|outono)(?!\p{L})/u;
const ao90 = text => ao90Words.test(text) || lowercaseMonths.test(text);
for (const [domain, french, catalog] of [['core', coreFrench, corePortuguese], ['training', trainingFrench, trainingPortuguese], ['tools', toolsFrench, toolsPortuguese], ['watchfaces', watchfacesFrench, watchfacesPortuguese]]) {
  for (const key of Object.keys(french)) assert.ok(Object.hasOwn(catalog, key), `Missing ${domain} message: ${key}`);
  for (const [key, text] of Object.entries(catalog)) {
    assert.ok(text.trim(), `Empty ${domain} message: ${key}`);
    assert.ok(!/ZXQ|QXZ|⟪\d+⟫/.test(text), `Translation artifact: ${key}`);
    assert.ok(!ao90(text), `AO90 spelling in ${domain}: ${key} → ${text}`);
    const parameters = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]);
    const sourceParameters = [...key.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]);
    // Portuguese uses neutral forms like "faixa(s)" instead of English plural suffixes.
    const pluralSuffixes = [...key.matchAll(/\b(?:track|download|workout|item|plan|file|PNG|label|sprite|state|group|time|song|set|digit|route|minute|hour|step|week|day|exercise|model|book|session)\{\{(\w+)\}\}/gi)].map(match => match[1]);
    if (key === '{{value1}} {{value2}}{{value3}} refreshed.') pluralSuffixes.push('value3');
    for (const parameter of sourceParameters) assert.ok(parameters.includes(parameter) || pluralSuffixes.includes(parameter), `Lost content interpolation ${parameter}: ${key}`);
    for (const parameter of parameters) assert.ok(sourceParameters.includes(parameter), `Unknown interpolation ${parameter}: ${key}`);
    const values = Object.fromEntries(sourceParameters.map(parameter => [parameter, '$& Back treino']));
    assert.ok(!/\{\{\w+\}\}/.test(translate(key, 'pt', values, catalog)), `Unresolved interpolation: ${key}`);
  }
}

const nativeSource = fs.readFileSync(new URL('../electron/localization.ts', import.meta.url), 'utf8');
const nativeCatalog = ts.createSourceFile('localization.ts', nativeSource, ts.ScriptTarget.Latest, true);
function nativeCoverage(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(nativeCatalog) === 'french' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) assert.ok(Object.hasOwn(nativePortuguese, property.name.text), `Missing Portuguese native message: ${property.name.text}`);
    }
  }
  ts.forEachChild(node, nativeCoverage);
}
nativeCoverage(nativeCatalog);
for (const [key, text] of Object.entries(nativePortuguese)) assert.ok(!ao90(text), `AO90 spelling in native message: ${key} → ${text}`);
assert.ok(/\bpt: `/.test(nativeSource), 'Portuguese watch-removal and file-type dialogs');
const packageConfig = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.ok(packageConfig.build.mac.extraResources.some(resource => resource.from === 'build/pt.lproj' && resource.to === 'pt.lproj'));
const permissions = fs.readFileSync(new URL('../build/pt.lproj/InfoPlist.strings', import.meta.url), 'utf8');
for (const key of ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSLocalNetworkUsageDescription', 'NSLocationUsageDescription']) assert.ok(permissions.includes(`"${key}" = "`), key);
for (const line of permissions.split('\n').filter(line => line.startsWith('"'))) assert.ok(!ao90(line.split(' = ')[1]), `AO90 spelling in permission text: ${line}`);

// Traverse actual source calls so a new reachable screen cannot silently ship
// English in Portuguese while catalog-parity tests continue to pass.
let translatedCalls = 0;
function assertCovered(key, filename, context) {
  const contextualKey = context ? `${context}:${key}` : key;
  assert.ok(!/[A-Za-z]{2}/.test(key) || Object.hasOwn(portugueseMessages, contextualKey) || Object.hasOwn(portugueseMessages, key), `Untranslated Portuguese message ${filename}: ${contextualKey}`);
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
console.log(`Portuguese localization passed: ${Object.keys(portugueseMessages).length} catalog keys, ${translatedCalls} source calls, locale matching (Brazil included), saved preferences, live switching, interpolation, pre-AO90 spelling, native menus and permission prompts.`);
