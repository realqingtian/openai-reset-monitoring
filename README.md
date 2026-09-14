# Codex 重置监控面板（OpenAI Reset Monitoring）

中文 | [English](README.en.md)

监控 X（Twitter）用户 [@thsottiaux](https://x.com/thsottiaux)（Tibo · OpenAI Codex 负责人）最近 24 小时的公开帖子，
命中"**全球重置付费订阅用量**"与"**订阅暂停/恢复**"类公告时，在面板高亮告警并推送到飞书 / 钉钉 / 企业微信 / Bark / Telegram。

> 背景：Tibo 已形成"每周一重置"的规律（如 *"Usage limits have been reset for all paid ChatGPT Work and Codex users"*），
> 本工具帮你在第一时间知道重置发生。

![监控面板总览](docs/panel.png)

## 功能

- ⏱ **定时轮询**：默认每 5 分钟拉取一次账号时间线（可配置），按推文 ID 去重入库（SQLite）
- 🔀 **双数据源故障切换**：twitterapi.io（第三方抓取 API）与 RSSHub（免费）都填则自动切换，只填一个就用唯一源
- 🎯 **关键词命中**：参考 Tibo 真实措辞设计的正则规则（中英文），命中词在面板高亮
- 🔔 **五渠道推送**：飞书 / 钉钉 / 企微 / Bark / Telegram，命中只推一轮、渠道失败自动按渠道补推（成功渠道不重发），重复公告不重复打扰
- 🩺 **数据源自告警**：数据源连续检查失败自动经全部渠道发告警、恢复后发恢复通知，杜绝"监控悄悄挂了没人知道"
- 📈 **重置节奏统计**：基于命中历史推算平均重置间隔、上次命中与下次预期窗口，配迷你时间线一目了然
- 🔐 **JWT 登录鉴权**：面板匿名可看（24 小时数据），「立即检查」等操作引导管理员登录；JWT（HS256）默认 24 小时有效，可配置
- 📊 **监控面板**：左侧告警横幅 + 24 小时帖子流；右侧实时统计、数据源、通知渠道、历史命中、检查日志；60 秒自动刷新
- 🕐 **时间一目了然**：每条帖子同时标注真实发布时间（UTC+0）、换算时间（UTC+8）和"N 小时前发布"，推送消息同样双时区
- 🔤 **帖子一键翻译**：帖子卡片自带"翻译"按钮，机器翻译为中文（Google 通道为主、MyMemory 兜底，均免 key），译文进 SQLite 缓存，刷新页面不丢失
- 🌓 **深浅色主题**：深色 / 浅色 / 跟随系统三种模式，偏好本地记忆
- 🌍 **中英文界面**：面板语言跟随浏览器设置，推送消息语言可独立配置
- 🧪 **DEMO 模式**：无需任何凭证即可本地体验完整流程

## 快速开始

```bash
# 1.（可选）先跑 DEMO 模式看效果，无需任何配置
DEMO=1 bash start-backend.sh        # Windows：start-backend.bat
# 打开 http://127.0.0.1:8080

# 2. 正式启用：创建 .env 并填入凭证（脚本首次运行也会自动创建）
cp .env.example .env
# 编辑 .env：至少填一个数据源（见下文「配置说明」），然后重启：
bash start-backend.sh
```

启动后访问 `http://127.0.0.1:端口`（端口看 `.env` 里的 `MONITOR_PORT`，
什么都不配时内置默认 `8080`）。

说明：

- `start-backend.sh`（Windows 用 `start-backend.bat`）会自动创建虚拟环境并安装后端依赖
  （优先用 [uv](https://docs.astral.sh/uv/)，没装则回退 `python3 -m venv` + pip）
- 面板是 React 单页应用：源码部署需要先构建前端（见下文「开发指南」），Docker 镜像已内置构建好的面板

## 生产部署

### 方式一：Docker Compose（推荐，前后端分离双容器）

前置条件：机器上装有 Docker 和 Docker Compose。架构：

```
浏览器 ──► frontend 容器（Caddy：托管 React 面板静态文件）
                │ /api、/healthz 反代（同源，无 CORS）
                ▼
          backend 容器（FastAPI 纯 API，仅 compose 内网可达）
```

```bash
# 1. 准备配置
cp .env.example .env
# 编辑 .env：填数据源凭证、通知渠道；面板对外端口用 FRONTEND_PORT（默认 8080）

# 2. 构建并后台启动
docker compose up -d --build

# 3. 查看日志 / 停止
docker compose logs -f
docker compose down            # 停止（数据保留在 ./data）
```

完成后打开 `http://宿主机IP:8080`（改端口用 `.env` 里的 `FRONTEND_PORT`）。

说明：

- 两个镜像各自独立构建：frontend（bun 构建 React 面板 → Caddy 托管静态文件并反代 API）、
  backend（uv 按锁文件装依赖 → 纯 API 服务，不对外发布端口）
- 只改了前端代码：`docker compose up -d --build frontend`（后端容器不动，有层缓存，通常一两分钟）
- `.env` 不会被打进镜像，密钥在运行时注入；SQLite 数据挂载在 `./data`，容器重建不丢

### 方式二：源码部署（不用 Docker）

```bash
# 1. 构建前端（必需，需要 bun：https://bun.sh）
cd frontend && bun install && bun run build && cd ..

# 2. 启动后端
bash start-backend.sh        # Windows：start-backend.bat
```

后端检测到 `frontend/dist/` 即托管面板；未构建时访问 `/` 会返回带构建指引的 503 提示页。

## 开发指南

前后端是分离的两个服务，开发时**各开一个终端各自启动**。环境要求（脚本自动分级回退）：

- 后端：[uv](https://docs.astral.sh/uv/) 或 Python ≥ 3.9 二者其一
- 前端：[bun](https://bun.sh) 或 Node.js 二者其一

### 1. 启动后端

```bash
bash start-backend.sh        # macOS / Linux
start-backend.bat            # Windows
```

脚本会自动创建虚拟环境、安装依赖并启动（uv 和传统 pip 二选一，自动检测）。
也可以完全手动执行同样的步骤：

```bash
# 创建虚拟环境并安装依赖（两种方式二选一）
uv venv && uv pip install -r requirements.txt                        # uv 方式
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 传统 pip 方式（Windows 用 .venv\Scripts\）

# 启动后端（读取 .env 配置：端口 MONITOR_PORT、示例配置 8080）
.venv/bin/python -m app.main
```

### 2. 启动前端

```bash
cd frontend
bun install     # 首次执行
bun dev         # 开发服务器：http://localhost:5173（改 frontend/src 代码即时热更新）
```

`/api`、`/healthz` 请求会自动代理到本机后端 8080（代理目标在 `frontend/vite.config.ts`，
后端改端口需同步修改），不存在跨域问题。

### 质量检查

```bash
bash check.sh                        # 后端：ruff 检查 + 格式 + mypy 类型（任何交付前必须全绿）
cd frontend && bun run lint          # 前端：oxlint
cd frontend && bun run build         # 前端：类型检查 + 构建
```

前端改动交付前需在浏览器验证渲染正常、console 无报错。

## 面板怎么看

- **顶部横幅**：平时显示"监控中 · 最近检查 N 分钟前"；命中公告时变红色告警并给出直达链接
- **最近 24 小时的帖子**：每条帖子带三个时间标注——
  `发布 UTC+0`（真实发布时间，也是 X API 的原始时间）、
  `UTC+8`（换算成北京时间，和你在 X 上看到的一致）、
  `N 小时前发布`（每次刷新自动更新）。
  命中公告的帖子带紫色"命中"徽章，命中词高亮
- **帖子翻译**：点击帖子卡片下方的"翻译"按钮，在原文下方展开机器译文（可再点"收起译文"）；
  译文按推文永久缓存，只有首次点击会真正调用翻译接口；界面语言切到英文时英文帖子不显示该按钮
- **实时统计**：窗口内推文数、命中公告数、轮询间隔
- **数据源 / 通知渠道**：每个源显示"正常 / 失败 · N 分钟前"；渠道显示是否就绪
- **历史命中**：所有命中过的公告（不限 24 小时窗口），最多显示两行内容，点行直达原推
- **检查日志**：每次轮询一条（时间、来源、成功/失败、新帖数、耗时），保留 30 天，可分页
- **右上角按钮**：登录徽标（开启鉴权后显示；未登录是锁图标，已登录显示绿点 + 用户名，点开可退出）、主题切换、立即检查；
  "发送测试通知"仅在 `MONITOR_ENV=debug` 时出现（见下文）

## 配置说明

配置全部通过项目根目录的 `.env` 文件（或系统环境变量）完成。
优先级：**系统环境变量 > `.env` 文件 > 内置默认值**。
核心约定：**数据源与通知渠道填了凭证即启用，留空即停用**。每一项的获取方式都写在 `.env.example` 的注释里。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `MONITOR_ENV` | `production` | 设为 `debug` 时面板才显示"发送测试通知"按钮，并开放 `/docs`、`/redoc`、`/openapi.json` API 文档 |
| `DEMO` | 空 | 设为 `1` 使用内置演示数据 |
| `MONITOR_SITE_NAME` | `Codex Reset Monitor` | 面板名称（浏览器标签页标题 + 导航栏名称） |
| `MONITOR_HOST` / `MONITOR_PORT` | `127.0.0.1` / `8080` | 面板服务监听地址（示例配置为 `0.0.0.0:8080`） |
| `MONITOR_ACCOUNTS` | `thsottiaux` | 监控的 X 账号，逗号分隔，不带 @ |
| `MONITOR_POLL_INTERVAL` | `5` | 轮询间隔（分钟） |
| `MONITOR_LOOKBACK_HOURS` | `24` | 面板展示与告警窗口（小时） |
| `MONITOR_INCLUDE_REPLIES` | `true` | 是否同时监控回复（公告偶尔以回复形式补充）；RSSHub 源无法判定回复，面板徽章仅 twitterapi.io 有 |
| `TWITTERAPI_IO_KEY` | 空 | twitterapi.io API Key，留空停用该源 |
| `RSSHUB_BASE_URL` | 空 | RSSHub 实例地址，留空停用该源 |
| `RSSHUB_ROUTE` | `twitter/user` | RSSHub 路由 |
| `RSSHUB_ACCESS_KEY` | 空 | RSSHub 实例开启 `ACCESS_KEY` 鉴权时填同一个值 |
| `FEISHU_WEBHOOK` | 空 | 飞书群机器人 Webhook |
| `DINGTALK_WEBHOOK` | 空 | 钉钉群机器人 Webhook |
| `WECOM_WEBHOOK` | 空 | 企业微信群机器人 Webhook |
| `BARK_URL` | 空 | Bark 推送地址（https://api.day.app/你的Key） |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | 空 | Telegram Bot 凭证（两者都填才启用） |
| `MONITOR_NOTIFY_LANG` | `zh` | 推送消息语言：`zh` / `en`（面板语言跟随浏览器，互不影响） |
| `MONITOR_ADMIN_USER` | `admin` | 管理员登录用户名 |
| `MONITOR_ADMIN_PASSWORD` | 空 | 管理员密码；配置后「立即检查」等操作需登录（JWT），面板查看保持公开；留空不启用鉴权 |
| `MONITOR_JWT_SECRET` | 空 | JWT 签名密钥；留空则从管理员口令派生稳定密钥（改口令即全量失效） |
| `MONITOR_TOKEN_EXPIRE_HOURS` | `24` | 登录态有效期（小时） |
| `MONITOR_PUBLIC_URL` | 空 | 可选对外地址；配置后数据源自告警消息会附上面板链接 |
| `MONITOR_SOURCE_ALERT_THRESHOLD` | `3` | 数据源自告警：连续多少轮检查全部失败后经渠道告警（`0` 关闭） |
| `MONITOR_SOURCE_ALERT_REPEAT_MINUTES` | `60` | 告警未恢复时的重发间隔分钟数（`0` 不重发） |
| `MONITOR_TWEET_RETENTION_DAYS` | `30` | 未命中推文保留天数（滚动清理） |
| `MONITOR_HIT_RETENTION_DAYS` | `180` | 命中推文保留天数（重置节奏统计的数据源） |
| `MONITOR_RULES_JSON` | 内置规则 | 可选，用 JSON 数组覆盖命中规则 |

### 数据源（二选一即可，都配则自动切换）

**方案一：twitterapi.io（推荐首选）**

1. 注册 [twitterapi.io](https://twitterapi.io)，充值后创建 API Key
2. 在 `.env` 里填 `TWITTERAPI_IO_KEY=你的Key`
3. 成本：按量计费，增量轮询（每 5 分钟拉 1~2 页 ≈ 20~40 条，回复监控开启时为 2 页）月成本约几美元，以官网价格为准

**方案二：RSSHub（免费）**

Twitter 路由需要 RSSHub 实例配置 X 登录态，公共实例基本不可用，建议自建：

```bash
# 浏览器登录 x.com → F12 → Application → Cookies，复制 auth_token 的值
# （ct0 不需要，新版 RSSHub 运行时自动获取）
docker run -d --name rsshub -p 1200:1200 \
  -e TWITTER_AUTH_TOKEN=你的auth_token diygod/rsshub
# 实例建议开启鉴权：再加 -e ACCESS_KEY=随机密钥，验证与监控请求都带 ?key=密钥
# 验证 http://127.0.0.1:1200/twitter/user/thsottiaux?key=密钥 返回 XML 后，
# 在 .env 里填 RSSHUB_BASE_URL 和 RSSHUB_ACCESS_KEY
```

> 注意：Cookie 过期后 RSSHub 会静默失败，面板上该源会显示"失败"，届时更换 token 即可；
> 两个源都配时，一个挂了会自动切到另一个。

### 通知渠道（可多开）

| 渠道 | 需要的凭证 | 获取方式 |
|---|---|---|
| 飞书 | `FEISHU_WEBHOOK` | 群设置 → 群机器人 → 添加"自定义机器人" |
| 钉钉 | `DINGTALK_WEBHOOK` | 群机器人；若启用"自定义关键词"安全设置，关键词填 `Codex重置监控`（推送标题自带 `【Codex重置监控】` 前缀） |
| 企业微信 | `WECOM_WEBHOOK` | 群右键 → 添加群机器人 |
| Bark（iOS） | `BARK_URL` | App Store 装 Bark，填 `https://api.day.app/你的Key` |
| Telegram | `TG_BOT_TOKEN` + `TG_CHAT_ID` | @BotFather 建 bot；@userinfobot 查自己的 chat_id |

**怎么验证配好了**：把 `.env` 里 `MONITOR_ENV` 改成 `debug` 并重启，面板右上角会出现"发送测试通知"按钮，
点一下所有已配置渠道都会收到测试消息；验证完改回 `production`（改回后按钮隐藏，不影响正常推送）。

**推送长这样**（中英文由 `MONITOR_NOTIFY_LANG` 决定）：

```
🚨 Codex 重置监控命中
账号：@thsottiaux
命中规则：全球重置·英文
发布时间：2026-09-09 05:34:46（UTC+0）
发布时间：2026-09-09 13:34:46（UTC+8）

内容：
Usage limits have been reset for all paid ChatGPT Work and Codex users. …

直达推文：
https://x.com/thsottiaux/status/…
```

### 命中规则

内置五条规则（保存在 `app/core/config.py` 的 `DEFAULT_RULES`），逻辑：**同一条规则内所有关键词全部命中（忽略大小写）才触发**。

- **英文规则**：`reset` ∧ `usage/rate limits` ∧ (`paid`/`everyone`/`all`/`codex`…) —— 覆盖
  *"Usage limits have been reset for all paid…"*、*"I have reset everyone's Codex usage limits"* 等措辞
- **中文规则**：`重置` ∧ (`用量`/`限额`/`额度`/`付费`/`订阅`/`全球`) —— 兜底
- **英文宽松规则**：`reset` ∧ (`usage/rate limits` ∨ `a reset`) —— 兜底 *"I will reset usage limits this evening"* 这类预告，
  以及 *"A reset and a quick update…"* / *"a reset is also landing by midnight today"* 这类不提限额的公告（冠词限定避免 factory reset 等误报）
- **订阅暂停·英文**：`pause/suspend/halt/stop/close/on hold/no longer` ∧ (`subscription`/`sign-up`) ——
  覆盖 *"we're pausing subscriptions to our $200 Pro plan"* 这类停售公告
- **订阅恢复·英文**：`reopen/resume/unpause/back/again` ∧ (`subscription`/`sign-up`/`pro`) ——
  覆盖 *"Pro subscriptions are back"* 这类恢复公告（动作词刻意放宽：误报代价只是一次推送，漏报代价是错过恢复）

误报或漏报时，用 `MONITOR_RULES_JSON` 环境变量覆盖（JSON 数组，结构与内置一致；写错会自动回退内置规则并记录日志）。
想监控其他账号（如 @sama、@OpenAI），把 `MONITOR_ACCOUNTS` 改成逗号分隔即可。

## API

| 端点 | 说明 |
|---|---|
| `GET /` | 监控面板 |
| `GET /api/status` | 总状态（命中、数据源健康、通知渠道、规则） |
| `GET /api/tweets?hours=24` | 时间窗口内的帖子 |
| `GET /api/hits` | 历史命中记录 |
| `GET /api/polls` | 检查日志 |
| `GET /api/stats` | 重置节奏统计（平均间隔 / 上次命中 / 预期窗口） |
| `GET /api/translate?id=…&to=zh` | 翻译指定帖子（需登录；`to` 支持 `zh` / `en`，带 SQLite 缓存） |
| `POST /api/login` | 管理员登录，签发 JWT |
| `POST /api/poll-now` | 立即触发一次检查（需登录） |
| `POST /api/test-notify` | 向所有已配置渠道发测试消息（需登录） |
| `GET /healthz` | 健康检查 |

配置 `MONITOR_ADMIN_PASSWORD` 后，`POST /api/poll-now`、`POST /api/test-notify` 与 `/api/translate` 需先登录：
`POST /api/login` 以账密换 JWT，之后以 `Authorization: Bearer <token>` 携带。读接口与面板保持公开，
匿名访问 `/api/tweets` 时窗口上限钳制为 24 小时。
所有 `/api/*` 返回统一包体 `{code, data, message}`（成功 `code=200`）；异常时为 `{code, message, errors}`，HTTP 状态码与 `code` 一致。`/healthz` 例外，原样返回 `{"ok": true}`。响应出参为 Pydantic 模型，`/docs`（及 `/redoc`、`/openapi.json`）可查看 OpenAPI 结构，仅在 `MONITOR_ENV=debug` 环境开放，生产环境不注册这些路径。

## 行为细节

- **窗口与告警**：面板展示最近 24 小时（`MONITOR_LOOKBACK_HOURS` 可调）；只有"新入库且在窗口内"的命中推文才触发推送，
  首次启动回填的历史命中只入库不推送，避免半夜被旧闻吵醒
- **启动回扫**：每次启动用当前规则重扫最近 30 天的历史推文，命中的补上面板记录（改规则后历史判定自愈）；
  其中 24 小时内发布且从未推送过的错过公告会补推，更早的只补记录不再推送，已推送或有渠道尝试记录的不重发
- **不重复打扰**：同一公告被发布多条推文（内容高度相似）只推第一条
- **时延**：轮询间隔默认 5 分钟。重置公告从发推到生效通常有几小时窗口，5 分钟足够；调小会更及时，抓取费用相应增加
- **自告警**：数据源连续 `MONITOR_SOURCE_ALERT_THRESHOLD`（默认 3）轮检查全部失败时，经全部已配置渠道发告警，恢复后发恢复通知；
  告警状态存库，重启后既不重复打扰也不漏发恢复；未配置任何数据源不算失败，DEMO 模式不告警也不真实推送
- **访问鉴权**：`MONITOR_ADMIN_PASSWORD` 留空即完全关闭；配置后面板匿名可看（`/api/tweets` 匿名窗口钳制 24 小时），
  立即检查 / 测试通知 / 翻译需登录（JWT 默认 24 小时，密钥未显式配置时从口令派生，改口令全量失效）
- **数据保留**：未命中推文保留 30 天滚动清理，命中推文保留 180 天（供"重置节奏"统计采样，两者均可配置）；检查日志只保留 30 天

## 常驻运行（可选）

```bash
# 方式一：nohup 后台运行
nohup bash start-backend.sh > reset-monitor.log 2>&1 &

# 方式二：launchd（macOS 开机自启）
# 创建 ~/Library/LaunchAgents/com.openai_reset_monitoring.plist，内容按需修改：
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.openai_reset_monitoring</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-c</string>
    <string>cd /path/to/OpenAI-Reset-Monitoring &amp;&amp; bash start-backend.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>TWITTERAPI_IO_KEY</key><string>你的Key</string>
  </dict>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.openai_reset_monitoring.plist
```

## 项目结构

```
frontend/             # React 独立前端工程（Vite + React 19 + TS，bun 管理依赖，react-i18next + React Bits）
├── src/api/          # 接口层：统一包体/JWT 会话/后端出参类型
├── src/components/   # Nav / Footer / LoginDialog + React Bits 动画组件（CountUp / AnimatedContent）
├── src/context/      # Auth / Theme / Toast 跨模块状态
├── src/features/     # 业务区块：hero / feed / sidebar
├── src/i18n/         # i18next 初始化 + locales/{zh,en}.ts
├── src/styles/       # panel.css（全量样式：主题令牌 / 布局 / 组件 / 动效）
├── Caddyfile         # 生产入口：静态托管 + /api 反代到后端容器（SPA 回退、缓存策略）
├── Dockerfile        # 前端镜像：bun 构建 → Caddy 托管
└── public/assets/    # favicon（深浅两套）/ LOGO / apple-touch-icon

app/
├── main.py            # 服务入口：应用装配 + 面板页面，/api/* 路由在 api/ 按域拆分
├── api/               # 路由层：auth / status / tweets / polls / stats / translate / system（健康检查、测试通知）
├── core/              # 横切基础
│   ├── config.py      # 配置加载（.env / 环境变量）+ 内置命中规则
│   ├── errors.py      # 统一异常处理：异常转同状态码包体
│   ├── security.py    # JWT 登录鉴权（签发 / 校验 / 保护依赖）
│   ├── timeutil.py    # 时间解析 / UTC 格式化
│   └── text.py        # 文本归一化 / 相似度 / 内容指纹
├── schemas/           # 出参构造：各接口 DTO 与 /api/* 统一响应包裹
├── models/            # ORM 模型（表名、列名与旧库完全一致）
├── repositories/      # 数据访问层：推文/检查日志/源健康/通知日志/翻译缓存
├── db/
│   └── database.py    # SQLite 异步引擎/会话/建表与防御迁移
├── services/          # 业务层：轮询调度/规则匹配/状态聚合/查询/翻译/测试通知/数据源自监控
│   ├── matcher.py     # 关键词命中规则
│   ├── poller.py      # 轮询调度：拉取 → 去重 → 匹配 → 推送
│   ├── source_watch.py# 数据源自告警：连续失败经渠道告警、恢复发通知
│   └── stats.py       # 重置节奏统计（/api/stats）
├── integrations/      # 外部系统适配
│   ├── translate.py   # 翻译上游 API 客户端（Google / MyMemory）
│   ├── sources/       # 数据源适配器：twitterapi_io / rsshub / demo + 自动切换
│   └── notifiers/     # 通知渠道：feishu / dingtalk / wecom / bark / telegram
```

前端工程细节（目录职责、i18n 与 React Bits 约定）见 [frontend/README.md](frontend/README.md)。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
