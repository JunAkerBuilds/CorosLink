// The engine's words, in the app's language (src/lib/i18n): the English is the key, {{placeholders}} are filled here.
import { locale, t as translate } from "@/lib/i18n";

type Values = Record<string, string | number | null | undefined>;

export function t(source: string, values?: Values): string {
  return translate(source).replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) =>
    values && Object.hasOwn(values, key) ? String(values[key] ?? "") : placeholder);
}

export const getLocale = (): string => locale("en-US");
