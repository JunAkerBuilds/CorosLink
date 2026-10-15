export * from "./locale";
import { createTranslator } from "./locale";
import { toolsFrench } from "./fr/tools";
import { toolsChinese } from "./zh-CN/tools";
export const t = createTranslator(toolsFrench, toolsChinese);
