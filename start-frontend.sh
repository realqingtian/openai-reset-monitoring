#!/usr/bin/env bash
# 前端启动脚本（macOS / Linux）：安装依赖并启动 Vite 开发服务器（http://localhost:5173，
# /api、/healthz 自动代理到本机 8730 后端，见 frontend/vite.config.ts）。
# 后端启动用 start-backend.sh。生产容器化部署见 docker-compose.yml。
# 包管理器分级回退：bun → node(npm)，都没有则报错退出。
set -e
cd "$(dirname "$0")/frontend"

if command -v bun >/dev/null 2>&1; then
  echo "==> 使用 bun 管理前端依赖并启动"
  INSTALL="bun install"
  DEV="bun run dev"
elif command -v node >/dev/null 2>&1; then
  echo "==> 未检测到 bun，使用 node + npm（注意：依赖树以 bun.lock 为准，npm 可能产生 package-lock.json）"
  INSTALL="npm install"
  DEV="npm run dev"
else
  echo "!! 前端开发需要 bun 或 Node.js 二者之一，均未检测到：" >&2
  echo "   - bun 安装：https://bun.sh" >&2
  echo "   - Node.js 安装：https://nodejs.org" >&2
  exit 1
fi

# 每次启动同步依赖（幂等，秒级完成）
echo "==> 同步前端依赖"
$INSTALL

echo "==> 启动前端开发服务器（等价手动命令：$DEV）"
exec $DEV
