export * from "./locale";
import { createTranslator } from "./locale";
import { trainingFrench } from "./fr/training";
export const t = createTranslator(trainingFrench);
