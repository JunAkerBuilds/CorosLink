import type { LanguageCatalogs } from "../locale";
import { coreSpanish } from "./core";
import { trainingSpanish } from "./training";
import { watchfacesSpanish } from "./watchfaces";
import { toolsSpanish } from "./tools";

/** Loaded on demand by `loadLanguage`; nothing else should import this module. */
const catalogs: LanguageCatalogs = { core: coreSpanish, training: trainingSpanish, watchfaces: watchfacesSpanish, tools: toolsSpanish };
export default catalogs;
