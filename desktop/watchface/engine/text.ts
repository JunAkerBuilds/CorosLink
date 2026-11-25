// The engine's words. C-LINK is in English for now, so this only fills in {{placeholders}}; when the app gets
// languages, this is the one place to hook them in.
type Values = Record<string, string | number | null | undefined>;

export function t(source: string, values?: Values): string {
  return source.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) =>
    values && Object.hasOwn(values, key) ? String(values[key] ?? "") : placeholder);
}

export const getLocale = (): string => "en-US";
