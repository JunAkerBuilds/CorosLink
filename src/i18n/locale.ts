import { coreFrench } from "./fr/core";
import { trainingFrench } from "./fr/training";
import { watchfacesFrench } from "./fr/watchfaces";
import { toolsFrench } from "./fr/tools";

import { coreChinese } from "./zh-CN/core";
import { trainingChinese } from "./zh-CN/training";
import { watchfacesChinese } from "./zh-CN/watchfaces";
import { toolsChinese } from "./zh-CN/tools";

import { corePortuguese } from "./pt/core";
import { trainingPortuguese } from "./pt/training";
import { watchfacesPortuguese } from "./pt/watchfaces";
import { toolsPortuguese } from "./pt/tools";

import { preferredLanguage, resolveLanguage, supportedLanguage, type Language } from "../../electron/appLanguage";
export { resolveLanguage };
export type { Language };
export const LANGUAGE_STORAGE_KEY = "coroslink.language";
export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "pt", label: "Português" },
  { value: "zh-CN", label: "简体中文" },
] as const;

export const frenchMessages: Readonly<Record<string, string>> = {
  ...trainingFrench, ...watchfacesFrench, ...toolsFrench, ...coreFrench,
};
export const chineseMessages: Readonly<Record<string, string>> = {
  ...trainingChinese, ...watchfacesChinese, ...toolsChinese, ...coreChinese,
};
export const portugueseMessages: Readonly<Record<string, string>> = {
  ...trainingPortuguese, ...watchfacesPortuguese, ...toolsPortuguese, ...corePortuguese,
};
const mergedMessages = { fr: frenchMessages, pt: portugueseMessages, "zh-CN": chineseMessages } as const;
let language: Language = "en";
const listeners = new Set<() => void>();

export function getLanguage(): Language { return language; }
// pt-PT even for Brazilian systems, so dates and numbers match the European Portuguese catalog.
export function getLocale(): string { return { en: "en-US", fr: "fr-FR", pt: "pt-PT", "zh-CN": "zh-CN" }[language]; }
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type Values = Record<string, string | number | null | undefined>;

export function translate(source: string, selected: Language, values?: Values, messages?: Readonly<Record<string, string>>, context?: string): string {
  const fallback = selected === "en" ? frenchMessages : mergedMessages[selected];
  const catalog = messages ?? fallback;
  const key = context ? `${context}:${source}` : source;
  const localized = Object.hasOwn(catalog, key) ? catalog[key]
    : Object.hasOwn(fallback, key) ? fallback[key]
    : Object.hasOwn(catalog, source) ? catalog[source]
    : Object.hasOwn(fallback, source) ? fallback[source] : source;
  const message = selected !== "en" ? localized : source;
  // A callback keeps interpolation values literal, including $&, HTML and braces.
  return message.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) =>
    values && Object.hasOwn(values, key) ? String(values[key] ?? "") : placeholder);
}

export function t(source: string, values?: Values, context?: string): string {
  return translate(source, language, values, undefined, context);
}

/** Context matters: a font's Weight and a workout's Weight use different words. */
export function createTranslator(french: Readonly<Record<string, string>>, chinese: Readonly<Record<string, string>>, portuguese: Readonly<Record<string, string>>) {
  return (source: string, values?: Values, context?: string): string => translate(source, language, values, language === "zh-CN" ? chinese : language === "pt" ? portuguese : french, context);
}

export function setLanguage(value: Language): void {
  const next = resolveLanguage(value);
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Session-only preference. */ }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  const changed = language !== next;
  language = next;
  if (changed) listeners.forEach(listener => listener());
  if (typeof window !== "undefined") void window.corosLink?.setLanguage?.(next).catch(() => {
    // The renderer preference still works when an older preload is running.
  });
}

export function initializeLanguage(): void {
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { /* Restricted storage. */ }
  const preferences = typeof navigator !== "undefined" ? navigator.languages?.length ? navigator.languages : [navigator.language] : ["en"];
  setLanguage(supportedLanguage(stored) ?? preferredLanguage(preferences));
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getLocale(), options).format(value);
}
