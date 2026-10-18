export * from "./locale";
import { createTranslator } from "./locale";
import { watchfacesFrench } from "./fr/watchfaces";
import { watchfacesChinese } from "./zh-CN/watchfaces";
import { watchfacesPortuguese } from "./pt/watchfaces";
export const t = createTranslator(watchfacesFrench, watchfacesChinese, watchfacesPortuguese);
