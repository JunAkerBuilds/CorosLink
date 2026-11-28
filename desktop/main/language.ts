// The main process speaks the page's language too: the menu, dialogs, and the lines the API sends back. Every
// catalog is bundled here (the main process isn't loaded on demand), and the page says which one is in use.
import { setLanguageWords, type Catalog, type Lang } from "@/lib/i18n";
import de from "@/lib/i18n/catalogs/de";
import es from "@/lib/i18n/catalogs/es";
import ptBR from "@/lib/i18n/catalogs/pt-BR";
import ptPT from "@/lib/i18n/catalogs/pt-PT";
import zhHans from "@/lib/i18n/catalogs/zh-Hans";

const CATALOGS: Record<Exclude<Lang, "en">, Catalog> = { es, de, "pt-BR": ptBR, "pt-PT": ptPT, "zh-Hans": zhHans };

export function applyLanguage(lang: Lang): void {
  setLanguageWords(lang, lang === "en" ? {} : CATALOGS[lang]);
}
