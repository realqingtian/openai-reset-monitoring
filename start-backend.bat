@echo off
rem 后端启动脚本（Windows）：自动创建虚拟环境并安装依赖，然后以 python -m app.main 启动。
rem 前端开发另开终端：cd frontend && bun install && bun dev（见 frontend/README.md）。
rem 生产容器化部署见 docker-compose.yml。
rem 工具分级回退：uv → python venv + pip，都没有则报错退出。
chcp 65001 >nul
cd /d %~dp0

rem 首次运行：自动从模板创建 .env 配置文件
if not exist .env (
  if exist .env.example (
    copy .env.example .env >nul
    echo ==^> 已根据 .env.example 创建 .env，编辑填入凭证后重启生效
  )
)

where uv >nul 2>nul
if %errorlevel%==0 goto :uv

rem 未检测到 uv：回退系统 Python
where python >nul 2>nul
if %errorlevel%==0 goto :pip

echo !! 后端开发需要 uv 或 Python 3（≥3.9）二者之一，均未检测到：
echo    - uv 安装：https://docs.astral.sh/uv/getting-started/installation/
echo    - Python 安装：https://www.python.org/downloads/
exit /b 1

:uv
echo ==^> 使用 uv 管理环境，依赖版本以 uv.lock 为准
rem --inexact：只补齐不删包，保留 .venv 里手动安装的额外包
uv sync --inexact
goto :run

:pip
echo ==^> 未检测到 uv，使用 python venv + pip
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt

:run
echo ==^> 启动后端（等价手动命令：.venv\Scripts\python -m app.main）
.venv\Scripts\python -m app.main
