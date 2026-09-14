# AGENTS.md

供 AI 编码助手（ZCode / Codex / Claude 等）在本仓库工作遵循。动手前通读全文；标注「禁止」的条目曾被用户明确纠正过，不得违反。与 `.agents/skills/` 内的通用设计类 Skill 冲突时（如引入 Tailwind、替换字体、新增依赖、绕过 i18n / React Bits / check.sh），一律以本文件为准。

## 项目概览

监控 X 账号（@thsottiaux）的 Codex 用量重置公告：定时轮询时间线 → 正则规则命中 → 多渠道推送（飞书 / 钉钉 / 企微 / Bark / Telegram）+ Web 面板展示。
技术栈：FastAPI + SQLAlchemy(async) + SQLite(aiosqlite) + httpx；前端为 React 19 + Vite + TS 独立工程（bun 管理依赖）。

## 常用命令

| 用途 | 命令 |
|---|---|
| 质量检查（任何交付前必须三步全绿） | `bash check.sh` |
| 前端开发 | 在 `frontend/` 下 `bun install` 后 `bun dev`（5173，/api 代理到 8730 后端） |
| 前端构建 / lint | 在 `frontend/` 下 `bun run build` / `bun run lint` |
| lint / 格式自动修复 | `bash check.sh --fix` |
| 本地演示启动（无凭证体验） | `DEMO=1 MONITOR_HOST=127.0.0.1 MONITOR_PORT=18xxx .venv/bin/python -m app.main` |
| 后端启动（读 `.env`） | `bash start-backend.sh`（macOS/Linux）/ `start-backend.bat`（Windows），自动建环境装依赖；等价手动方式：venv + pip（或 uv）装依赖后 `python -m app.main` |
| Docker 构建验证 | `docker build -t codex-reset-monitor .` |

## 目录结构

```
app/
├── api/          # 路由薄壳：参数校验 + 调用 service
├── core/         # 配置、异常、文本与时间工具
├── db/           # 引擎、会话工厂、建表与防御迁移
├── integrations/ # 外部世界：数据源 / 通知渠道 / 翻译（一个第三方一个模块）
├── models/       # SQLAlchemy ORM 模型
├── repositories/ # 数据访问（每函数一 session 的现状约定）
├── schemas/      # Pydantic 出参模型
├── services/     # 用例编排

frontend/         # React 独立前端工程（Vite + React 19 + TS，bun 管理依赖）
                  # bun run build 产物 dist/ 由 FastAPI 同源托管，存在即优先生效
```

## 环境红线

- **禁止**代建虚拟环境或更换解释器：用户在 PyCharm 自管（当前 `.venv` 为 Python 3.14）。
- **禁止**写死 Python 版本：`requires-python = ">=3.9"` 保持不变；不得恢复 `.python-version`。
- **禁止**触碰用户运行中的服务：compose 起的 `codex-reset-monitor`、`redis`、`mysql` 等。
- **禁止**读写 `data/monitor.db` 真实数据：冒烟测试把 `DB_PATH` 指向 `/tmp` 临时库。
- DEMO 模式自动使用独立库 `data/demo.db`（`main.py` 导入期切换），演示数据不进生产库；`demo.db` 可随时删除重建。
- 验证类工作用隔离方式：`uvx <tool>`、`uv run --isolated --group dev`。
- 自起的验证资源（进程 / 容器 / 镜像 / 临时文件 / 浏览器标签）用可识别命名，收尾必须清理；**按用户要求启动的服务进程同样如此**——验证/交付完成即释放，用户明说保留的除外，不得默认常驻。
- **禁止**拉起系统安装的 Chrome 等本机浏览器做验证：浏览器验证一律用 ZCode 内置浏览器（browser-use），仅在内置浏览器确实无法胜任且经用户同意时才可使用系统浏览器。
- 演示验证用高位独立端口（18xxx），避免与用户实例冲突。

## 质量门

- 任何交付前 `bash check.sh` 必须三步全绿：ruff check + ruff format --check + mypy。
- ruff 行宽 120；`RUF001-003` 豁免用于中文全角标点，**不得删除**。
- mypy 检查目标 3.10（新版 mypy 不支持 3.9 目标），`requires-python` 保持 `>=3.9`。
- 前端交付三件套：`bun run lint`（oxlint 0 告警）+ `bun run build`（含 tsc 类型检查）+ 浏览器验证渲染与 console 无报错。

## 安全红线

- **必须** SQL 全参数绑定：ORM 表达式或 `text("... WHERE x = :p")`；**禁止**字符串拼接 / format / f-string 组装 SQL。
- `.env` / `.venv/` / `data/` / `.idea/` 永不入库（已配置，勿改）。
- 第三方数据（推文正文、命中词、错误信息、ID、URL）渲染到前端必须经 `esc()` 转义。
- 链接 `href` 必须过 `frontend/src/utils/format.ts` 的 `safeUrl()`（仅放行 http/https）。
- 凭证只从环境变量 / `.env` 读取：源码、示例、测试、日志输出不得出现凭据字面量。

## 代码规范

### 后端

- 分层职责：`api/` 路由薄壳 → `services/` 用例 → `repositories/` 数据访问 → `models/` ORM；外部世界一律放 `integrations/`。
- `/api/*` 统一 `{code, data, message}` 包体；业务错误抛 `BizError`（`core/errors.py` 统一转换）；新路由参数必须 `Query(gt/le)` 校验；`/healthz` 例外（healthcheck 依赖原样 `{"ok": true}`）。
- 原生 SQL 与名为 `text` 的列名冲突时，sqlalchemy 的 text 用 `sa_text` 别名。
- 注释用中文，解释「为什么」而不是「做什么」。

