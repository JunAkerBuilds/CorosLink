export * from "./locale";
import { createTranslator } from "./locale";
import { toolsFrench } from "./fr/tools";
export const t = createTranslator(toolsFrench);
