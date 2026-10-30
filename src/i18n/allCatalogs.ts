/**
 * Registers every language up front for Node tests and component harnesses
 * that switch languages synchronously. The app loads one language on demand
 * and must not import this module.
 */
import { registerLanguageCatalogs } from "./locale";
import spanish from "./es/catalogs";
import french from "./fr/catalogs";
import portuguese from "./pt/catalogs";
import chinese from "./zh-CN/catalogs";

registerLanguageCatalogs("es", spanish);
registerLanguageCatalogs("fr", french);
registerLanguageCatalogs("pt", portuguese);
registerLanguageCatalogs("zh-CN", chinese);

export const spanishMessages = { ...spanish.training, ...spanish.watchfaces, ...spanish.tools, ...spanish.core };
export const frenchMessages = { ...french.training, ...french.watchfaces, ...french.tools, ...french.core };
export const portugueseMessages = { ...portuguese.training, ...portuguese.watchfaces, ...portuguese.tools, ...portuguese.core };
export const chineseMessages = { ...chinese.training, ...chinese.watchfaces, ...chinese.tools, ...chinese.core };
