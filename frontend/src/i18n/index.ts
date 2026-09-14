/* i18next 初始化：react-i18next 绑定 + 浏览器语言探测。
   - 探测顺序：localStorage（键 crm-lang，与旧面板偏好兼容）→ 浏览器语言 → 兜底英文；
   - 仅支持 zh / en，其余语言代码（zh-TW 等）经 supportedLngs + load 归一到 zh；
   - interpolation.escapeValue 关闭：React 渲染已负责转义。 */

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zh from "./locales/zh";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    supportedLngs: ["zh", "en"],
    fallbackLng: "en",
    nonExplicitSupportedLngs: true, // zh-TW / en-GB 归一到 zh / en
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "crm-lang",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
