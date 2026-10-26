import type { LanguageCatalogs } from "../locale";
import { coreFrench } from "./core";
import { trainingFrench } from "./training";
import { watchfacesFrench } from "./watchfaces";
import { toolsFrench } from "./tools";

/** Loaded on demand by `loadLanguage`; nothing else should import this module. */
const catalogs: LanguageCatalogs = { core: coreFrench, training: trainingFrench, watchfaces: watchfacesFrench, tools: toolsFrench };
export default catalogs;
