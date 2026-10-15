import { useSyncExternalStore } from "react";
import { getLanguage, getLocale, setLanguage, subscribeLanguage } from "./locale";
export * from "./locale";

/** Subscribe each translated component, including memoized panels, without remounting it. */
export function useLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => "en" as const);
  return { language, locale: getLocale(), setLanguage };
}
