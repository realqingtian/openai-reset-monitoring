#!/usr/bin/env bash
# 后端启动脚本（macOS / Linux）：自动创建虚拟环境并安装依赖，然后以 python -m app.main 启动。
# 前端开发另开终端：cd frontend && bun install && bun dev（见 frontend/README.md）。
# 生产容器化部署见 docker-compose.yml；Windows 用户使用 start-backend.bat。
# 工具分级回退：uv → python3 venv + pip，都没有则报错退出。
set -e
cd "$(dirname "$0")"

# 首次运行：自动从模板创建 .env 配置文件
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "==> 已根据 .env.example 创建 .env，编辑填入凭证后重启生效"
  echo "    （暂时不填也可以：DEMO=1 bash start-backend.sh 可用内置演示数据体验）"
fi

if command -v uv >/dev/null 2>&1; then
  echo "==> 使用 uv 管理环境（uv sync，依赖版本以 uv.lock 为准）"
  # --inexact：只补齐不删包，保留 .venv 里 PyCharm / 手动安装的额外包（用户自管环境）
  uv sync --inexact
elif command -v python3 >/dev/null 2>&1; then
  echo "==> 未检测到 uv，使用 python3 venv + pip（依赖清单退回 requirements.txt）"
  [ -d .venv ] || python3 -m venv .venv
  . .venv/bin/activate
  pip install -q -r requirements.txt
else
  echo "!! 后端开发需要 uv 或 Python 3（≥3.9）二者之一，均未检测到：" >&2
  echo "   - uv 安装：https://docs.astral.sh/uv/getting-started/installation/" >&2
  echo "   - Python 安装：https://www.python.org/downloads/" >&2
  exit 1
fi

# 端口与监听地址读取 .env（MONITOR_PORT / MONITOR_HOST，默认 127.0.0.1:8730）
echo "==> 启动后端（等价手动命令：.venv/bin/python -m app.main）"
exec .venv/bin/python -m app.main
