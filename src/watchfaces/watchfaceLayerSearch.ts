import { getLocale, t } from "../i18n/watchfacesLocale";

/** Section identities stay in the source language, independent of their labels. */
export function createCollapsedWatchfaceLayerSections(): Set<string> {
  return new Set(["Template assets", "Always-on assets"]);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase(getLocale())
    .trim();
}

/** Search the displayed name while retaining source-name and custom-name matches. */
export function watchfaceLayerMatchesSearch(label: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  return !normalizedQuery || [label, t(label)].some((value) =>
    normalizeSearchText(value).includes(normalizedQuery)
  );
}
