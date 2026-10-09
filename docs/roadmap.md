# 功能清单与需求进度管理

本文档是项目的**需求池与进度台账**：已实现功能按域归档、待办需求带状态跟踪、历史决策与取舍留档。
每次功能交付或需求状态变化时，更新对应条目，并在文末「六、变更记录」追加一行。

- 项目：Codex 重置监控（监控 @thsottiaux 的 Codex 用量重置公告 → 多渠道推送 + Web 面板）
- 创建：2026-10-01 ｜ 最后更新：2026-10-01
- 关联文档：`AGENTS.md`（协作与取舍约定）、`README.md` / `README.en.md`（部署与配置）

**状态图例**：✅ 已实现 ｜ 🚧 进行中 ｜ 📋 已规划 ｜ 💡 候选（未排期）｜ ⏸️ 暂缓（外部依赖）｜ 🚫 明确不做

---

## 一、已实现功能清单

### 1. 监控核心

- ✅ 定时轮询 X 时间线，拉取 → 去重 → 入库 → 正则匹配 → 命中推送（`services/poller.py`）
- ✅ 多账号支持：`MONITOR_ACCOUNTS` 逗号分隔
- ✅ 双数据源故障切换：twitterapi.io（付费，分页回填/增量）→ RSSHub（免费兜底），健康状态落库（`integrations/sources/`）
- ✅ 5 条内置命中规则（全球重置英文/中文/英文宽松、订阅暂停、订阅恢复），可经 `MONITOR_RULES_JSON` 覆盖，解析失败自动回退内置
- ✅ 回复监控：默认关闭（上游 RSSHub 反爬 bug，见「五、暂缓」），`MONITOR_INCLUDE_REPLIES=true` 显式开启
- ✅ 启动回扫自愈：30 天内未命中推文按当前规则重判补记录；24h 内发布且从未尝试过推送的错过公告补推（`services/rescan.py`）

### 2. 通知推送

- ✅ 5 渠道：飞书 / 钉钉 / 企业微信 / Bark / Telegram，填凭证即启用、留空即停用（`integrations/notifiers/`）
- ✅ 内容指纹 SHA256 + 24h 相似度（重叠系数 ≥0.8）双重去重，防转发/修正版重复打扰
- ✅ 按渠道粒度补推：每轮轮询开头只向上次失败的渠道重发（`repositories/notify_retry.py` + `notify_log` 表）
- ✅ 中英双语消息模板（`MONITOR_NOTIFY_LANG`），渠道关键词安全设置适配（钉钉/飞书固定前缀）
- ✅ 数据源自告警：连续 N 轮全失败 → 渠道告警，恢复通知，状态存 `app_state` 重启不重发（`services/source_watch.py`）
- ✅ 测试通知：`POST /api/test-notify`（需登录 + 仅 debug 环境开放）
- ✅ DEMO 模式统一拦截真实推送（`notifiers._dispatch`），演示命中保持未推送状态

### 3. Web API（FastAPI，统一 `{code, data, message}` 包体）

- ✅ `GET /api/status`：总状态聚合（24h 数据、数据源健康、渠道就绪、启用规则）
- ✅ `GET /api/tweets?hours=`：帖子窗口查询（匿名钳制 24h，登录后上限 720h）
- ✅ `GET /api/hits?limit=`：历史命中（上限 500）
- ✅ `GET /api/polls?limit=`：检查日志（上限 200）
- ✅ `POST /api/poll-now`：手动立即检查（需登录，与轮询共用锁串行）
- ✅ `GET /api/stats`：重置节奏统计（平均间隔、上次命中、下次预期窗口、逐日命中）
- ✅ `GET /api/translate?id=&to=`：按需翻译（zh/en 白名单，译文按 (tweet_id, lang) 永久缓存）
- ✅ `POST /api/login` + JWT 鉴权：单管理员，口令留空即整体关闭；密钥未配置时从口令派生
- ✅ `GET /healthz`：Docker healthcheck（不走统一包体的例外）
- ✅ `/docs` `/redoc` `/openapi.json` 仅 `MONITOR_ENV=debug` 注册

### 4. 前端面板（React 19 + Vite + TS，bun 管理）

