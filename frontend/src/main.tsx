/* 入口：初始化 i18next（react-i18next）后挂载 React 根组件。
   全量样式在 styles/panel.css（旧面板样式整体迁移，含深浅主题令牌）。 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./styles/panel.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
