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
- 📊 **监控面板**：左侧告警横幅 + 24 小时帖子流；右侧实时统计、数据源、通知渠道、历史命中、检查日志；60 秒自动刷新
- 🕐 **时间一目了然**：每条帖子同时标注真实发布时间（UTC+0）、换算时间（UTC+8）和"N 小时前发布"，推送消息同样双时区
- 🔤 **帖子一键翻译**：帖子卡片自带"翻译"按钮，机器翻译为中文（Google 通道为主、MyMemory 兜底，均免 key），译文进 SQLite 缓存，刷新页面不丢失
- 🌓 **深浅色主题**：深色 / 浅色 / 跟随系统三种模式，偏好本地记忆
- 🌍 **中英文界面**：面板语言跟随浏览器设置，推送消息语言可独立配置
- 🧪 **DEMO 模式**：无需任何凭证即可本地体验完整流程

## 快速开始

```bash
# 1.（可选）先跑 DEMO 模式看效果，无需任何配置
DEMO=1 bash run.sh
# 打开 http://127.0.0.1:8730（若已创建 .env，端口以 .env 里的 MONITOR_PORT 为准）

# 2. 正式启用：创建 .env 并填入凭证（run.sh 首次运行也会自动创建）
cp .env.example .env
# 编辑 .env（每一项都有注释引导），然后重启：
bash run.sh
```

启动后访问 `http://127.0.0.1:端口`。端口看 `.env` 里的 `MONITOR_PORT`
（示例配置给的是 `8080`，什么都不配时内置默认是 `8730`）。

