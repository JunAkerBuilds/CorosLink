export * from "./locale";
import { createTranslator } from "./locale";
import { trainingFrench } from "./fr/training";
import { trainingChinese } from "./zh-CN/training";
import { trainingPortuguese } from "./pt/training";
export const t = createTranslator(trainingFrench, trainingChinese, trainingPortuguese);
