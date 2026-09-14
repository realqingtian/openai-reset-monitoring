/* 语言便捷 hook：从 i18next 解析出格式化用的 Lang（zh/en），
   供时间文案（ago()）等需要语言参数的工具函数使用。 */

import { useTranslation } from "react-i18next";
import type { Lang } from "../utils/format";

export function useLang(): Lang {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage?.toLowerCase().startsWith("zh") ? "zh" : "en";
}
