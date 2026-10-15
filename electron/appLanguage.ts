/** Canonical UI languages, shared by the renderer and native process. */
export type Language = "en" | "fr" | "zh-CN";

export function supportedLanguage(value: unknown): Language | undefined {
  if (typeof value !== "string") return undefined;
  const locale = value.replaceAll("_", "-");
  if (/^en(?:-|$)/i.test(locale)) return "en";
  if (/^fr(?:-|$)/i.test(locale)) return "fr";
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
