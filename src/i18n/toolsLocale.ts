export * from "./locale";
import { createTranslator } from "./locale";
import { toolsFrench } from "./fr/tools";
import { toolsChinese } from "./zh-CN/tools";
import { toolsPortuguese } from "./pt/tools";
export const t = createTranslator(toolsFrench, toolsChinese, toolsPortuguese);
