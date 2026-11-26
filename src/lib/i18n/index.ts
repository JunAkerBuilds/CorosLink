// The app's words in the athlete's language. English is written in the code and is the key: `t("Synced {time}",
// { time })` looks the English up in the chosen language's catalog (src/lib/i18n/<lang>/*.json) and falls back to
// the English when a line isn't translated yet. Works in the page and in the main process (no browser APIs here).

export type Lang = "en" | "es" | "de" | "pt-BR" | "zh-Hans";
/** What the athlete picked: a language, or whatever the system prefers. */
export type Choice = Lang | "system";
export type Catalog = Readonly<Record<string, string>>;
export type Vars = Readonly<Record<string, string | number>>;

/** The languages on offer, each named in itself. */
export const LANGUAGES: readonly { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "de", label: "Deutsch" },
  { id: "pt-BR", label: "Português" },
  { id: "zh-Hans", label: "简体中文" },
];

let current: Lang = "en";
let words: Catalog = {};

export const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.id === v);
export const isChoice = (v: unknown): v is Choice => v === "system" || isLang(v);

/** The language a choice comes to: the system's first preferred language the app has, else English. */
export function languageFor(choice: Choice, preferred: readonly string[]): Lang {
  if (choice !== "system") return choice;
  for (const tag of preferred) {
    const l = tag.toLowerCase();
    if (l === "en" || l.startsWith("en-")) return "en";
    if (l === "es" || l.startsWith("es-")) return "es";
    if (l === "de" || l.startsWith("de-")) return "de";
    if (l === "pt" || l.startsWith("pt-")) return "pt-BR";
    if (l === "zh" || l.startsWith("zh-")) return "zh-Hans";
  }
  return "en";
}

/** Puts a language's catalog in place. English needs none. */
export function setLanguageWords(lang: Lang, catalog: Catalog): void {
  current = lang;
  words = lang === "en" ? {} : catalog;
}

/** The language the app speaks now. */
export const language = (): Lang => current;

const fill = (text: string, vars?: Vars): string =>
  vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;

/** The English `text` in the app's language, with `{name}` filled from `vars`. */
export function t(text: string, vars?: Vars): string {
  return fill(words[text] ?? text, vars);
}

/**
 * Like `t`, for English that means different things in different places ("Run" the sport, "Run" the button): the
 * catalog key is `context|text`, and the plain `text` answers when that isn't there.
 */
export function tx(context: string, text: string, vars?: Vars): string {
  return fill(words[`${context}|${text}`] ?? words[text] ?? text, vars);
}

/**
 * Marks English kept in a table and translated where it's shown (`t(item.label)`), so the catalog check finds it.
 * Returns the English unchanged.
 */
export const msg = <S extends string>(text: S): S => text;

const TAGS: Record<Exclude<Lang, "en">, string> = { es: "es-ES", de: "de-DE", "pt-BR": "pt-BR", "zh-Hans": "zh-CN" };

/** The tag for dates and numbers: `english` ("en-GB", "en-US") while the app speaks English, else the language's. */
export function locale(english = "en-GB"): string {
  return current === "en" ? english : TAGS[current];
}