### 前端

前端只有 `frontend/` 一套（React 19 + Vite + TS，bun 管理依赖）：

- 界面文案必须走 react-i18next（`useTranslation().t`），词表在 `frontend/src/i18n/locales/{zh,en}.ts` 双份同配，占位符 `{{var}}`；**禁止**硬编码单语文案。
- 命中词高亮只能走 `frontend/src/utils/format.ts` 的 `hl()`（先转义后替换）；链接过 `safeUrl()`。
- 样式只用 `styles/panel.css` 的既有 CSS 变量（深浅色主题都要正常），不引 Tailwind。
- 动画组件来自 React Bits（`src/components/reactbits/`，shadcn 注册表取源码），新增组件同样落盘该目录。
- 交付前：`bun run lint`（oxlint 0 告警）+ `bun run build`（tsc -b）+ 浏览器验证渲染与 console。

## 数据库

- SQLite + WAL；**表名 / 列名与旧库完全一致是硬约束**。
- 结构变更 = 在 `database.py:init_db` 追加防御迁移段（幂等、参数绑定）+ 同步 `app/models/`。
- `create_all` 对已有库必须是无操作。

## Git 规范

- 任务完成后**先不要 commit**（用户 2026-09-14 明确纠正）：改动留在工作区，方便用户在 IDE 里直接审查改了哪些文件；用户确认或明确说提交后再 commit。历史教训（未提交 + 重装环境永久丢失工作）仍在，所以审查通过后尽快提交，不要长期攒大批未提交改动。
- Conventional Commits：英文小写描述，按逻辑拆分提交。
- 只 commit 不 push，除非用户明说。
- 审查报告等个人归档文档放 `docs/`，依赖 `.git/info/exclude` 的 `docs/code-review-*.md` 保持本地化，**不要提交**。

## 已知取舍（禁止「顺手优化」）

- 回复监控默认关闭（2026-09-14 起代码默认 false，显式 `MONITOR_INCLUDE_REPLIES=true` 才开启）：自建 RSSHub 的 `includeReplies=true` 路由因 X 反爬拦截 `UserTweetsAndReplies` 恒返回空 feed（上游 DIYgod/RSSHub#22964）。上游修复（PR #22967）合并并拉新镜像后，设 `MONITOR_INCLUDE_REPLIES=true` 即可恢复（面板「隐藏回复」过滤已移除，无需再 revert）。开启后注意：twitterapi.io 增量翻页随之 1→2 页（防回复风暴刷过单页窗口）；RSSHub 无法判定回复（`is_reply` 存 NULL 无徽章）；回复命中同样推送。
- 检查日志面板固定取最近 200 条（`/api/polls?limit=200`，API 上限 200），数据库保留 30 天；徽章有悬停说明。
- 数据源自告警（`services/source_watch.py`）：连续 `MONITOR_SOURCE_ALERT_THRESHOLD`（默认 3）轮检查全部失败经渠道告警，恢复后发恢复通知；重发间隔 `MONITOR_SOURCE_ALERT_REPEAT_MINUTES`（默认 60，0 不重发）。状态存 `app_state` 表（重启不重复打扰、不漏发恢复）；未配置任何源不算失败；DEMO 模式整体跳过。
- 推文保留分级：未命中 30 天滚动清理、命中 180 天（`MONITOR_TWEET/HIT_RETENTION_DAYS`），供「重置节奏」统计卡（`/api/stats`）采样；此前推文从不清理，旧库首次升级会补执行清理。
- 登录鉴权（JWT，`MONITOR_ADMIN_PASSWORD` 留空即完全关闭）：单管理员账密经 `POST /api/login` 换 HS256 JWT（默认 24h，`MONITOR_TOKEN_EXPIRE_HOURS`；密钥未显式配置时从口令派生，改口令全量失效）。需登录的「操作」：poll-now / test-notify / translate；读接口与面板公开，匿名 `/api/tweets` 窗口钳制 24h。前端 JWT 存 localStorage `crm-jwt`，401 弹登录窗自动重试。
- DEMO 模式隔离是双重的：独立库 `data/demo.db` + 跳过全部真实渠道推送（`notifiers._dispatch` 统一拦截），演示命中保持未推送状态。
- 推送按渠道粒度判定送达：全部尝试渠道成功才标记已推送；失败渠道由每轮轮询开头的补推扫描只向失败渠道重发；命中时未配置渠道的推文不补推（面板历史仍在）。
- 启动回扫（`services/rescan.py`）：每次启动用当前规则重扫 30 天内未命中推文并补 `mark_hit`（面板历史自愈）；只补推 24 小时内发布且从未有过渠道尝试的错过公告，已推送/已尝试的不重发，24 小时外只补记录不推送。
- repositories 逐函数一 session、逐条事务，WAL 下够用；批量优化需整体权衡再做。
- API 文档与测试通知仅在 `MONITOR_ENV=debug` 开放。

## 验证要求

- 后端逻辑改动：`/tmp` 临时库冒烟通过后再交付。
- 前端改动：起 DEMO 实例，用 ZCode 内置浏览器（browser-use）看渲染、查 console。
- Dockerfile / compose 改动：有 Docker 的机器上实际 `docker build` + `docker run` 起容器验证；**无 Docker 的本地开发机器不必为此装 Docker**，用 `bash start-backend.sh` 启动验证即可，镜像级验证留给有 Docker 的环境。
- 构建网络：镜像源走 DaoCloud 前缀 + 清华 PyPI 镜像，**禁止**引入 ghcr.io 直连。
