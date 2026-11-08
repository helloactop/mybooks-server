/* ============================================================
 * Node ↔ Python Runtime 通信与共享状态
 *
 * 共享卷布局（TOOLBOX_DIR）：
 *   plugins/<tool_id>/        安装目录（Node 写，Python 读）
 *   data/<tool_id>/           插件私有配置与工作目录（Python 写，Node 只读入库文件）
 *   state/installed.json      Node 导出的启用清单（Python 启动时读取）
 *   state/runtime-secret      Node→Python 内部鉴权
 *   state/internal-secret     Python→Node 内部鉴权
 *   downloads/                商店安装包临时目录
 * ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const { TOOLBOX_DIR } = require('../paths');
const { ToolboxError, ensureSecretFile, timingSafeEqualString } = require('./security');

const RUNTIME_URL = (process.env.MYBOOKS_TOOLBOX_RUNTIME_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');

function ensureToolboxDirs() {
  for (const dir of ['plugins', 'data', 'state', 'downloads', 'tmp']) {
    fs.mkdirSync(path.join(TOOLBOX_DIR, dir), { recursive: true });
  }
}

function secretPath(name) {
  return path.join(TOOLBOX_DIR, 'state', name);
}

function runtimeSecret() {
  ensureToolboxDirs();
  return process.env.MYBOOKS_TOOLBOX_RUNTIME_SECRET
    || ensureSecretFile(secretPath('runtime-secret'));
}

function internalSecret() {
  ensureToolboxDirs();
  return process.env.MYBOOKS_TOOLBOX_INTERNAL_SECRET
    || ensureSecretFile(secretPath('internal-secret'));
}

function checkInternalSecret(value) {
  const expected = internalSecret();
  return timingSafeEqualString(value, expected);
}

function statePath() {
  return path.join(TOOLBOX_DIR, 'state', 'installed.json');
}

function writeRuntimeState(tools) {
  ensureToolboxDirs();
  const payload = {
    version: 1,
    generated_at: new Date().toISOString(),
    tools: tools.map((tool) => ({
      tool_id: tool.tool_id,
      revision: tool.revision,
      enabled: !!tool.enabled,
      install_path: tool.install_path,
      entry_backend: tool.manifest && tool.manifest.entry_backend,
      entry_frontend: tool.manifest && tool.manifest.entry_frontend,
      core_api_version: tool.manifest && tool.manifest.core_api_version,
    })),
  };
  const target = statePath();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  // 不包含密钥；Worker 以 UID 1000 运行时需要读取（PM2 下 Node 可能以 root 运行）。
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o644 });
  fs.renameSync(tmp, target);
  try { fs.chmodSync(target, 0o644); } catch { /* Windows */ }
  return payload;
}

async function callRuntime(routePath, {
  method = 'GET', body = null, rawBody = null, contentType = '', timeoutMs = 30_000,
  userId = '', headers = {}, rawResponse = false,
} = {}) {
  const url = RUNTIME_URL + routePath;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestHeaders = {
      'X-Mybooks-Runtime-Secret': runtimeSecret(),
      ...(userId ? { 'X-Mybooks-User-Id': String(userId) } : {}),
      ...headers,
    };
    let requestBody;
    if (rawBody != null) {
      requestHeaders['Content-Type'] = contentType || 'application/octet-stream';
      requestBody = rawBody;
    } else if (body != null) {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: requestHeaders,
      body: requestBody,
    });
    if (rawResponse) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return { status: response.status, ok: response.ok, buffer, responseHeaders: response.headers };
    }
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 由调用方处理 */ }
    return { status: response.status, ok: response.ok, json, text };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new ToolboxError('RUNTIME_TIMEOUT', '插件运行环境响应超时', 504);
    }
    throw new ToolboxError('RUNTIME_UNAVAILABLE', '插件运行环境未就绪，请检查 toolbox-runtime', 503);
  } finally {
    clearTimeout(timer);
  }
}

async function reloadRuntime({ timeoutMs = 5000 } = {}) {
  try {
    const result = await callRuntime('/internal/reload', { method: 'POST', body: {}, timeoutMs });
    return { ok: result.ok, status: result.status, plugins: result.json && result.json.plugins };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
}

async function runtimeHealth({ timeoutMs = 3000 } = {}) {
  try {
    const result = await callRuntime('/healthz', { method: 'GET', timeoutMs });
    return { online: result.ok, status: result.status, info: result.json };
  } catch (err) {
    return { online: false, error: err.message, code: err.code };
  }
}

async function proxyTool(toolId, route, {
  method = 'GET', body = null, rawBody = null, contentType = '', timeoutMs = 30_000,
  userId = '', query = '', rawResponse = false,
} = {}) {
  const cleanRoute = String(route || '').replace(/^\/+/, '');
  const suffix = query && String(query).length <= 4000 ? `?${query}` : '';
  const result = await callRuntime(`/tool/${encodeURIComponent(toolId)}/${cleanRoute}${suffix}`, {
    method, body, rawBody, contentType, timeoutMs, userId, rawResponse,
  });
  return result;
}

module.exports = {
  RUNTIME_URL,
  ensureToolboxDirs,
  runtimeSecret,
  internalSecret,
  checkInternalSecret,
  statePath,
  writeRuntimeState,
  callRuntime,
  reloadRuntime,
  runtimeHealth,
  proxyTool,
};
