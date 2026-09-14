# frontend/ — 面板前端（React 独立工程）

`bun create vite` 生成的 React + TypeScript 模板为底，包管理用 **bun**。
UI 动画组件来自 [React Bits](https://reactbits.dev/)（`src/components/reactbits/`，
经 shadcn 注册表 `https://reactbits.dev/r/<组件>-TS-CSS` 取源码落盘）。

## 常用命令

```bash
bun install        # 安装依赖（无 bun 时用 npm 亦可：npm install）

bun run dev        # 开发服务器（/api、/healthz 自动代理到本机 8730 后端）
bun run lint       # oxlint 检查
bun run build      # tsc -b 类型检查 + vite 构建 → dist/
bun run preview    # 本地预览构建产物
```

> 后端在仓库根目录用 `bash start-backend.sh`（Windows `start-backend.bat`）或 `python -m app.main` 启动
> （端口 8730，读 .env）。后端就绪后单独起本前端 `bun run dev` 即可。

## 技术栈

- **React 19 + Vite + TypeScript**（脚手架自带，oxlint 做 lint）
- **react-i18next**：国际化基础。词表在 `i18n/locales/{zh,en}.ts`，i18next 初始化见
  `i18n/index.ts`（LanguageDetector 探测顺序 localStorage `crm-lang` → 浏览器语言 → 英文兜底）；
  组件内统一 `useTranslation()` 取 `t`，语言参数用 `useLang()`；「中文/English/自动」
  下拉由 `i18n/LangModeContext.tsx` 驱动 `changeLanguage`
- **React Bits**：`CountUp`（实时统计数字滚动）、`AnimatedContent`（右栏卡片入场）
- 样式集中在 `styles/panel.css`（深浅主题 CSS 变量），无 Tailwind

## 容器化部署

`Caddyfile` + `Dockerfile` 构成前端镜像：bun 构建面板 → Caddy（alpine）托管静态文件并反代 API。

- 由仓库根目录 `docker-compose.yml` 编排（服务名 `frontend`），对外端口 `FRONTEND_PORT`（默认 8080）；
- Caddy 同源反代 `/api`、`/healthz` 到 `backend` 容器，浏览器只面对一个入口，无 CORS；
- 带指纹的构建产物带一年 immutable 缓存，`index.html` 不缓存，发版刷新即生效；
- 只改前端时单独重建：`docker compose up -d --build frontend`。

## 与后端的关系

- **同源托管**：`bun run build` 产物 `dist/` 由 FastAPI 直接服务（见 `app/main.py`）：
  `/` 返回面板页面，`/assets/*` 由后端挂载；未构建时 `/` 返回带构建指引的 503。
- **资产自包含**：favicon / LOGO 等静态资产在 `public/assets/`，构建后随 `dist/assets/` 发布，
  不依赖后端任何静态目录。
- **无 CORS**：生产同源；开发期经 Vite proxy 转发。JWT 存 localStorage（`crm-jwt`），
  请求统一带 `Authorization: Bearer`。

## 目录结构

```
src/
├── api/            # 接口层：client.ts（统一包体/错误/会话）、types.ts（后端出参类型）
├── components/     # 通用组件：Nav / Footer / LoginDialog / icons
│   └── reactbits/  # React Bits 组件源码（CountUp / AnimatedContent）
├── context/        # 跨模块状态：AuthContext / ThemeContext / ToastContext
├── features/       # 业务区块：hero / feed（含翻译）/ sidebar（统计·节奏·源·命中·日志）
├── i18n/           # i18next 初始化 + locales/{zh,en}.ts + LangModeContext + useLang
├── styles/         # panel.css（全量样式：主题令牌 / 布局 / 组件 / 动效）
├── utils/          # format.ts（时间/转义/高亮）
├── App.tsx         # 装配 + 60s 数据刷新主循环
└── main.tsx        # 入口（先 import i18n 初始化）

public/
└── assets/         # favicon（深浅两套）/ LOGO / apple-touch-icon
```

## 约定

- 界面文案一律走 react-i18next（`useTranslation().t`），词表 zh/en 双份都要配，占位符 `{{var}}`；
- 第三方数据渲染必须经 `utils/format.ts` 的 `esc()` / `hl()`，链接过 `safeUrl()`；
- 样式只用 `panel.css` 既有 CSS 变量（深浅色主题都要正常）；
- 改动后需浏览器验证渲染与 console 无报错（见根目录 AGENTS.md）。
