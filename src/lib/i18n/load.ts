"use client";
// The page's language: picked in Settings (kept in this browser) or the system's. The catalog loads before the first
// render, and only the one language in use is fetched.
import { createStore } from "@/data/local/store";
import { languageFor, setLanguageWords, type Catalog, type Choice, type Lang } from "./index";

export const languageStore = createStore<Choice>("language", "system");

const CATALOGS: Record<Exclude<Lang, "en">, () => Promise<{ default: Catalog }>> = {
  es: () => import("./catalogs/es"),
  de: () => import("./catalogs/de"),
  "pt-BR": () => import("./catalogs/pt-BR"),
  "zh-Hans": () => import("./catalogs/zh-Hans"),
};

/** The language this page should speak now. */
export const pageLanguage = (): Lang =>
  languageFor(languageStore.get(), typeof navigator === "undefined" ? [] : navigator.languages);

/** Loads the language's catalog and puts it in place. Call before the first render. */
export async function loadLanguage(): Promise<Lang> {
  const lang = pageLanguage();
  let catalog: Catalog = {};
  if (lang !== "en") {
    try { catalog = (await CATALOGS[lang]()).default; } catch { /* English rather than nothing */ }
  }
  setLanguageWords(lang, catalog);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  return lang;
}

/** Saves the choice and starts the page over in it, so every line (and every table built at load) is redrawn. */
export function chooseLanguage(choice: Choice): void {
  languageStore.set(choice);
  if (typeof location !== "undefined") location.reload();
}
