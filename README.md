# Codex 重置监控面板（OpenAI Reset Monitoring）

监控 X（Twitter）用户 [@thsottiaux](https://x.com/thsottiaux)（Tibo · OpenAI Codex 负责人）最近 24 小时的公开帖子，
命中"**全球重置付费订阅用量**"类公告时，在面板高亮告警并推送到飞书 / 钉钉 / 企业微信 / Bark / Telegram。

> 背景：Tibo 已形成"每周一重置"的规律（如 *"Usage limits have been reset for all paid ChatGPT Work and Codex users"*），
> 本工具帮你在第一时间知道重置发生。

## 功能

- ⏱ **定时轮询**：默认每 5 分钟拉取一次账号时间线（可配置），按推文 ID 去重入库（SQLite）
- 🔀 **双数据源故障切换**：twitterapi.io（第三方抓取 API）为主，RSSHub 为免费兜底；主源失败自动切备源
- 🎯 **关键词命中**：参考 Tibo 真实措辞设计的正则规则（中英文各一条），命中词在面板高亮
- 🔔 **五渠道推送**：飞书 / 钉钉 / 企微 / Bark / Telegram，每条推文只推一轮，不重复打扰
- 📊 **监控面板**：全景驾驶舱布局——左栏告警横幅 + 24h 信息流 + 检查日志，右栏粘性系统面板（统计/数据源/通知渠道）与紧凑历史命中；60 秒自动刷新
- 🌓 **深浅色主题**：深色 / 浅色 / 跟随系统三种模式（导航栏切换），偏好本地记忆，切换带整页过渡动画
- 🎬 **动效交互**：统计数字滚动、新推文级联入场、命中词闪光、状态切换过渡（尊重 `prefers-reduced-motion`）
- 🧪 **DEMO 模式**：无需任何凭证即可本地演示完整流程

## 快速开始

```bash
# 1.（可选）先跑 DEMO 模式看效果，无需任何配置
DEMO=1 bash run.sh
# 打开 http://127.0.0.1:8730

# 2. 正式启用：创建 .env 并填入凭证（run.sh 首次运行也会自动创建）
cp .env.example .env
# 编辑 .env（每一项都有注释引导），然后重启：
bash run.sh
```

`run.sh` 会自动创建 `.venv` 并安装依赖：**检测到 [uv](https://docs.astral.sh/uv/) 时用 uv（更快），否则回退 `python3 -m venv` + pip**。

## 配置说明

配置全部通过环境变量 / 项目根目录的 `.env` 文件完成（不再使用 YAML）。优先级：**系统环境变量 > `.env` 文件 > 内置默认值**。核心约定：**数据源与通知渠道填了凭证即启用，留空即停用**。每一项的获取方式都写在 `.env.example` 的注释里。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `MONITOR_ENV` | `production` | 运行环境：`debug` 时面板显示"发送测试通知"按钮 |
| `MONITOR_SITE_NAME` | `Codex Reset Monitor` | 面板名称（浏览器标签页标题 + 导航栏名称） |
| `MONITOR_ACCOUNTS` | `thsottiaux` | 监控的 X 账号，逗号分隔，不带 @ |
| `MONITOR_POLL_INTERVAL` | `5` | 轮询间隔（分钟） |
| `MONITOR_LOOKBACK_HOURS` | `24` | 面板展示与告警窗口（小时） |
| `MONITOR_HOST` / `MONITOR_PORT` | `127.0.0.1` / `8730` | 面板服务监听地址 |
| `TWITTERAPI_IO_KEY` | 空 | twitterapi.io API Key，留空停用该源 |
| `RSSHUB_BASE_URL` | 空 | RSSHub 实例地址，留空停用该源 |
| `RSSHUB_ROUTE` | `twitter/user` | RSSHub 路由 |
| `FEISHU_WEBHOOK` | 空 | 飞书群机器人 Webhook |
| `DINGTALK_WEBHOOK` | 空 | 钉钉群机器人 Webhook |
| `WECOM_WEBHOOK` | 空 | 企业微信群机器人 Webhook |
| `MONITOR_NOTIFY_LANG` | `zh` | 推送消息模板语言：`zh` / `en`（面板语言自动跟随浏览器） |
| `BARK_URL` | 空 | Bark 推送地址（https://api.day.app/你的Key） |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | 空 | Telegram Bot 凭证（两者都填才启用） |
| `MONITOR_RULES_JSON` | 内置规则 | 可选，用 JSON 数组覆盖命中规则 |
| `DEMO` | 空 | 设为 `1` 使用内置演示数据 |

### 数据源（二选一即可，都配则自动故障切换）

**方案一：twitterapi.io（推荐首选）**

1. 注册 [twitterapi.io](https://twitterapi.io)，充值后创建 API Key
2. 在 `.env` 里填 `TWITTERAPI_IO_KEY=你的Key`（或 export 为系统环境变量）
3. 成本：按量计费，增量轮询（每 5 分钟拉 1 页 ≈ 20 条）月成本约几美元，以官网价格为准

**方案二：RSSHub（免费兜底）**

Twitter 路由需要 RSSHub 实例配置 X 登录态，公共实例基本不可用，建议本地自建：

```bash
# 浏览器登录 x.com → F12 → Application → Cookies，复制 auth_token 的值
# （ct0 不需要，新版 RSSHub 运行时自动获取；多账号逗号分隔可做轮询）
docker run -d --name rsshub -p 1200:1200 \
  -e TWITTER_AUTH_TOKEN=你的auth_token diygod/rsshub
# 实例建议开启鉴权：再加 -e ACCESS_KEY=随机密钥，验证与监控请求都带 ?key=密钥
# 验证 http://127.0.0.1:1200/twitter/user/thsottiaux?key=密钥 返回 XML 后，
# 在 .env 里填 RSSHUB_BASE_URL 和 RSSHUB_ACCESS_KEY
```

> 注意：Cookie 过期后 RSSHub 会静默失败。面板上该源会显示"失败"，届时更换 token 即可；
> 若主源（twitterapi.io）正常，RSSHub 只在主源挂掉时才会被用到。

### 通知渠道（可多开）

| 渠道 | 需要的凭证 | 获取方式 |
|---|---|---|
| 飞书 | `FEISHU_WEBHOOK` | 群设置 → 群机器人 → 添加"自定义机器人" |
| 钉钉 | `DINGTALK_WEBHOOK` | 群机器人；若启用"自定义关键词"安全设置，关键词填 `Codex重置监控`（推送自带此前缀） |
| 企业微信 | `WECOM_WEBHOOK` | 群右键 → 添加群机器人 |
| Bark（iOS） | `BARK_URL` | App Store 装 Bark，填 `https://api.day.app/你的Key` |
| Telegram | `TG_BOT_TOKEN` + `TG_CHAT_ID` | @BotFather 建 bot；@userinfobot 查自己的 chat_id |

配好后点击面板右上角"**发送测试通知**"验证全部渠道。

### 命中规则

默认两条规则内置在 `app/config.py`（也可用 `MONITOR_RULES_JSON` 覆盖），逻辑：**同一条规则内所有 pattern 全部命中（忽略大小写的正则）才触发**。

- 英文规则：`reset` ∧ `usage/rate limits` ∧ (`paid`/`everyone`/`all`/`codex`/`we`…) —— 覆盖
  *"Usage limits have been reset for all paid…"*、*"I have reset everyone's Codex usage limits"*、*"I will reset usage limits…"* 等措辞
- 中文规则：`重置` ∧ (`用量`/`限额`/`付费`/`订阅`/`全球`) —— 兜底

内置规则保存在 `app/config.py` 的 `DEFAULT_RULES`。误报/漏报时用 `MONITOR_RULES_JSON` 覆盖（JSON 数组，结构与内置一致，同一条规则内所有正则全部命中才触发），非法 JSON 会自动回退到内置规则并记录日志。想监控其他账号（如 @sama、@OpenAI），在 `.env` 里把 `MONITOR_ACCOUNTS` 改成逗号分隔即可。

## Docker 部署

项目自带 `Dockerfile` 与 `docker-compose.yml`（配置复用根目录 `.env`，数据库挂载 `./data` 持久化）：

```bash
docker compose up -d --build   # 构建并后台启动
docker compose logs -f         # 查看日志
docker compose down            # 停止（数据保留在 ./data）
```

宿主机端口默认 `8730`，在 `.env` 里改 `MONITOR_PORT` 即可（如 `MONITOR_PORT=8080` 则映射为 `8080:8730`）。`.env` 不会被打进镜像，密钥通过 compose 的 `env_file` 在运行时注入。

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
    <string>cd /Users/sunny/Desktop/workspace/OpenAI-Reset-Monitoring &amp;&amp; bash run.sh</string>
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
| `POST /api/poll-now` | 立即触发一次检查 |
| `POST /api/test-notify` | 向所有已配置渠道发测试消息 |
| `GET /healthz` | 健康检查 |

## 行为细节

- **窗口与告警**：面板展示最近 24 小时（`lookback_hours` 可调）；只有"新入库且在窗口内"的命中推文才触发推送，
  首次启动回填的历史命中只入库不推送，避免半夜被旧闻吵醒
- **时延**：轮询间隔默认 5 分钟。重置公告从发推到生效通常有几小时窗口，5 分钟足够；调小会更及时，抓取费用相应增加
- **数据保留**：所有抓取过的推文永久保留在 `data/monitor.db`（体量很小），"历史命中记录"跨窗口可见

## 项目结构

```
app/
├── main.py            # FastAPI 入口：页面 + API + 后台轮询任务
├── config.py          # 配置加载（.env / 环境变量）
├── db.py              # SQLite（推文/检查日志/源健康/通知日志）
├── matcher.py         # 关键词命中规则
├── poller.py          # 轮询调度：拉取→去重→匹配→推送
├── demo.py            # DEMO=1 模拟数据源
├── sources/           # 数据源适配器：twitterapi_io / rsshub + 故障切换
├── notifiers/         # 通知渠道：feishu / dingtalk / wecom / bark / telegram
└── web/index.html     # 监控面板（高端玻璃暗色风，无前端构建依赖）
```