- ✅ Hero 告警横幅：命中红色告警态 + 直达推文，平时绿色监控态
- ✅ 24h 帖子信息流：来源/回复/命中/已推送徽标、命中词高亮（`hl()` 先转义后替换）、作者头像+昵称（字母头像降级、`MONITOR_AVATAR_MIRROR` 镜像）、相对时间 + 双时区悬停气泡、按需翻译按钮（模块级缓存）
- ✅ 重置节奏卡：状态机（等待/已逾期双色）、逐秒倒计时、进度条、GitHub 风格 26 周热力图（悬停气泡 + 点击展开当日明细）
- ✅ 侧栏：LiveStats（CountUp 动画）、数据源健康 + 渠道 pill、历史命中 20 条、检查日志分页（每页 10）
- ✅ 主题三态（浅/深/跟随系统）+ 中英双语 i18n（react-i18next，zh/en 词表双份同配）
- ✅ 登录窗：401 自动引导登录后重试原操作，JWT 存 localStorage `crm-jwt`
- ✅ 动画组件来自 React Bits（`src/components/reactbits/`）
- ✅ 安全三件套：`esc()` 转义第三方文本、`safeUrl()` 仅放行 http/https、SQL 全参数绑定

### 5. 工程与部署

- ✅ 分层架构：api（薄壳）→ services → repositories → models，外部世界一律 `integrations/`
- ✅ SQLite + WAL，防御迁移（`init_db` 追加幂等迁移段），`create_all` 对旧库无操作
- ✅ 推文分级保留：未命中 30 天 / 命中 180 天滚动清理
- ✅ DEMO 模式双重隔离：独立库 `data/demo.db` + 拦截真实推送
- ✅ 质量门 `check.sh`：ruff check + ruff format --check + mypy 三步全绿
- ✅ Docker：可复现 uv.lock 构建、非 root 运行用户；前后端分离部署（Caddy 前端 + FastAPI 后端）
- ✅ `start-backend.sh` / `.bat` 一键启动（自动建环境装依赖）

---

## 二、需求池（待办 / 规划）

> 按优先级排序。状态变化时更新本节并记入「六、变更记录」。

### R1 通知历史面板 📋 已规划 ｜ P1

- **背景**：`notify_log` 表已记录每次推送的渠道、时间、成功/失败与错误信息，但目前只有补推逻辑在读它，无 API、无前端展示——「按渠道补推」机制对用户不可见。
- **方案要点**：新增只读接口（如 `GET /api/notify-logs?limit=`）+ 右栏一张卡；沿用检查日志卡的分页与徽章样式。
- **涉及模块**：`app/api/`、`app/services/`、`app/repositories/notify_retry.py`（复用查询）、`frontend/src/features/overview/`、i18n 词表。
- **验收**：面板能看到近 N 次推送的渠道结果与失败原因；中英文案齐备；`check.sh` + 前端三件套通过。

### R2 统计按账号拆分 📋 已规划 ｜ P1

- **背景**：`MONITOR_ACCOUNTS` 支持多账号，但 `/api/stats` 无 account 维度，多账号下热力图与「下次重置预测」混算平均间隔，预测失真（单账号无影响）。
- **方案要点**：`/api/stats` 增加 `account` 查询参数（`Query` 校验），默认合并行为不变；前端节奏卡加账号切换（仅多账号时显示）。
- **涉及模块**：`app/api/stats.py`、`app/services/stats.py`、`frontend/src/features/overview/Overview.tsx`。
- **验收**：多账号下可分别查看各账号节奏；单账号 UI 无变化。

### R3 规则热更新（面板内编辑）📋 已规划 ｜ P1

- **背景**：改 `MONITOR_RULES_JSON` 必须重启进程；已有启动回扫自愈能力，改成 DB 存储 + 面板编辑后可放大为「随时自愈」。
- **方案要点**：规则落 `app_state` 或新表（列名/表名约束见 AGENTS.md 数据库节），环境变量优先级保持兼容；编辑走已有 JWT 鉴权；保存后自动触发一次 30 天回扫。
- **涉及模块**：`app/api/`（新路由，需 `Query`/Body 校验）、`app/services/matcher.py`（规则缓存失效）、`app/db/database.py`（迁移段）、前端规则管理 UI。
- **验收**：面板增删改规则即时生效，无需重启；`MONITOR_RULES_JSON` 仍可覆盖；回滚到内置规则有明确入口。

### R4 自动化测试 💡 候选 ｜ P2

- **背景**：全仓零测试，质量门全靠静态检查 + 手工冒烟，回归风险最高的一项。
- **方案要点**：先补纯逻辑单测——matcher 规则命中、notify 指纹/相似度去重、rescan 回扫窗口、stats 采样；`pyproject.toml` dev 组加 pytest，`check.sh` 追加一步；DB 相关测试用 `/tmp` 临时库。
- **涉及模块**：新增 `tests/`、`check.sh`、`pyproject.toml`。
- **验收**：`bash check.sh` 四步全绿；核心纯逻辑有回归保护。

### R5 命中历史分页与时间过滤 💡 候选 ｜ P2

