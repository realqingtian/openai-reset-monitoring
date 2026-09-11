#!/usr/bin/env bash
# 代码规范一键检查：ruff 静态检查 + ruff 格式检查 + mypy 类型检查
# 用法：bash check.sh        只检查，不改动任何文件
#       bash check.sh --fix  自动修复 lint 问题并格式化，类型问题仍需手动修
set -e
cd "$(dirname "$0")"

if command -v uv >/dev/null 2>&1; then
  # uv run 会按需准备工具环境：首次运行自动创建 .venv 并安装 dev 依赖组
  RUN=(uv run --group dev)
else
  echo "==> 未检测到 uv，回退到当前 python3 环境（需已安装 ruff 和 mypy）"
  RUN=()
fi

if [ "${1:-}" = "--fix" ]; then
  echo "==> ruff 静态检查（自动修复）"
  "${RUN[@]}" ruff check --fix app
  echo "==> ruff 格式化"
  "${RUN[@]}" ruff format app
else
  echo "==> ruff 静态检查"
  "${RUN[@]}" ruff check app
  echo "==> ruff 格式检查"
  "${RUN[@]}" ruff format --check app
fi

echo "==> mypy 类型检查"
"${RUN[@]}" mypy app

echo "==> 全部检查通过 ✓"
