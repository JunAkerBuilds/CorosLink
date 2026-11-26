import { afterEach, describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { isLang, LANGUAGES, languageFor, locale, setLanguageWords, t, tx } from "./index";
import { tr } from "./react";

afterEach(() => setLanguageWords("en", {}));

describe("languageFor", () => {
  it("keeps a picked language", () => expect(languageFor("es", ["zh-CN"])).toBe("es"));
  it("follows the system's first language the app has", () => {
    expect(languageFor("system", ["fr-FR", "es-MX", "en-US"])).toBe("es");
    expect(languageFor("system", ["zh-CN"])).toBe("zh-Hans");
    expect(languageFor("system", ["zh-TW"])).toBe("zh-Hans");
    expect(languageFor("system", ["en-GB", "es"])).toBe("en");
  });
  it("maps German and Portuguese tags", () => {
    expect(languageFor("system", ["de-AT"])).toBe("de");
    expect(languageFor("system", ["de"])).toBe("de");
    expect(languageFor("system", ["pt-PT"])).toBe("pt-BR");
    expect(languageFor("system", ["pt"])).toBe("pt-BR");
    expect(languageFor("system", ["fr-FR", "pt-BR", "de-DE"])).toBe("pt-BR");
    expect(languageFor("de", ["pt-BR"])).toBe("de");
  });
  it("falls back to English", () => expect(languageFor("system", ["fr", "it"])).toBe("en"));
});

describe("t", () => {
  it("is the English, filled, with no catalog", () => expect(t("Synced {time}", { time: "07:12" })).toBe("Synced 07:12"));
  it("uses the catalog and falls back per line", () => {
    setLanguageWords("es", { "Synced {time}": "Sincronizado {time}" });
    expect(t("Synced {time}", { time: "07:12" })).toBe("Sincronizado 07:12");
    expect(t("Not translated")).toBe("Not translated");
  });
  it("leaves a placeholder with no value", () => expect(t("{a} and {b}", { a: 1 })).toBe("1 and {b}"));
  it("English ignores a catalog", () => {
    setLanguageWords("en", { Hello: "Hola" });
    expect(t("Hello")).toBe("Hello");
  });
});

describe("tx", () => {
  it("prefers the context's line, then the plain one", () => {
    setLanguageWords("es", { "sport|Run": "Carrera", Run: "Ejecutar" });
    expect(tx("sport", "Run")).toBe("Carrera");
    expect(tx("button", "Run")).toBe("Ejecutar");
  });
});

describe("tr", () => {
  it("puts elements where the placeholders are, in the translation's order", () => {
    setLanguageWords("zh-Hans", { "Plug in {watch} now": "现在插入{watch}" });
    const out = tr("Plug in {watch} now", { watch: "手表" }) as ReactElement<{ children: unknown[] }>;
    expect(isValidElement(out)).toBe(true);
    expect(out.props.children).toEqual(["现在插入", "手表", ""]);
  });
});

describe("locale", () => {
  it("keeps the English tag in English", () => expect(locale("en-US")).toBe("en-US"));
  it("is the language's tag otherwise", () => {
    setLanguageWords("es", {});
    expect(locale("en-US")).toBe("es-ES");
    setLanguageWords("zh-Hans", {});
    expect(locale()).toBe("zh-CN");
    setLanguageWords("de", {});
    expect(locale()).toBe("de-DE");
    setLanguageWords("pt-BR", {});
    expect(locale("en-US")).toBe("pt-BR");
  });
});

describe("isLang", () => {
  it("knows every language on offer", () => {
    for (const l of LANGUAGES) expect(isLang(l.id)).toBe(true);
    expect(LANGUAGES.map((l) => l.id)).toEqual(["en", "es", "de", "pt-BR", "zh-Hans"]);
  });
  it("refuses the rest", () => {
    for (const v of ["pt", "de-DE", "fr", "", null, undefined, 1]) expect(isLang(v)).toBe(false);
  });
});
