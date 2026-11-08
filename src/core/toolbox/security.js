/* ============================================================
 * 工具箱安全原语：URL/SSRF、路径边界、摘要、密钥文件
 *
 * 这里不引用数据库或 HTTP；失败一律抛带 code 的 Error，
 * 路由层只负责把 code 翻成用户可读的响应。
 * ============================================================ */

const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

class ToolboxError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIPv6(ip) {
  const value = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!net.isIPv6(value)) return true;
  if (value === '::' || value === '::1') return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const first = value.split(':')[0];
  if (first.startsWith('fc') || first.startsWith('fd')) return true; // fc00::/7
  if (/^fe[89ab]/.test(first)) return true; // fe80::/10
  if (first.startsWith('ff')) return true; // multicast
  return false;
}

function isPrivateIp(ip) {
  const value = String(ip || '').replace(/^\[|\]$/g, '');
  if (net.isIPv4(value)) return isPrivateIPv4(value);
  if (net.isIPv6(value)) return isPrivateIPv6(value);
  return true;
}

function normalizeHostname(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
}

function assertSafeHttpsUrl(raw, { allowedHosts = [] } = {}) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new ToolboxError('STORE_URL_INVALID', '安装包地址无效');
  }
  if (url.protocol !== 'https:') throw new ToolboxError('STORE_URL_INSECURE', '安装包地址必须使用 HTTPS');
  if (url.username || url.password) throw new ToolboxError('STORE_URL_INVALID', '安装包地址不能包含凭据');
  if (url.port && url.port !== '443') throw new ToolboxError('STORE_URL_INVALID', '安装包地址端口不受支持');
  const host = normalizeHostname(url.hostname);
  if (!host) throw new ToolboxError('STORE_URL_INVALID', '安装包地址缺少主机名');
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new ToolboxError('STORE_URL_PRIVATE', '安装包地址指向内网');
  }
  const allowed = new Set(allowedHosts.map(normalizeHostname));
  if (allowed.size && !allowed.has(host)) {
    throw new ToolboxError('STORE_URL_UNTRUSTED', '安装包地址不在可信商店域名内');
  }
  return url;
}

async function assertPublicResolution(hostname) {
  const host = normalizeHostname(hostname);
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new ToolboxError('STORE_URL_PRIVATE', '安装包地址指向内网');
    return;
  }
  let records;
  try {
    records = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ToolboxError('STORE_DNS_FAILED', `无法解析商店域名 ${host}`);
  }
  if (!records.length) throw new ToolboxError('STORE_DNS_FAILED', `无法解析商店域名 ${host}`);
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new ToolboxError('STORE_URL_PRIVATE', '商店域名解析到内网地址，已拒绝');
  }
}

function assertInside(base, target, code = 'PATH_ESCAPE') {
  const root = path.resolve(base);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ToolboxError(code, '路径越出允许的目录');
  }
  return resolved;
}

function safeRelativePath(raw, { allowEmpty = false } = {}) {
  const value = String(raw == null ? '' : raw);
  if (!value) {
    if (allowEmpty) return '';
    throw new ToolboxError('PATH_INVALID', '路径不能为空');
  }
  if (value.includes('\0') || value.includes('\\')) throw new ToolboxError('PATH_INVALID', '路径包含非法字符');
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) throw new ToolboxError('PATH_INVALID', '不允许绝对路径');
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new ToolboxError('PATH_INVALID', '路径包含非法片段');
  }
  return value;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function ensureSecretFile(filePath, bytes = 32) {
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (existing) return existing;
  } catch { /* 不存在或不可读时重建 */ }
  const secret = crypto.randomBytes(bytes).toString('hex');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, secret + '\n', { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows 上可能不支持 */ }
  return secret;
}

async function fetchToFile(rawUrl, destPath, {
  allowedHosts = [], maxBytes = 50 * 1024 * 1024, timeoutMs = 60_000,
  allowPrivateHosts = false,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let url = assertSafeHttpsUrl(rawUrl, { allowedHosts });
  let redirects = 0;
  while (true) {
    if (Date.now() > deadline) throw new ToolboxError('STORE_TIMEOUT', '下载安装包超时', 504);
    // 可信商店域名在部分内网 DNS/VPN 下会解析到 198.18/15 等地址；允许管理员
    // 显式放开（仍限定在 allowedHosts，重定向到其他域名依旧拒绝）。
    if (!allowPrivateHosts) await assertPublicResolution(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'MyBooks-Toolbox/1' },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new ToolboxError('STORE_TIMEOUT', '下载安装包超时', 504);
      throw new ToolboxError('STORE_NETWORK', '无法连接工具商店', 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      const location = response.headers.get('location');
      if (!location) throw new ToolboxError('STORE_REDIRECT', '商店返回了无目标的跳转', 502);
      redirects += 1;
      if (redirects > 5) throw new ToolboxError('STORE_REDIRECT', '商店跳转次数过多', 502);
      url = assertSafeHttpsUrl(new URL(location, url).toString(), { allowedHosts });
      continue;
    }
    if (!response.ok) {
      clearTimeout(timer);
      throw new ToolboxError('STORE_HTTP', `商店返回 HTTP ${response.status}`, 502);
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > maxBytes) {
      clearTimeout(timer);
      throw new ToolboxError('STORE_TOO_LARGE', '安装包超过大小上限', 413);
    }
    const hash = crypto.createHash('sha256');
    let size = 0;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const out = fs.createWriteStream(destPath, { mode: 0o600 });
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new ToolboxError('STORE_TOO_LARGE', '安装包超过大小上限', 413);
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      }
    } finally {
      clearTimeout(timer);
      await new Promise((resolve) => out.end(resolve));
    }
    return { sha256: hash.digest('hex'), size, finalUrl: url.toString() };
  }
}

module.exports = {
  ToolboxError,
  isPrivateIp,
  assertSafeHttpsUrl,
  assertPublicResolution,
  assertInside,
  safeRelativePath,
  sha256File,
  timingSafeEqualString,
  ensureSecretFile,
  fetchToFile,
};
