export * from "./locale";
import { createTranslator } from "./locale";
import { watchfacesFrench } from "./fr/watchfaces";
export const t = createTranslator(watchfacesFrench);
