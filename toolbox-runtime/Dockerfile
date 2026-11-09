FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app:/app/sdk
WORKDIR /app

RUN groupadd -g 1000 toolbox \
    && useradd -u 1000 -g 1000 -m -s /usr/sbin/nologin toolbox \
    && mkdir -p /toolbox \
    && chown 1000:1000 /toolbox

COPY requirements.txt ./
# 默认官方 PyPI；网络受限时可 --build-arg PIP_INDEX_URL=...
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r requirements.txt

COPY --chown=1000:1000 webserver ./webserver
# 由 `npm run sdk:sync` 从 plugin-sdk/python 生成；单一源不在运行时维护第二份实现。
COPY --chown=1000:1000 sdk ./sdk
COPY --chown=1000:1000 runtime.py ./

USER 1000:1000
ENV MYBOOKS_TOOLBOX_DIR=/toolbox TOOLBOX_RUNTIME_HOST=0.0.0.0 TOOLBOX_RUNTIME_PORT=8765
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/healthz', timeout=3).read()"
CMD ["python", "runtime.py"]
