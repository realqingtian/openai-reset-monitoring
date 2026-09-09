#!/usr/bin/env bash
# 一键启动：优先使用 uv（更快），未安装 uv 时自动回退到 python3 venv + pip
set -e
cd "$(dirname "$0")"

# 首次运行：自动从模板创建 .env 配置文件
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "==> 已根据 .env.example 创建 .env，编辑填入凭证后重启生效"
  echo "    （暂时不填也可以：DEMO=1 bash run.sh 可用内置演示数据体验）"
fi

if command -v uv >/dev/null 2>&1; then
  echo "==> 使用 uv 管理环境"
  [ -d .venv ] || uv venv .venv
  uv pip install -q -r requirements.txt --python .venv/bin/python
else
  echo "==> 未检测到 uv，使用 python3 venv + pip"
  [ -d .venv ] || python3 -m venv .venv
  . .venv/bin/activate
  pip install -q -r requirements.txt
fi

exec .venv/bin/python -m app.main
