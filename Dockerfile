# Codex 重置监控 · 生产镜像
# 构建：docker build -t codex-reset-monitor .
# 国内网络拉不到 Docker Hub 时，FROM 走 DaoCloud 镜像前缀；
# 若已给 Docker 配置 registry-mirrors 或代理，可改回官方源 FROM python:3.12-slim
#
# 两阶段构建：依赖严格按 uv.lock 安装（--frozen，构建可复现），
# 运行镜像只带 venv 与应用代码，并以非 root 用户运行。
# ./data 卷在 Docker Desktop（macOS/Windows）下非 root 可正常读写；
# Linux 宿主机如遇权限问题：chown 1000:1000 ./data 或构建时改 --build-arg UID。

FROM docker.m.daocloud.io/library/python:3.12-slim AS builder

WORKDIR /build

# uv 走 PyPI 镜像安装，避免对 ghcr.io 的直连依赖
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple uv

# 先只拷锁文件充分利用层缓存；--frozen 保证不偏离 uv.lock
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM docker.m.daocloud.io/library/python:3.12-slim

WORKDIR /app

# 只带运行时产物：venv + 应用代码（不含 uv、pip 缓存与构建层）
COPY --from=builder /build/.venv /app/.venv
COPY app/ ./app/

# 容器内必须监听 0.0.0.0 才能被映射访问；容器端口固定 8730，
# 宿主机端口由 docker-compose 的 ports 映射决定。
# PYTHONUNBUFFERED 让日志实时输出到 docker logs。
ENV PATH="/app/.venv/bin:$PATH" \
    MONITOR_HOST=0.0.0.0 \
    MONITOR_PORT=8730 \
    PYTHONUNBUFFERED=1

EXPOSE 8730

# 非 root 运行；UID 固定 1000，与宿主机 ./data 卷的属主配合见文件头说明
RUN useradd --create-home --uid 1000 appuser \
    && chown -R appuser /app
USER appuser

CMD ["python", "-m", "app.main"]