- **背景**：`/api/hits` 仅 `limit` 截断（上限 500），无时间窗/游标参数；命中保留 180 天，但前端固定只展示 20 条。
- **方案要点**：加 `hours` / `offset` 参数（沿用 `Query(gt/le)` 规范）；前端历史命中卡加「加载更多」。
- **涉及模块**：`app/api/tweets.py`、`app/services/tweets.py`、`HitHistory.tsx`。
- **验收**：能翻页看全 180 天命中；匿名/登录窗口约束与 tweets 接口对齐。

### R6 翻译通道升级 💡 候选 ｜ P2

- **背景**：主通道是非官方 Chrome translate 端点（大陆需代理），兜底 MyMemory 匿名配额 5000 字/天且质量一般（代码注释自认）。
- **方案要点**：增加可配置渠道 LibreTranslate（可自托管）或 DeepL 官方 API；沿用「填凭证即启用」约定与 (tweet_id, lang) 缓存。
- **涉及模块**：`app/integrations/translate.py`、`app/core/config.py`、`.env.example`、README。
- **验收**：新渠道可用可回退；缓存复用不重复计费；文档同步。

### R7 更多通知渠道 💡 候选 ｜ P3

- **背景**：Discord / Slack / ntfy / Gotify 用户呼声高的常见渠道；现有 notifiers 一渠道一模块 + 统一模板，扩展成本低。
- **方案要点**：每渠道一个模块照抄现有结构；注意各渠道长度限制的截断注释（参考 wecom 600 / bark 180）。
- **验收**：DEMO 模式下模板渲染正确（不真实发送）；README 渠道表更新。

### R8 对外输出（RSS / Webhook 转发 / Prometheus metrics）💡 候选 ｜ P3

- **背景**：方便接入用户已有的监控告警体系或 RSS 阅读器。
- **方案要点**：命中事件 RSS 订阅最轻（复用 tweets 查询）；`/metrics` 轮询/命中/推送计数；鉴权遵循「读公开、操作需登录」现状。
- **验收**：不破坏统一包体约定（`/metrics` 参照 `/healthz` 例外处理）。

---

## 三、暂缓与明确不做（归档）

| 条目 | 状态 | 原因 / 恢复条件 |
|---|---|---|
| 回复监控（RSSHub 路由） | ⏸️ 暂缓 | 上游 DIYgod/RSSHub#22964：`includeReplies=true` 被 X 反爬拦成空 feed，修复 PR #22967 待合并。合并后拉新镜像、设 `MONITOR_INCLUDE_REPLIES=true` 即恢复；RSSHub 侧 `is_reply` 仍将存 NULL |
| repositories 批量 session 优化 | 🚫 明确不做 | WAL 下逐函数一 session、逐条事务够用；「批量优化需整体权衡再做」，禁止顺手优化 |
| 检查日志扩容（>200 条） | 🚫 明确不做 | 面板固定取最近 200 条（API 上限 200）+ 30 天库内保留，属刻意取舍 |
| 多用户 / 角色 / 服务端登出 | 🚫 明确不做 | 单管理员模型够用；JWT 无状态 24h 过期，改口令全量失效即「登出」 |
| 独立 worker / 任务队列 | 🚫 明确不做 | 进程内 asyncio 轮询满足单实例部署；引入队列属架构级变更，需整体权衡 |

---

## 四、里程碑时间线（自 git 历史归档）

| 时间 | 里程碑 | 关键交付 |
|---|---|---|
| 2026-09-09 | 项目诞生 | 初始提交；分层 FastAPI 架构重构；UTC 时区统一与双时区展示；双语 README + MIT |
| 2026-09-10 ~ 09-11 | 质量基建与规则完善 | ruff + `check.sh` 质量门；Docker 加固（uv.lock、非 root）；按渠道补推；订阅暂停/恢复规则；回复监控试水（后因上游 bug 关闭）；DEMO 独立库隔离；AGENTS.md 建立协作约定 |
| 2026-09-12 | 自愈能力 | 启动回扫（30 天重判补记录、24h 补推）；公告式重置匹配（不依赖 limits 措辞） |
| 2026-09-14 | 大改版 | 独立 React 19 前端替换旧面板；JWT 登录鉴权；数据源自告警；`/api/stats` 节奏统计；前后端分离部署（Caddy + FastAPI）；回复监控默认关闭；README 重写 |
| 2026-09-15 ~ 09-16 | 面板打磨 | 节奏卡独立 + GitHub 风格热力图；账号头像/昵称与镜像前缀；卡片双描边风格统一；响应式与登录窗适配 |

---

## 五、变更记录（本文档自身）

| 日期 | 变更 |
|---|---|
| 2026-10-01 | 创建文档：归档已实现功能清单、8 项需求池（R1–R8）、暂缓/不做条目、09-09 至 09-16 里程碑时间线 |
