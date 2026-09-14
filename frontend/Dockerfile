# Codex 重置监控 · 前端镜像：bun 构建 React 面板 → Caddy 托管静态文件并反代 /api
# 由仓库根目录 docker-compose.yml 编排（构建上下文为 frontend/），也可单独构建：
#   docker build -t codex-reset-monitor-frontend ./frontend
# 国内网络：FROM 走 DaoCloud 前缀；npm 走 npmmirror（与后端走清华 PyPI 同思路）

FROM docker.m.daocloud.io/oven/bun:1 AS build

WORKDIR /build
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 先只拷依赖清单充分利用层缓存
COPY package.json bun.lock ./
RUN bun install --frozen

COPY . .
RUN bun run build

# ---- 运行镜像：Caddy alpine，只带静态文件与 Caddyfile ----
FROM docker.m.daocloud.io/library/caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /srv
