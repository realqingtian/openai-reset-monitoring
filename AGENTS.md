# AGENTS.md · AI 协作规范

面向在本仓库工作的 AI 编码助手（ZCode / Codex / Claude 等）。**开始任何工作前先读完本文件**，这些都是用户亲自确立的规矩与项目硬约束，不要等用户重复交代。

## 项目是什么

监控 X 账号（@thsottiaux）的 Codex 用量重置公告：定时轮询时间线 → 正则规则命中 → 全渠道推送（飞书/钉钉/企微/Bark/Telegram）+ Web 面板展示。技术栈：FastAPI + SQLAlchemy(async) + SQLite(aiosqlite) + httpx，前端为无框架 ES 模块（`app/web/`）。运行入口 `bash run.sh`（支持 `DEMO=1` 无凭证体验）。

## 环境红线（违反会惹恼用户）

- **解释器与虚拟环境由用户自己在 PyCharm 里管理**（当前 `.venv` 是 Python 3.14）。禁止代建 venv、禁止替用户选择/切换解释器。
- 验证类工作用隔离方式，不污染项目环境：`uvx <tool>`、`uv run --isolated --group dev`、临时库冒烟。
- `requires-python = ">=3.9"`，**不要写死具体版本**；`.python-version` 已删除，不要恢复。
- 用户机器上运行中的服务（compose 起的 `codex-reset-monitor`、`redis`、`mysql` 等）**一律不碰**；你自己的验证资源用可识别命名，收尾必须清理（进程、容器、镜像、/tmp 文件、浏览器标签）。
- 需要起面板验证时：`DEMO=1 MONITOR_HOST=127.0.0.1 MONITOR_PORT=18xxx .venv/bin/python -m app.main`，用高位独立端口，避免与用户实例冲突。

## 质量门（交付前必须全绿）

```bash
bash check.sh        # = ruff check + ruff format --check + mypy，三步全过才算完成
bash check.sh --fix  # 自动修复 lint 与格式
```

- ruff：行宽 120，规则集与豁免见 `pyproject.toml [tool.ruff]`。**RUF001-003 的豁免是给中文全角标点的，不要删**。
- mypy：检查目标 3.10（新版 mypy 不支持 3.9 目标）；`requires-python` 保持 >=3.9 不变。
- 前端无 linter，改动 JS 后自行在浏览器验证无报错。

## Git 纪律

- **完成一个独立、可运行的功能/修复就立即提交**——用户曾因"做了没提交 + 删目录重装环境"永久丢失过工作。
- Conventional Commits，英文小写描述，按逻辑拆分（参考 `git log`）。
- 只 `commit` 不 `push`，除非用户明说。
- `.env` / `.venv/` / `data/` / `.idea/` 永不入库（已配置，勿改）。
- 审查报告等个人归档文档放 `docs/` 并依赖 `.git/info/exclude` 里的 `docs/code-review-*.md` 保持本地化，**不要提交**。

## 代码约定（后端 Python）

- 分层：`api/` 路由薄壳 → `services/` 用例 → `repositories/` 数据访问（每函数一 session 是现状约定）→ `models/` ORM。外部世界（数据源、通知渠道、翻译）在 `integrations/`，一个第三方一个模块。
- `/api/*` 统一 `{code, data, message}` 包体；业务错误抛 `BizError`（`core/errors.py` 统一转换）；新路由参数必须 `Query(gt/le)` 校验。`/healthz` 例外（docker healthcheck 依赖原样 `{"ok": true}`）。
- **SQL 安全红线：一律参数绑定**——ORM 表达式或 `text("... WHERE x = :p")`，禁止字符串拼接 / format / f-string 组装 SQL。
- 原生 SQL 与名为 `text` 的列名冲突时，sqlalchemy 的 text 用 `sa_text` 别名（见 models）。
- 中文注释，解释"为什么"而不是"做什么"。

## 代码约定（前端 `app/web/`）

- 无框架 ES 模块，渲染用 `innerHTML` 模板拼装：**一切第三方数据（推文正文、命中词、错误信息、ID、URL）插值必须 `esc()`**；命中高亮只能走 `format.js:hl()`（先转义后替换）。
- 链接 `href` 必须过 `dom.js:safeUrl()`（仅放行 http/https，防伪协议）。
- 界面文案必须走 `i18n.js` 双语（静态用 `data-i18n` / `data-i18n-title`，动态用 `t()`），**不要硬编码单语文案**。
- 样式只用 `panel.css` 的既有 CSS 变量（深浅色主题都要正常）。

## 数据库

- SQLite + WAL；**表名/列名与旧库完全一致是硬约束**。改结构 = 在 `database.py:init_db` 追加防御迁移段（幂等、参数绑定），并同步 `app/models/`。`create_all` 对已有库必须是无操作。

## 已知设计取舍（不要"顺手优化"掉）

- 检查日志面板每次只取最近 200 条（`/api/polls?limit=200`，API 上限 200），数据库保留 30 天；徽章有悬停说明。
- 推送按渠道粒度判定送达：主路径所有尝试渠道全部成功才标记已推送；失败渠道由每轮轮询开头的补推扫描只向失败渠道重发（成功渠道不重发，持续重试直至送达或滑出回看窗口）。命中时未配置任何渠道的推文无尝试记录，不参与补推（面板历史仍在）。
- repositories 逐条事务在 WAL 下够用，批量优化需整体权衡再做。
- 文档仅在 `MONITOR_ENV=debug` 开放；测试通知按钮/接口同样有 debug 门禁。

## 验证习惯

- 后端逻辑：把 `DB_PATH` 指到 `/tmp` 临时库做冒烟，**绝不读写 `data/monitor.db` 真实数据**。
- 改了 Dockerfile/compose：实际 `docker build` + `docker run` 起容器验证（构建走 DaoCloud 前缀 + 清华 PyPI 镜像，别引入 ghcr.io 直连）。
- 改前端：起 DEMO 实例用浏览器看渲染、查 console。
