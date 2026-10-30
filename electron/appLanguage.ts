/** Canonical UI languages, shared by the renderer and native process. */
export type Language = "en" | "es" | "fr" | "pt" | "zh-CN";

export function supportedLanguage(value: unknown): Language | undefined {
  if (typeof value !== "string") return undefined;
  const locale = value.replaceAll("_", "-");
  if (/^en(?:-|$)/i.test(locale)) return "en";
  // One neutral Spanish catalog serves Spain and Latin America alike.
  if (/^es(?:-|$)/i.test(locale)) return "es";
  if (/^fr(?:-|$)/i.test(locale)) return "fr";
  // One Portuguese catalog, in European Portuguese, serves every Portuguese locale, Brazilian included.
  if (/^pt(?:-|$)/i.test(locale)) return "pt";
  // Do not silently present Simplified Chinese to Traditional Chinese locales.
  if (/^zh(?:-Hans(?:-|$)|-(?:CN|SG)(?:-|$)|$)/i.test(locale)) return "zh-CN";
  return undefined;
}

export function resolveLanguage(value: unknown): Language {
  return supportedLanguage(value) ?? "en";
}

export function preferredLanguage(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const supported = supportedLanguage(preference);
    if (supported) return supported;
  }
  return "en";
}
