/* ============================================================
 * 通用插件 manifest 解析与校验
 *
 * 以 PoxenStudio 真实 manifest 字段为准；不写死 zlibrary。
 * 解析结果是“规范化后的声明”，兼容性由调用方结合运行时能力判断。
 * ============================================================ */

const { ToolboxError } = require('./security');

const TOOL_ID_RE = /^[a-z0-9_]{1,64}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const MODULE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const HANDLER_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*\.[A-Za-z_][A-Za-z0-9_]*$/;
const ROUTE_RE = /^[A-Za-z0-9_.\-/]+$/;

// 本宿主实际实现的 CoreAPI 能力（不是照着版本号宣称）
const CORE_API_MAX = '1.3.0';
const IMPLEMENTED_CAPABILITIES = [
  'storage.get_config', 'storage.set_config', 'storage.get_work_dir', 'storage.cleanup_work_dir',
  'tasks.create_task', 'tasks.update_progress', 'tasks.complete_task',
  'calibre.import_file', 'calibre.get_metadata', 'calibre.set_metadata',
  'messages.send_message', 'async_service.register_function', 'async_service.register_service',
  'handlers.base', 'i18n._',
];

const LIMITATIONS = [
  '任务执行器第一版为单 worker，下载任务串行',
  '入库沿用 Mybooks 现有 80MB 上限与 EPUB/PDF/MOBI/AZW/AZW3/TXT 格式白名单',
  '插件运行在共享 Python 进程内，进程级沙箱不是安全边界；仅运行审查过的插件',
];

function semverTuple(value) {
  const match = SEMVER_RE.exec(String(value || ''));
  return match ? match[0].split('.').map(Number) : null;
}

function compareSemver(a, b) {
  const left = semverTuple(a);
  const right = semverTuple(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function splitEntry(value, field, { allowClass = true } = {}) {
  const text = String(value || '').trim();
  if (!text) throw new ToolboxError('MANIFEST_INVALID', `manifest 缺少 ${field}`);
  if (!allowClass) {
    if (!MODULE_RE.test(text)) throw new ToolboxError('MANIFEST_INVALID', `${field} 格式不合法`);
    return { module: text, className: '' };
  }
  if (!HANDLER_RE.test(text)) {
    throw new ToolboxError('MANIFEST_INVALID', `${field} 应形如 <module>.<ClassName>`);
  }
  const index = text.lastIndexOf('.');
  return { module: text.slice(0, index), className: text.slice(index + 1) };
}

function normalizeRoutePath(raw) {
  const value = String(raw || '').trim().replace(/^\/+/, '');
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('\\')
    || !ROUTE_RE.test(value)) {
    throw new ToolboxError('MANIFEST_INVALID', 'api_routes.path 不合法');
  }
  return value.replace(/\/+$/, '');
}

function normalizeFrontendPath(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const parts = value.split('/');
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/')
    || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new ToolboxError('MANIFEST_INVALID', 'entry_frontend 必须是 frontend/ 内的相对路径');
  }
  if (!/\.(html?)$/i.test(value)) {
    throw new ToolboxError('MANIFEST_INVALID', 'entry_frontend 必须是 HTML 文件');
  }
  return value;
}

function parseManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolboxError('MANIFEST_INVALID', 'manifest.json 必须是 JSON 对象');
  }
  const required = ['tool_id', 'name', 'description', 'revision', 'author',
    'core_api_version', 'entry_backend', 'repo_url'];
  const missing = required.filter((key) => !String(raw[key] || '').trim());
  if (missing.length) {
    throw new ToolboxError('MANIFEST_INVALID', `manifest 缺少必填字段：${missing.join('、')}`);
  }

  const toolId = String(raw.tool_id).trim();
  if (!TOOL_ID_RE.test(toolId)) {
    throw new ToolboxError('MANIFEST_INVALID', 'tool_id 只允许小写字母、数字、下划线，最长 64 位');
  }
  const revision = String(raw.revision).trim();
  const coreApiVersion = String(raw.core_api_version).trim();
  for (const [field, value] of [['revision', revision], ['core_api_version', coreApiVersion]]) {
    if (!SEMVER_RE.test(value)) {
      throw new ToolboxError('MANIFEST_INVALID', `${field} 必须是 x.y.z 语义化版本`);
    }
  }

  const entryBackend = splitEntry(raw.entry_backend, 'entry_backend');
  if (entryBackend.module.split('.').some((part) => /^_|^$/.test(part))) {
    throw new ToolboxError('MANIFEST_INVALID', 'entry_backend 模块名不合法');
  }
  const entryFrontend = normalizeFrontendPath(raw.entry_frontend);

  const routes = [];
  if (raw.api_routes !== undefined) {
    if (!Array.isArray(raw.api_routes) || raw.api_routes.length > 32) {
      throw new ToolboxError('MANIFEST_INVALID', 'api_routes 必须是最多 32 项的数组');
    }
    const seen = new Set();
    for (const entry of raw.api_routes) {
      if (!entry || typeof entry !== 'object') {
        throw new ToolboxError('MANIFEST_INVALID', 'api_routes 条目必须是对象');
      }
      const routePath = normalizeRoutePath(entry.path);
      if (seen.has(routePath)) {
        throw new ToolboxError('MANIFEST_INVALID', `api_routes 路径重复：${routePath}`);
      }
      seen.add(routePath);
      routes.push({ path: routePath, handler: splitEntry(entry.handler, 'api_routes.handler') });
    }
  }

  let locales = raw.locales === undefined ? [] : raw.locales;
  if (!Array.isArray(locales) || locales.length > 30
    || locales.some((item) => typeof item !== 'string' || !/^[A-Za-z-]{2,16}$/.test(item))) {
    throw new ToolboxError('MANIFEST_INVALID', 'locales 必须是最多 30 项的语言代码数组');
  }
  locales = [...new Set(locales)];
  const defaultLocale = String(raw.default_locale || locales[0] || '').trim();
  if (defaultLocale && !locales.includes(defaultLocale)) {
    throw new ToolboxError('MANIFEST_INVALID', 'default_locale 必须出现在 locales 中');
  }

  return {
    tool_id: toolId,
    name: String(raw.name).trim().slice(0, 120),
    description: String(raw.description).trim().slice(0, 2000),
    revision,
    author: String(raw.author).trim().slice(0, 120),
    publish_date: String(raw.publish_date || '').trim().slice(0, 40),
    core_api_version: coreApiVersion,
    entry_backend: entryBackend,
    entry_frontend: entryFrontend,
    page: String(raw.page || '').trim().slice(0, 64),
    repo_url: String(raw.repo_url).trim().slice(0, 500),
    locales,
    default_locale: defaultLocale,
    api_routes: routes,
    raw: raw,
  };
}

function routePaths(manifest) {
  return new Set((manifest.api_routes || []).map((route) => route.path));
}

function findRoute(manifest, rawPath) {
  const value = String(rawPath || '').split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');
  return (manifest.api_routes || []).find((route) => route.path === value) || null;
}

// 基于宿主真实能力与审查状态给出兼容结论。
// supported 只表示“技术上可运行”；未审查插件默认不可执行，除非管理员显式
// 设置 MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=true。
function assessCompatibility(manifest, { reviewed = false, runtime = 'python', allowUnreviewed = false } = {}) {
  const reasons = [];
  const warnings = [];
  const compare = compareSemver(manifest.core_api_version, CORE_API_MAX);
  if (compare === null) {
    reasons.push({ code: 'CORE_API_INVALID', message: 'core_api_version 不合法' });
  } else if (compare > 0) {
    reasons.push({
      code: 'CORE_API_TOO_NEW',
      message: `插件要求 CoreAPI ${manifest.core_api_version}，本宿主实现到 ${CORE_API_MAX}`,
    });
  }
  if (!reviewed && !allowUnreviewed) {
    reasons.push({ code: 'REVIEW_REQUIRED', message: '该插件尚未列入已审查 allowlist，默认不自动运行' });
  } else if (!reviewed) {
    warnings.push({ code: 'UNREVIEWED_ALLOWED', message: '管理员已允许未审查插件；代码仍按不可信处理' });
  }
  if (runtime !== 'python') {
    reasons.push({ code: 'RUNTIME_UNSUPPORTED', message: `不支持的运行时：${runtime}` });
  }
  return {
    supported: reasons.length === 0,
    reviewed: !!reviewed,
    allow_unreviewed: !!allowUnreviewed,
    core_api_version: manifest.core_api_version,
    host_core_api_version: CORE_API_MAX,
    capabilities: IMPLEMENTED_CAPABILITIES,
    limitations: LIMITATIONS,
    reasons,
    warnings,
  };
}

module.exports = {
  TOOL_ID_RE,
  SEMVER_RE,
  CORE_API_MAX,
  IMPLEMENTED_CAPABILITIES,
  LIMITATIONS,
  parseManifest,
  compareSemver,
  routePaths,
  findRoute,
  assessCompatibility,
};
