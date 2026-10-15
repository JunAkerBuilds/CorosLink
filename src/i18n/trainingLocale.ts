export * from "./locale";
import { createTranslator } from "./locale";
import { trainingFrench } from "./fr/training";
import { trainingChinese } from "./zh-CN/training";
export const t = createTranslator(trainingFrench, trainingChinese);
