import type { LanguageCatalogs } from "../locale";
import { coreGerman } from "./core";
import { trainingGerman } from "./training";
import { watchfacesGerman } from "./watchfaces";
import { toolsGerman } from "./tools";

/** Loaded on demand by `loadLanguage`; nothing else should import this module. */
const catalogs: LanguageCatalogs = { core: coreGerman, training: trainingGerman, watchfaces: watchfacesGerman, tools: toolsGerman };
export default catalogs;
