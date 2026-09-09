# Codex 重置监控 · 生产镜像
# 构建：docker build -t codex-reset-monitor .
# 国内网络拉不到 Docker Hub 时，FROM 走 DaoCloud 镜像前缀；
# 若已给 Docker 配置 registry-mirrors 或代理，可改回官方源 FROM python:3.12-slim
FROM docker.m.daocloud.io/library/python:3.12-slim

WORKDIR /app

# 先装依赖，充分利用层缓存（pip 走清华 PyPI 镜像，避免国内网络超时）
COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY app/ ./app/

# 容器内必须监听 0.0.0.0 才能被映射访问；容器端口固定 8730，
# 宿主机端口由 docker-compose 的 ports 映射决定。
# PYTHONUNBUFFERED 让日志实时输出到 docker logs。
ENV MONITOR_HOST=0.0.0.0 \
    MONITOR_PORT=8730 \
    PYTHONUNBUFFERED=1

EXPOSE 8730

CMD ["python", "-m", "app.main"]
