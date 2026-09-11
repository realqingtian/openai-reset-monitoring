# Codex Reset Monitor (OpenAI Reset Monitoring)

[中文](README.md) | English

Watches the public posts of X (Twitter) user [@thsottiaux](https://x.com/thsottiaux) (Tibo · the person behind
OpenAI Codex) over the last 24 hours. When a "**global usage-limit reset**" announcement shows up, it raises an
alert on the dashboard and pushes notifications to Feishu / DingTalk / WeCom / Bark / Telegram.

> Background: Tibo follows a "weekly reset" cadence (e.g. *"Usage limits have been reset for all paid ChatGPT Work
> and Codex users"*). This tool tells you the moment it happens.

![Dashboard overview](docs/panel.png)

## Features

- ⏱ **Scheduled polling**: fetches the account timeline every 5 minutes by default (configurable), deduplicated
  by tweet ID into SQLite
- 🔀 **Dual-source failover**: twitterapi.io (third-party crawl API) and RSSHub (free) fail over automatically when
  both are configured; with only one filled, that one is used
- 🎯 **Keyword matching**: regex rules designed around Tibo's real wording (Chinese & English); matched terms are
  highlighted on the dashboard
- 🔔 **Five push channels**: Feishu / DingTalk / WeCom / Bark / Telegram; each hit pushes at most once per channel,
  failed channels are retried automatically (succeeded ones are never re-sent), duplicate announcements never disturb twice
- 📊 **Dashboard**: alert banner + 24-hour post feed on the left; live stats, sources, channels, hit history and
  check logs on the right; auto refresh every 60 seconds
- 🕐 **Timestamps at a glance**: every post shows the real publish time (UTC+0), the converted time (UTC+8) and
  "published N hours ago"; push messages carry both timezones as well
- 🔤 **One-click translation**: each post card has a "Translate" button (Google channel first, MyMemory fallback,
  both key-free); translations are cached in SQLite and survive page refreshes
- 🌓 **Light/dark theme**: dark / light / follow-system, preference remembered locally
- 🌍 **Chinese & English UI**: the dashboard language follows the browser; the push message language is configured
  independently
- 🧪 **DEMO mode**: experience the full flow locally without any credentials

## Quick start

```bash
# 1. (optional) try DEMO mode first — no configuration needed
DEMO=1 bash run.sh
# open http://127.0.0.1:8730 (if a .env exists, the port follows MONITOR_PORT in it)

# 2. production: create .env and fill in credentials (run.sh also creates it on first run)
cp .env.example .env
# edit .env (every item has guiding comments), then restart:
bash run.sh
```

Once started, visit `http://127.0.0.1:<port>`. The port follows `MONITOR_PORT` in `.env`
(the sample config uses `8080`; with no configuration the built-in default is `8730`).

`run.sh` creates the virtualenv and installs dependencies automatically: it uses [uv](https://docs.astral.sh/uv/)
when available (faster), otherwise falls back to `python3 -m venv` + pip. uv users can also run `uv sync` manually
(dependencies are declared in `pyproject.toml`; mypy lives in the dev dependency group).

## Reading the dashboard

- **Top banner**: normally "Monitoring · last check N minutes ago"; when a reset announcement hits it turns into a
  red alert with a direct link
- **Last 24 hours posts**: each post carries three time labels —
  `Published UTC+0` (the real publish time, also the raw time from the X API),
  `UTC+8` (converted, same as what you see on X),
  `published N hours ago` (updated on every refresh).
  Hit posts carry a purple "hit" badge with the matched terms highlighted
- **Post translation**: click "Translate" under a card to expand the machine translation (click again to collapse);
  translations are cached per tweet permanently, only the first click really calls the translation API; the button is
  hidden for English posts while the UI language is English
- **Live stats**: tweets in window, hit announcements, polling interval
- **Sources / channels**: each source shows "healthy / failed · N minutes ago"; channels show readiness
- **Hit history**: every hit ever (not limited to the 24-hour window), up to two lines of content, click a row to
  open the original tweet
- **Check logs**: one entry per poll (time, source, success/failure, new tweets, latency), kept for 30 days, paginated
- **Top-right buttons**: theme switcher, check now; "Send test notification" only appears with `MONITOR_ENV=debug`
  (see below)

## Configuration

All configuration is done through the `.env` file at the project root (or system environment variables).
Priority: **system environment variables > `.env` file > built-in defaults**.
Core convention: **a source or channel is enabled once its credentials are filled, and disabled when left empty**.
How to obtain every item is documented in the comments of `.env.example`.

| Env var | Default | Description |
|---|---|---|
| `MONITOR_ENV` | `production` | with `debug` the dashboard shows the "Send test notification" button and serves `/docs`, `/redoc`, `/openapi.json` API docs |
| `MONITOR_SITE_NAME` | `Codex Reset Monitor` | dashboard name (browser tab title + navbar) |
| `MONITOR_ACCOUNTS` | `thsottiaux` | X accounts to watch, comma separated, without @ |
| `MONITOR_POLL_INTERVAL` | `5` | polling interval (minutes) |
| `MONITOR_LOOKBACK_HOURS` | `24` | dashboard & alert window (hours) |
| `MONITOR_HOST` / `MONITOR_PORT` | `127.0.0.1` / `8730` | dashboard listen address (the sample config uses `0.0.0.0:8080`) |
| `TWITTERAPI_IO_KEY` | empty | twitterapi.io API key; empty disables the source |
| `RSSHUB_BASE_URL` | empty | RSSHub instance URL; empty disables the source |
| `RSSHUB_ROUTE` | `twitter/user` | RSSHub route |
| `RSSHUB_ACCESS_KEY` | empty | fill with the same value when the RSSHub instance enables `ACCESS_KEY` auth |
| `FEISHU_WEBHOOK` | empty | Feishu group bot webhook |
| `DINGTALK_WEBHOOK` | empty | DingTalk group bot webhook |
| `WECOM_WEBHOOK` | empty | WeCom group bot webhook |
| `BARK_URL` | empty | Bark push URL (https://api.day.app/yourKey) |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | empty | Telegram bot credentials (both required to enable) |
| `MONITOR_NOTIFY_LANG` | `zh` | push message language: `zh` / `en` (the dashboard language follows the browser, independent of this) |
| `MONITOR_RULES_JSON` | built-in rules | optional JSON array overriding the match rules |
| `DEMO` | empty | set to `1` to run on built-in demo data |

### Sources (pick one; both configured = automatic failover)

**Option 1: twitterapi.io (recommended)**

1. Sign up at [twitterapi.io](https://twitterapi.io), top up and create an API key
2. Fill `TWITTERAPI_IO_KEY=yourKey` in `.env`
3. Cost: pay per use; incremental polling (1 page ≈ 20 tweets per 5 minutes) costs a few dollars a month —
   see the official site for pricing

**Option 2: RSSHub (free)**

Twitter routes need an RSSHub instance with an X login session; public instances are basically unusable,
so self-host one:

```bash
# Log into x.com in the browser → F12 → Application → Cookies, copy the auth_token value
# (ct0 is not needed — the newer RSSHub fetches it automatically at runtime)
docker run -d --name rsshub -p 1200:1200 \
  -e TWITTER_AUTH_TOKEN=your_auth_token diygod/rsshub
# Recommended: enable auth on the instance by adding -e ACCESS_KEY=random_secret;
# both verification and monitoring requests then carry ?key=secret
# After http://127.0.0.1:1200/twitter/user/thsottiaux?key=secret returns XML,
# fill RSSHUB_BASE_URL and RSSHUB_ACCESS_KEY in .env
```

> Note: an expired cookie makes RSSHub fail silently; the source shows "failed" on the dashboard — just replace the
> token then. With both sources configured, a failing one automatically switches to the other.

### Push channels (multiple allowed)

| Channel | Credentials | How to obtain |
|---|---|---|
| Feishu | `FEISHU_WEBHOOK` | Group settings → Group bot → Add "custom bot" |
| DingTalk | `DINGTALK_WEBHOOK` | Group bot; if the "custom keyword" security setting is enabled, use `Codex重置监控` (push titles carry the `【Codex重置监控】` prefix) |
| WeCom | `WECOM_WEBHOOK` | Right-click the group → Add group bot |
| Bark (iOS) | `BARK_URL` | Install Bark from the App Store, fill `https://api.day.app/yourKey` |
| Telegram | `TG_BOT_TOKEN` + `TG_CHAT_ID` | Create a bot with @BotFather; get your chat_id from @userinfobot |

**How to verify the setup**: set `MONITOR_ENV=debug` in `.env` and restart — the "Send test notification" button
appears in the top-right of the dashboard; click it and every configured channel receives a test message. Switch back
to `production` afterwards (the button hides again; normal pushing is unaffected).

**A push looks like this** (language set by `MONITOR_NOTIFY_LANG`, English shown):

```
🚨 Codex Reset Monitor Hit
Account: @thsottiaux
Matched rule: 全球重置·英文
Published: 2026-09-09 05:34:46 (UTC+0)
Published: 2026-09-09 13:34:46 (UTC+8)

Content:
Usage limits have been reset for all paid ChatGPT Work and Codex users. …

Open tweet:
https://x.com/thsottiaux/status/…
```

> The matched-rule name comes from your rule configuration; the built-in rule names are Chinese —
> override them with `MONITOR_RULES_JSON` if you want English names.

## Docker deployment

The project ships a `Dockerfile` and `docker-compose.yml` (configuration is reused from the root `.env`;
the database is persisted in `./data`):

```bash
docker compose up -d --build   # build and start in the background
docker compose logs -f         # follow logs
docker compose down            # stop (data kept in ./data)
```

The host port follows `MONITOR_PORT` in `.env`. `.env` is not baked into the image; secrets are injected at runtime.

## Run as a resident service (optional)

```bash
# Option 1: nohup in the background
nohup bash run.sh > reset-monitor.log 2>&1 &

# Option 2: launchd (autostart on macOS)
# create ~/Library/LaunchAgents/com.openai_reset_monitoring.plist and adjust as needed:
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
    <key>TWITTERAPI_IO_KEY</key><string>yourKey</string>
  </dict>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.openai_reset_monitoring.plist
```

## API

| Endpoint | Description |
|---|---|
| `GET /` | dashboard |
| `GET /api/status` | overall status (hits, source health, channels, rules) |
| `GET /api/tweets?hours=24` | posts within the time window |
| `GET /api/hits` | hit history |
| `GET /api/polls` | check logs |
| `GET /api/translate?id=…&to=zh` | translate a post (`to` supports `zh` / `en`, cached in SQLite) |
| `POST /api/poll-now` | trigger a check immediately |
| `POST /api/test-notify` | send a test message to all configured channels |
| `GET /healthz` | health check |

All `/api/*` responses share the envelope `{code, data, message}` (`code=200` on success); errors use
`{code, message, errors}` with the HTTP status matching `code`. `/healthz` is the exception and returns
`{"ok": true}` verbatim. Responses are Pydantic models; `/docs` (plus `/redoc` and `/openapi.json`) exposes the
OpenAPI schema and is available only with `MONITOR_ENV=debug` — production does not register those paths.

## Behavior details

- **Window & alerts**: the dashboard shows the last 24 hours (`MONITOR_LOOKBACK_HOURS` configurable); only
  "freshly stored and in-window" hits trigger pushes — backfilled historical hits are stored without pushing,
  so old news never wakes you in the middle of the night
- **No duplicate noise**: the same announcement posted as several tweets (highly similar content) pushes only the
  first one
- **Latency**: the default poll interval is 5 minutes. Reset announcements usually land hours before they take
  effect, so 5 minutes is enough; lowering it gets you there sooner and costs more per fetch
- **Retention**: posts are kept forever in `data/monitor.db` (tiny), so hit history stays visible across windows;
  check logs are kept for 30 days

## Project structure

```
app/
├── main.py            # entry point: app assembly + dashboard page; /api/* routes split by domain under api/
├── api/               # routing layer: status / tweets / polls / translate / system (health check, test notify)
├── core/              # cross-cutting basics
│   ├── config.py      # configuration loading (.env / environment variables) + built-in match rules
│   ├── errors.py      # unified exception handling: exceptions to same-status-code bodies
│   ├── timeutil.py    # time parsing / UTC formatting
│   └── text.py        # text normalization / similarity / content fingerprint
├── schemas/           # response models: per-endpoint DTOs and the unified /api/* envelope
├── models/            # ORM models (table & column names identical to the legacy schema)
├── repositories/      # data access: tweets / polls / source health / notify log / translation cache
├── db/
│   └── database.py    # SQLite async engine / sessions / table creation & defensive migrations
├── services/          # business layer: poll scheduling / matching / status aggregation / queries / translation / test notify
│   ├── matcher.py     # keyword match rules
│   └── poller.py      # polling scheduler: fetch → dedup → match → push
├── integrations/      # external system adapters
│   ├── translate.py   # translation upstream API client (Google / MyMemory)
│   ├── sources/       # source adapters: twitterapi_io / rsshub / demo + automatic failover
│   └── notifiers/     # channels: feishu / dingtalk / wecom / bark / telegram
└── web/index.html     # dashboard (single file, no frontend build step)
```

## License

Released under the [MIT License](LICENSE).