`run.sh` 会自动创建虚拟环境并安装依赖：检测到 [uv](https://docs.astral.sh/uv/) 时用 uv（更快），
否则自动回退 `python3 -m venv` + pip。uv 用户也可以手动 `uv sync` 同步依赖
（依赖同时声明在 `pyproject.toml`，mypy 在 dev 依赖组里）。

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
- **右上角按钮**：主题切换、立即检查；"发送测试通知"仅在 `MONITOR_ENV=debug` 时出现（见下文）

## 配置说明

配置全部通过项目根目录的 `.env` 文件（或系统环境变量）完成。
优先级：**系统环境变量 > `.env` 文件 > 内置默认值**。
核心约定：**数据源与通知渠道填了凭证即启用，留空即停用**。每一项的获取方式都写在 `.env.example` 的注释里。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `MONITOR_ENV` | `production` | 设为 `debug` 时面板才显示"发送测试通知"按钮，并开放 `/docs`、`/redoc`、`/openapi.json` API 文档 |
| `MONITOR_SITE_NAME` | `Codex Reset Monitor` | 面板名称（浏览器标签页标题 + 导航栏名称） |
| `MONITOR_ACCOUNTS` | `thsottiaux` | 监控的 X 账号，逗号分隔，不带 @ |
| `MONITOR_POLL_INTERVAL` | `5` | 轮询间隔（分钟） |
| `MONITOR_LOOKBACK_HOURS` | `24` | 面板展示与告警窗口（小时） |
| `MONITOR_INCLUDE_REPLIES` | `true` | 是否同时监控回复（公告偶尔以回复形式补充）；RSSHub 源无法判定回复，面板徽章仅 twitterapi.io 有 |
| `MONITOR_HOST` / `MONITOR_PORT` | `127.0.0.1` / `8730` | 面板服务监听地址（示例配置为 `0.0.0.0:8080`） |
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
| `MONITOR_RULES_JSON` | 内置规则 | 可选，用 JSON 数组覆盖命中规则 |
| `DEMO` | 空 | 设为 `1` 使用内置演示数据 |

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

## Docker 部署

项目自带 `Dockerfile` 与 `docker-compose.yml`（配置复用根目录 `.env`，数据库挂载 `./data` 持久化）：

```bash
docker compose up -d --build   # 构建并后台启动
docker compose logs -f         # 查看日志
docker compose down            # 停止（数据保留在 ./data）
```

宿主机端口跟随 `.env` 的 `MONITOR_PORT`。`.env` 不会被打进镜像，密钥在运行时注入。

## 部署为常驻服务（可选）

```bash
# 方式一：nohup 后台运行
nohup bash run.sh > reset-monitor.log 2>&1 &

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
    <string>cd /path/to/OpenAI-Reset-Monitoring &amp;&amp; bash run.sh</string>
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

## API

| 端点 | 说明 |
|---|---|
| `GET /` | 监控面板 |
| `GET /api/status` | 总状态（命中、数据源健康、通知渠道、规则） |
| `GET /api/tweets?hours=24` | 时间窗口内的帖子 |
| `GET /api/hits` | 历史命中记录 |
| `GET /api/polls` | 检查日志 |
| `GET /api/translate?id=…&to=zh` | 翻译指定帖子（`to` 支持 `zh` / `en`，带 SQLite 缓存） |
| `POST /api/poll-now` | 立即触发一次检查 |
| `POST /api/test-notify` | 向所有已配置渠道发测试消息 |
| `GET /healthz` | 健康检查 |

所有 `/api/*` 返回统一包体 `{code, data, message}`（成功 `code=200`）；异常时为 `{code, message, errors}`，HTTP 状态码与 `code` 一致。`/healthz` 例外，原样返回 `{"ok": true}`。响应出参为 Pydantic 模型，`/docs`（及 `/redoc`、`/openapi.json`）可查看 OpenAPI 结构，仅在 `MONITOR_ENV=debug` 环境开放，生产环境不注册这些路径。

## 行为细节

- **窗口与告警**：面板展示最近 24 小时（`MONITOR_LOOKBACK_HOURS` 可调）；只有"新入库且在窗口内"的命中推文才触发推送，
  首次启动回填的历史命中只入库不推送，避免半夜被旧闻吵醒
- **不重复打扰**：同一公告被发布多条推文（内容高度相似）只推第一条
- **时延**：轮询间隔默认 5 分钟。重置公告从发推到生效通常有几小时窗口，5 分钟足够；调小会更及时，抓取费用相应增加
- **数据保留**：帖子永久保留在 `data/monitor.db`（体量很小），历史命中跨窗口可见；检查日志只保留 30 天

## 项目结构

```
app/
├── main.py            # 服务入口：应用装配 + 面板页面，/api/* 路由在 api/ 按域拆分
├── api/               # 路由层：status / tweets / polls / translate / system（健康检查、测试通知）
├── core/              # 横切基础
│   ├── config.py      # 配置加载（.env / 环境变量）+ 内置命中规则
│   ├── errors.py      # 统一异常处理：异常转同状态码包体
│   ├── timeutil.py    # 时间解析 / UTC 格式化
│   └── text.py        # 文本归一化 / 相似度 / 内容指纹
├── schemas/           # 出参构造：各接口 DTO 与 /api/* 统一响应包裹
├── models/            # ORM 模型（表名、列名与旧库完全一致）
├── repositories/      # 数据访问层：推文/检查日志/源健康/通知日志/翻译缓存
├── db/
│   └── database.py    # SQLite 异步引擎/会话/建表与防御迁移
├── services/          # 业务层：轮询调度/规则匹配/状态聚合/查询/翻译/测试通知
│   ├── matcher.py     # 关键词命中规则
│   └── poller.py      # 轮询调度：拉取 → 去重 → 匹配 → 推送
├── integrations/      # 外部系统适配
│   ├── translate.py   # 翻译上游 API 客户端（Google / MyMemory）
│   ├── sources/       # 数据源适配器：twitterapi_io / rsshub / demo + 自动切换
│   └── notifiers/     # 通知渠道：feishu / dingtalk / wecom / bark / telegram
└── web/               # 监控面板（原生 ES Module，无前端构建步骤）
    ├── index.html     # 页面外壳 + 首屏防闪烁主题脚本
    └── static/
        ├── css/panel.css    # 全部样式（主题令牌 / 布局 / 组件 / 动效 / 移动端）
        └── js/              # 按职责拆分的模块，main.js 负责装配
            ├── dom.js       # 选择器 / 转义 / toast / 数字动画 / 首屏 reveal
            ├── i18n.js      # 文案字典与语言状态（zh / en / 自动）
            ├── format.js    # 时间格式化与命中词高亮
            ├── api.js       # /api/* 请求封装（统一响应包体）
            ├── theme.js     # 主题三态 + 选项卡滑块 + favicon 跟随
            ├── icons.js     # 内联 SVG 常量
            ├── translate.js # 译文缓存 + 展开/收起（重绘后保持手动收起状态）
            ├── feed.js      # 信息流卡片与命中历史渲染
            ├── panel.js     # hero / 数据源 / 检查日志渲染
            └── main.js      # 刷新主循环、顶部按钮与跨模块联动装配
```

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
