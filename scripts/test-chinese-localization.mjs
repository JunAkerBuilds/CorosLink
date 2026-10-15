import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { coreFrench } from '../src/i18n/fr/core.ts';
import { trainingFrench } from '../src/i18n/fr/training.ts';
import { toolsFrench } from '../src/i18n/fr/tools.ts';
import { watchfacesFrench } from '../src/i18n/fr/watchfaces.ts';
import { coreChinese } from '../src/i18n/zh-CN/core.ts';
import { trainingChinese } from '../src/i18n/zh-CN/training.ts';
import { toolsChinese } from '../src/i18n/zh-CN/tools.ts';
import { watchfacesChinese } from '../src/i18n/zh-CN/watchfaces.ts';
import { chineseMessages, initializeLanguage, getLanguage, getLocale, setLanguage, translate, t, subscribeLanguage, formatDate, formatNumber, LANGUAGE_STORAGE_KEY } from '../src/i18n/locale.ts';
import { backgroundElementLabel } from '../src/watchfaces/watchfaceBackgroundElements.ts';
import { nativeChinese } from '../electron/localizationChinese.ts';
import { preferredLanguage, resolveLanguage } from '../electron/appLanguage.ts';
import { t as trainingT } from '../src/i18n/trainingLocale.ts';
import { t as watchfaceT } from '../src/i18n/watchfacesLocale.ts';
import { t as toolsT } from '../src/i18n/toolsLocale.ts';
import { localizedText, renderLocalizedText } from '../src/i18n/messages.ts';
import { formatDistanceValue, formatWeightValue, formatSpeedValue, displayDistanceToMeters } from '../src/units/units.ts';
import { formatSleepClockRange } from '../src/training/formatters.ts';

const storage = new Map();
const nativeCalls = [];
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, corosLink: { setLanguage: async value => nativeCalls.push(value) } };
globalThis.document = { documentElement: { lang: '' } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['zh-Hans-CN', 'en-US'], language: 'zh-CN' } });
for (const locale of ['zh', 'zh-CN', 'ZH_cn', 'zh-SG', 'zh-Hans', 'zh-Hans-HK']) assert.equal(resolveLanguage(locale), 'zh-CN');
for (const locale of ['zh-TW', 'zh-Hant', 'zh-Hant-CN', 'zh-HK', 'zh-CNot', null, {}]) assert.equal(resolveLanguage(locale), 'en');
assert.equal(preferredLanguage(['de-DE', 'zh-CN']), 'zh-CN');
assert.equal(preferredLanguage(['en-CA', 'zh-CN']), 'en');
assert.equal(preferredLanguage(['fr-CA', 'zh-CN']), 'fr');
initializeLanguage();
assert.equal(getLanguage(), 'zh-CN');
assert.equal(getLocale(), 'zh-CN');
assert.equal(storage.get(LANGUAGE_STORAGE_KEY), 'zh-CN');
assert.equal(document.documentElement.lang, 'zh-CN');
assert.equal(t('Settings'), '设置');
assert.equal(trainingT('Weight'), '重量');
assert.equal(trainingT('Open'), '不限');
assert.equal(watchfaceT('Weight'), '字重');
const customText = { kind: 'text', text: 'Back $& 我的表盘' };
assert.equal(backgroundElementLabel(customText), '文字“Back $& 我的表盘”');
assert.equal(customText.text, 'Back $& 我的表盘');
assert.equal(watchfaceT('Current and Always-on layouts are preserved.'), '常规显示和息屏显示布局均已保留。');
assert.equal(trainingT('Stroke'), '泳姿');
assert.equal(watchfaceT('Stroke'), '描边');
assert.equal(toolsT('Open'), '打开');
assert.equal(toolsT('Open', undefined, 'workoutTarget'), '不限');
assert.equal(toolsT('Length', undefined, 'audio'), '时长');
for (const value of ['constructor', '__proto__', 'toString', 'Back $& 我的训练.fit']) assert.equal(t(value), value);
assert.equal(t('Delete "{{value0}}" locally?', { value0: '$& <b>Back 我的跑步</b>' }), '要从本机删除“$& <b>Back 我的跑步</b>”吗？');
assert.equal(translate('{{name}}/{{name}}/{{missing}}', 'zh-CN', { name: '$& {{literal}}' }), '$& {{literal}}/$& {{literal}}/{{missing}}');
assert.equal(translate('No translation', 'zh-CN'), 'No translation');
assert.equal(translate('Settings', 'zh-CN', undefined, {}), '设置');
assert.equal(translate('Settings', 'en', undefined, { Settings: '设置' }), 'Settings');
assert.equal(formatNumber(1234.5), '1,234.5');
assert.equal(formatDate(new Date(2026, 9, 15), { month: 'long' }), '十月');
assert.equal(formatDistanceValue(1250, 'metric'), '1.25 km');
assert.equal(formatWeightValue(72.5, 'metric'), '72.5 kg');
assert.equal(formatSpeedValue(12.5, 'metric'), '12.5 km/h');
assert.equal(displayDistanceToMeters(1.25, 'metric'), 1250);
assert.equal(formatSleepClockRange('22:30', '06:15'), '22:30 – 06:15');
const feedback = localizedText(() => t('Settings saved.'));
let notifications = 0;
const unsubscribe = subscribeLanguage(() => notifications++);
setLanguage('zh-CN');
assert.equal(notifications, 0);
setLanguage('fr');
assert.equal(renderLocalizedText(feedback), 'Paramètres enregistrés.');
setLanguage('zh-CN');
assert.equal(renderLocalizedText(feedback), '设置已保存。');
unsubscribe();
setLanguage('en');
assert.equal(notifications, 2);
initializeLanguage();
assert.equal(getLanguage(), 'en', 'saved English wins over Chinese system locale');
storage.set(LANGUAGE_STORAGE_KEY, 'zh-CN');
navigator.languages = ['fr-CA'];
initializeLanguage();
assert.equal(getLanguage(), 'zh-CN', 'saved Chinese wins over a French system locale');
navigator.languages = ['zh-CN'];
storage.set(LANGUAGE_STORAGE_KEY, 'invalid');
initializeLanguage();
assert.equal(getLanguage(), 'zh-CN', 'invalid saved preferences follow the system');
window.localStorage.getItem = () => { throw new Error('blocked'); };
window.localStorage.setItem = () => { throw new Error('blocked'); };
initializeLanguage();
assert.equal(getLanguage(), 'zh-CN');
assert.ok(nativeCalls.includes('zh-CN'));

