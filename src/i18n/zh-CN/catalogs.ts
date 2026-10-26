import type { LanguageCatalogs } from "../locale";
import { coreChinese } from "./core";
import { trainingChinese } from "./training";
import { watchfacesChinese } from "./watchfaces";
import { toolsChinese } from "./tools";

/** Loaded on demand by `loadLanguage`; nothing else should import this module. */
const catalogs: LanguageCatalogs = { core: coreChinese, training: trainingChinese, watchfaces: watchfacesChinese, tools: toolsChinese };
export default catalogs;
