import type { LanguageCatalogs } from "../locale";
import { corePortuguese } from "./core";
import { trainingPortuguese } from "./training";
import { watchfacesPortuguese } from "./watchfaces";
import { toolsPortuguese } from "./tools";

/** Loaded on demand by `loadLanguage`; nothing else should import this module. */
const catalogs: LanguageCatalogs = { core: corePortuguese, training: trainingPortuguese, watchfaces: watchfacesPortuguese, tools: toolsPortuguese };
export default catalogs;
