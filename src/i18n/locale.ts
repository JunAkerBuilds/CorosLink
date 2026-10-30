import { preferredLanguage, resolveLanguage, supportedLanguage, type Language } from "../../electron/appLanguage";
export { resolveLanguage };
export type { Language };
export const LANGUAGE_STORAGE_KEY = "coroslink.language";
export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "pt", label: "Português" },
  { value: "zh-CN", label: "简体中文" },
] as const;

export type TranslatedLanguage = Exclude<Language, "en">;
export type TranslationDomain = "core" | "training" | "watchfaces" | "tools";
export type LanguageCatalogs = Readonly<Record<TranslationDomain, Readonly<Record<string, string>>>>;
type LoadedCatalogs = LanguageCatalogs & { readonly merged: Readonly<Record<string, string>> };

// Only the selected language's catalogs are loaded; each language is its own chunk.
const catalogLoaders: Record<TranslatedLanguage, () => Promise<{ default: LanguageCatalogs }>> = {
  es: () => import("./es/catalogs"),
  fr: () => import("./fr/catalogs"),
  pt: () => import("./pt/catalogs"),
  "zh-CN": () => import("./zh-CN/catalogs"),
};
const loadedCatalogs: Partial<Record<TranslatedLanguage, LoadedCatalogs>> = {};
const pendingCatalogs: Partial<Record<TranslatedLanguage, Promise<void>>> = {};
const NO_MESSAGES: Readonly<Record<string, string>> = Object.freeze({});

export function registerLanguageCatalogs(selected: TranslatedLanguage, catalogs: LanguageCatalogs): void {
  // Core wins over domain catalogs, matching the merged fallback order.
  const merged = { ...catalogs.training, ...catalogs.watchfaces, ...catalogs.tools, ...catalogs.core };
  loadedCatalogs[selected] = { ...catalogs, merged };
}

export function isLanguageLoaded(selected: Language): boolean {
  return selected === "en" || loadedCatalogs[selected] !== undefined;
}

export function loadLanguage(selected: Language): Promise<void> {
  if (isLanguageLoaded(selected)) return Promise.resolve();
  const translated = selected as TranslatedLanguage;
  return pendingCatalogs[translated] ??= catalogLoaders[translated]()
    .then(module => registerLanguageCatalogs(translated, module.default))
    .finally(() => { delete pendingCatalogs[translated]; });
}

/** The merged catalog of a loaded language; empty until it loads. */
export function getLanguageMessages(selected: Language): Readonly<Record<string, string>> {
  return selected === "en" ? NO_MESSAGES : loadedCatalogs[selected]?.merged ?? NO_MESSAGES;
}

let language: Language = "en";
const listeners = new Set<() => void>();

export function getLanguage(): Language { return language; }
// pt-PT even for Brazilian systems, so dates and numbers match the European Portuguese catalog.
export function getLocale(): string { return { en: "en-US", es: "es-ES", fr: "fr-FR", pt: "pt-PT", "zh-CN": "zh-CN" }[language]; }
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type Values = Record<string, string | number | null | undefined>;

export function translate(source: string, selected: Language, values?: Values, messages?: Readonly<Record<string, string>>, context?: string): string {
  const fallback = getLanguageMessages(selected);
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
export function createTranslator(domain: TranslationDomain) {
  return (source: string, values?: Values, context?: string): string =>
    translate(source, language, values, language === "en" ? undefined : loadedCatalogs[language]?.[domain], context);
}

let requestedLanguage: Language = "en";

function applyLanguage(next: Language): void {
  if (typeof document !== "undefined") document.documentElement.lang = next;
  const changed = language !== next;
  language = next;
  if (changed) listeners.forEach(listener => listener());
}

/**
 * Saves the preference at once. A language whose catalogs are already loaded
 * switches synchronously; otherwise the switch happens when they arrive, so
 * screens never show a half-translated mix.
 */
export function setLanguage(value: Language): Promise<void> {
  const next = resolveLanguage(value);
  requestedLanguage = next;
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Session-only preference. */ }
  if (typeof window !== "undefined") void window.corosLink?.setLanguage?.(next).catch(() => {
    // The renderer preference still works when an older preload is running.
  });
  if (isLanguageLoaded(next)) {
    applyLanguage(next);
    return Promise.resolve();
  }
  return loadLanguage(next).then(
    () => { if (requestedLanguage === next) applyLanguage(next); },
    (caught) => { console.error(`Could not load the ${next} translations.`, caught); },
  );
}

export function initializeLanguage(): Promise<void> {
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { /* Restricted storage. */ }
  const preferences = typeof navigator !== "undefined" ? navigator.languages?.length ? navigator.languages : [navigator.language] : ["en"];
  return setLanguage(supportedLanguage(stored) ?? preferredLanguage(preferences));
}

// Building an Intl formatter costs far more than formatting with one, and list
// rows format thousands of values per render. Keyed by locale and options.
const FORMATTER_CACHE_LIMIT = 200;
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter<T>(cache: Map<string, T>, options: object | undefined, create: (locale: string) => T): T {
  const locale = getLocale();
  const key = `${locale}|${options ? JSON.stringify(options) : ""}`;
  let formatter = cache.get(key);
  if (!formatter) {
    if (cache.size >= FORMATTER_CACHE_LIMIT) cache.clear();
    formatter = create(locale);
    cache.set(key, formatter);
  }
  return formatter;
}

export function getNumberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cachedFormatter(numberFormatters, options, locale => new Intl.NumberFormat(locale, options));
}

export function getDateTimeFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cachedFormatter(dateFormatters, options, locale => new Intl.DateTimeFormat(locale, options));
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return getNumberFormat(options).format(value);
}

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return getDateTimeFormat(options).format(value);
}
