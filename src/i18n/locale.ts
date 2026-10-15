import { coreFrench } from "./fr/core";
import { trainingFrench } from "./fr/training";
import { watchfacesFrench } from "./fr/watchfaces";
import { toolsFrench } from "./fr/tools";

export type Language = "en" | "fr";
export const LANGUAGE_STORAGE_KEY = "coroslink.language";
export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
] as const;

export const frenchMessages: Readonly<Record<string, string>> = {
  ...trainingFrench, ...watchfacesFrench, ...toolsFrench, ...coreFrench,
};
let language: Language = "en";
const listeners = new Set<() => void>();

export function resolveLanguage(value: unknown): Language {
  return typeof value === "string" && /^fr(?:[-_]|$)/i.test(value) ? "fr" : "en";
}

export function getLanguage(): Language { return language; }
export function getLocale(): string { return language === "fr" ? "fr-FR" : "en-US"; }
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type Values = Record<string, string | number | null | undefined>;

export function translate(source: string, selected: Language, values?: Values, messages: Readonly<Record<string, string>> = frenchMessages, context?: string): string {
  const key = context ? `${context}:${source}` : source;
  const localized = Object.hasOwn(messages, key) ? messages[key]
    : Object.hasOwn(frenchMessages, key) ? frenchMessages[key]
    : Object.hasOwn(messages, source) ? messages[source]
    : Object.hasOwn(frenchMessages, source) ? frenchMessages[source] : source;
  const message = selected === "fr" ? localized : source;
  // A callback keeps interpolation values literal, including $&, HTML and braces.
  return message.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) =>
    values && Object.hasOwn(values, key) ? String(values[key] ?? "") : placeholder);
}

export function t(source: string, values?: Values, context?: string): string {
  return translate(source, language, values, frenchMessages, context);
}

/** Context matters: a font's Weight and a workout's Weight use different words. */
export function createTranslator(messages: Readonly<Record<string, string>>) {
  return (source: string, values?: Values, context?: string): string => translate(source, language, values, messages, context);
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
  const preferred = typeof navigator !== "undefined" ? navigator.languages?.[0] ?? navigator.language : "en";
  setLanguage(resolveLanguage(stored ?? preferred));
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getLocale(), options).format(value);
}
