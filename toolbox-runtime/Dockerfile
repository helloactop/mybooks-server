FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app
WORKDIR /app

RUN groupadd -g 1000 toolbox \
    && useradd -u 1000 -g 1000 -m -s /usr/sbin/nologin toolbox \
    && mkdir -p /toolbox \
    && chown 1000:1000 /toolbox

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=1000:1000 webserver ./webserver
COPY --chown=1000:1000 runtime.py ./

USER 1000:1000
ENV MYBOOKS_TOOLBOX_DIR=/toolbox TOOLBOX_RUNTIME_HOST=0.0.0.0 TOOLBOX_RUNTIME_PORT=8765
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/healthz', timeout=3).read()"
CMD ["python", "runtime.py"]