for (const [domain, french, chinese] of [['core', coreFrench, coreChinese], ['training', trainingFrench, trainingChinese], ['tools', toolsFrench, toolsChinese], ['watchfaces', watchfacesFrench, watchfacesChinese]]) {
  for (const key of Object.keys(french)) assert.ok(Object.hasOwn(chinese, key), `Missing ${domain} message: ${key}`);
  for (const [key, text] of Object.entries(chinese)) {
    assert.ok(text.trim(), `Empty ${domain} message: ${key}`);
    assert.ok(!/ZXQ|QXZ|⟪\d+⟫/.test(text), `Translation artifact: ${key}`);
    const parameters = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]);
    const sourceParameters = [...key.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]);
    const pluralSuffixes = [...key.matchAll(/\b(?:track|download|workout|item|plan|file|PNG|label|sprite|state|group|time|song|set|digit|route|minute|hour|step|week|day|exercise)\{\{(\w+)\}\}/gi)].map(match => match[1]);
    if (key === '{{value1}} {{value2}}{{value3}} refreshed.') pluralSuffixes.push('value3');
    for (const parameter of sourceParameters) assert.ok(parameters.includes(parameter) || pluralSuffixes.includes(parameter), `Lost content interpolation ${parameter}: ${key}`);
    for (const parameter of parameters) assert.ok(sourceParameters.includes(parameter), `Unknown interpolation ${parameter}: ${key}`);
    const values = Object.fromEntries(sourceParameters.map(parameter => [parameter, '$& Back 训练']));
    assert.ok(!/\{\{\w+\}\}/.test(translate(key, 'zh-CN', values, chinese)), `Unresolved interpolation: ${key}`);
  }
}
const nativeSource = fs.readFileSync(new URL('../electron/localization.ts', import.meta.url), 'utf8');
const nativeCatalog = ts.createSourceFile('localization.ts', nativeSource, ts.ScriptTarget.Latest, true);
function nativeCoverage(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(nativeCatalog) === 'french' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) assert.ok(Object.hasOwn(nativeChinese, property.name.text), `Missing Chinese native message: ${property.name.text}`);
    }
  }
  ts.forEachChild(node, nativeCoverage);
}
nativeCoverage(nativeCatalog);
const packageConfig = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.ok(packageConfig.build.mac.extraResources.some(resource => resource.from === 'build/zh-Hans.lproj' && resource.to === 'zh-Hans.lproj'));
const permissionStrings = fs.readFileSync(new URL('../build/zh-Hans.lproj/InfoPlist.strings', import.meta.url), 'utf8');
for (const key of ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSLocalNetworkUsageDescription', 'NSLocationUsageDescription']) assert.ok(permissionStrings.includes(`"${key}" = "`));

// Traverse actual source calls so a new reachable screen cannot silently introduce
// an English fallback while catalog-parity tests continue to pass.
let translatedCalls = 0;
function audit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'i18n') audit(filename); continue; }
    if (!/\.tsx?$/.test(filename)) continue;
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        const context = node.arguments[2];
        const contextualKey = context && ts.isStringLiteral(context) ? `${context.text}:${key}` : key;
        assert.ok(!/[A-Za-z]{2}/.test(key) || Object.hasOwn(chineseMessages, contextualKey) || Object.hasOwn(chineseMessages, key), `Untranslated call ${filename}: ${contextualKey}`);
        translatedCalls++;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
audit(new URL('../src', import.meta.url).pathname);
console.log(`Chinese localization passed: ${Object.keys(chineseMessages).length} catalog keys, ${translatedCalls} source calls, preferences, scoped context, interpolation, feedback, dates and units.`);
