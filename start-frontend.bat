@echo off
rem 前端启动脚本（Windows）：安装依赖并启动 Vite 开发服务器（http://localhost:5173，
rem /api、/healthz 自动代理到本机 8730 后端，见 frontend/vite.config.ts）。
rem 后端启动用 start-backend.bat。生产容器化部署见 docker-compose.yml。
rem 包管理器分级回退：bun → node(npm)，都没有则报错退出。
chcp 65001 >nul
cd /d %~dp0frontend

where bun >nul 2>nul
if %errorlevel%==0 goto :bun

where node >nul 2>nul
if %errorlevel%==0 goto :node

echo !! 前端开发需要 bun 或 Node.js 二者之一，均未检测到：
echo    - bun 安装：https://bun.sh
echo    - Node.js 安装：https://nodejs.org
exit /b 1

:bun
echo ==^> 使用 bun 管理前端依赖并启动
bun install
bun run dev
goto :eof

:node
echo ==^> 未检测到 bun，使用 node + npm（注意：依赖树以 bun.lock 为准，npm 可能产生 package-lock.json）
npm install
npm run dev
