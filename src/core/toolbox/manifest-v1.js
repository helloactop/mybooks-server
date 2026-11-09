/* ============================================================
 * Manifest v1 解析、校验与归一化
 *
 * 设计边界：
 *   · v1 是旧 manifest 的超集；没有 manifest_version 的包继续走
 *     manifest.js::parseManifest，行为完全不变；
 *   · 本文件只做“声明”的校验与归一化，不授予权限、不写数据库、
 *     不执行插件代码；
 *   · 归一化结果同时保留旧字段（entry_backend / api_routes /
 *     entry_frontend），使安装器、运行时与 UI 无需改动读取路径。
 *
 * 未知字段：默认忽略并记 warning；strict 模式拒绝。
 * x-* 扩展字段始终允许并原样保留在 raw 中。
 * ============================================================ */

const { ToolboxError } = require('./security');
const {
  TOOL_ID_RE,
  SEMVER_RE,
  parseManifest,
  splitEntry,
  normalizeRoutePath,
  normalizeFrontendPath,
} = require('./manifest');
const {
  PERMISSION_SET,
  RESOURCE_SCOPED,
  assertScope,
} = require('../plugins/permissions');

const ENV_MANIFEST_V1 = 'MYBOOKS_PLUGIN_MANIFEST_V1';
const MODES = Object.freeze({ AUTO: 'auto', OFF: 'off', STRICT: 'strict' });
const SUPPORTED_MANIFEST_VERSION = 1;

const ROUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RUNTIME_TYPES = new Set(['python']); // javascript 预留，宿主未实现
const THEMES = new Set(['auto', 'light', 'dark']);
const CATEGORIES = new Set([
  'metadata', 'conversion', 'library', 'reader', 'sync', 'device', 'statistics', 'other',
]);
const PLATFORMS = new Set(['web', 'android']);
// Phase 4A 只识别整页容器；其余 Slot 属于 4D，遇到时忽略而不是报错。
const KNOWN_UI_SLOTS = new Set(['toolbox.tool']);
const CAPABILITY_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/;
const EVENT_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const UI_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const SEMVER_RANGE_RE = /^[\^~<>=*0-9.\s|x-]+$/;
const PUBLISHER_KEY_RE = /^[A-Za-z0-9:._-]{1,128}$/;
const ICON_EXT_RE = /\.(png|jpe?g|webp)$/i;
const NAMED_HOOKS = Object.freeze(['on_install', 'on_enable', 'on_disable', 'on_uninstall']);

const LIMITS = Object.freeze({
  name: 120,
  description: 2000,
  author: 120,
  url: 500,
  license: 64,
  icon: 200,
  tags: 20,
  tag: 32,
  categories: 8,
  locales: 30,
  routes: 32,
  permissions: 32,
  permission_reason: 200,
  events: 32,
  provides: 16,
  dependency_plugins: 16,
  dependency_capabilities: 16,
  ui_pages: 16,
  ui_slots: 16,
  config_depth: 4,
  config_properties: 64,
  memory_mb: 384,
  timeout_seconds: 3600,
  max_artifact_mb: 80,
  max_concurrent_jobs: 4,
});

const DEFAULT_LIMITS = Object.freeze({
  memory_mb: LIMITS.memory_mb,
  timeout_seconds: 120,
  max_open_files: 256,
});

const KNOWN_TOP_LEVEL = new Set([
  'manifest_version',
  'tool_id', 'id',
  'name', 'description', 'revision', 'version',
  'author', 'publisher', 'homepage', 'icon', 'license',
  'categories', 'tags', 'publish_date', 'locales', 'default_locale',
  'core_api_version', 'min_host_version', 'repo_url',
  'entry_backend', 'entry', 'entry_frontend', 'page',
  'api_routes', 'routes', 'runtime', 'frontend',
  'permissions', 'config', 'ui', 'dependencies', 'resources',
  'lifecycle', 'events', 'provides', 'compatibility',
]);

function fail(code, message) {
  throw new ToolboxError(code, message);
}

function modeFromEnv(env = process.env) {
  const value = String(env[ENV_MANIFEST_V1] || '').trim().toLowerCase();
  return Object.values(MODES).includes(value) ? value : MODES.AUTO;
}

/**
 * 识别 Manifest 结构版本。返回 { version, supported }。
 * 缺失 → Legacy(0)；manifest_version=1 → 1；其他整数 → 不支持。
 */
function detectManifestVersion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: null, supported: false, reason: 'manifest 必须是 JSON 对象' };
  }
  if (raw.manifest_version === undefined || raw.manifest_version === null) {
    return { version: 0, supported: true, reason: '' };
  }
  if (raw.manifest_version === SUPPORTED_MANIFEST_VERSION) {
    return { version: 1, supported: true, reason: '' };
  }
  return {
    version: raw.manifest_version,
    supported: false,
    reason: `不支持的 manifest_version：${JSON.stringify(raw.manifest_version)}（本宿主支持 1）`,
  };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, field) {
  if (!isPlainObject(value)) fail('MANIFEST_INVALID', `${field} 必须是对象`);
  return value;
}

function requireString(value, field, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail('MANIFEST_INVALID', `${field} 必须是字符串`);
  const text = value.trim();
  if (!allowEmpty && !text) fail('MANIFEST_INVALID', `${field} 不能为空`);
  if (text.length > max) fail('MANIFEST_INVALID', `${field} 超过 ${max} 字符`);
  return text;
}

function optionalString(value, field, max) {
  if (value === undefined || value === null) return '';
  return requireString(value, field, max, { allowEmpty: true });
}

function assertHttpsUrl(value, field) {
  const text = requireString(value, field, LIMITS.url);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail('MANIFEST_INVALID', `${field} 必须是合法 URL`);
  }
  if (url.protocol !== 'https:') fail('MANIFEST_INVALID', `${field} 必须是 https URL`);
  return url.toString();
}

function optionalHttpsUrl(value, field) {
  if (value === undefined || value === null || value === '') return '';
  return assertHttpsUrl(value, field);
}

// 包内相对路径：禁止绝对路径、盘符、反斜杠、协议前缀与 .. 段。
function assertPackagePath(value, field, { extensions = null } = {}) {
  if (typeof value !== 'string') fail('MANIFEST_INVALID', `${field} 必须是字符串`);
  const text = value.trim();
  if (!text) fail('MANIFEST_INVALID', `${field} 不能为空`);
  if (text.length > LIMITS.icon) fail('MANIFEST_INVALID', `${field} 路径过长`);
  if (text.includes('\0') || text.includes('\\')) {
    fail('MANIFEST_INVALID', `${field} 含非法字符`);
  }
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text) || /^[a-z][a-z0-9+.-]*:/i.test(text)) {
    fail('MANIFEST_INVALID', `${field} 必须是包内相对路径`);
  }
  const parts = text.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail('MANIFEST_INVALID', `${field} 不允许空段、. 或 ..`);
  }
  if (!/^[A-Za-z0-9._\-/]+$/.test(text)) {
    fail('MANIFEST_INVALID', `${field} 只允许字母、数字、点、下划线与连字符`);
  }
  if (extensions && !extensions.test(text)) {
    fail('MANIFEST_INVALID', `${field} 扩展名不在允许范围`);
  }
  return text;
}

function normalizeAuthor(value) {
  if (typeof value === 'string') {
    return { name: requireString(value, 'author', LIMITS.author), url: '' };
  }
  const author = requireObject(value, 'author');
  return {
    name: requireString(author.name, 'author.name', LIMITS.author),
    url: optionalHttpsUrl(author.url, 'author.url'),
  };
}

function normalizePublisher(value) {
  if (value === undefined || value === null) return null;
  const publisher = requireObject(value, 'publisher');
  const name = requireString(publisher.name, 'publisher.name', LIMITS.author);
  const keyId = publisher.key_id === undefined || publisher.key_id === null
    ? '' : requireString(publisher.key_id, 'publisher.key_id', 128);
  if (keyId && !PUBLISHER_KEY_RE.test(keyId)) {
    fail('MANIFEST_INVALID', 'publisher.key_id 含非法字符');
  }
  return {
    name,
    key_id: keyId,
    url: optionalHttpsUrl(publisher.url, 'publisher.url'),
  };
}

function normalizeStringArray(value, field, { maxItems, maxLength, pattern = null, enumSet = null } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('MANIFEST_INVALID', `${field} 必须是数组`);
  if (value.length > maxItems) fail('MANIFEST_INVALID', `${field} 最多 ${maxItems} 项`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') fail('MANIFEST_INVALID', `${field} 条目必须是字符串`);
    const text = item.trim();
    if (!text || text.length > maxLength) fail('MANIFEST_INVALID', `${field} 条目长度不合法`);
    if (pattern && !pattern.test(text)) fail('MANIFEST_INVALID', `${field} 条目格式不合法：${text}`);
    if (enumSet && !enumSet.has(text)) fail('MANIFEST_INVALID', `${field} 含未知取值：${text}`);
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

function normalizeLocales(raw) {
  const locales = normalizeStringArray(raw.locales, 'locales', {
    maxItems: LIMITS.locales, maxLength: 16, pattern: /^[A-Za-z-]{2,16}$/,
  });
  const defaultLocale = String(raw.default_locale || locales[0] || '').trim();
  if (defaultLocale && !locales.includes(defaultLocale)) {
    fail('MANIFEST_INVALID', 'default_locale 必须出现在 locales 中');
  }
  return { locales, defaultLocale };
}

function normalizeRuntime(raw, entryBackendRaw) {
  const runtime = raw.runtime === undefined ? {} : requireObject(raw.runtime, 'runtime');
  const declaredEntry = runtime.entry !== undefined ? runtime.entry : raw.entry;
  if (declaredEntry !== undefined && entryBackendRaw !== undefined
    && String(declaredEntry).trim() !== String(entryBackendRaw).trim()) {
    fail('MANIFEST_INVALID', 'runtime.entry 与 entry_backend 必须一致');
  }
  if (declaredEntry === undefined) {
    fail('MANIFEST_INVALID', 'manifest 缺少 runtime.entry（或旧字段 entry_backend）');
  }
  const entry = splitEntry(declaredEntry, 'runtime.entry');

  const type = runtime.type === undefined ? 'python' : requireString(runtime.type, 'runtime.type', 32);
  const limitsRaw = runtime.limits === undefined ? {} : requireObject(runtime.limits, 'runtime.limits');
  const limits = {
    memory_mb: limitsRaw.memory_mb === undefined ? DEFAULT_LIMITS.memory_mb : limitsRaw.memory_mb,
    timeout_seconds: limitsRaw.timeout_seconds === undefined
      ? DEFAULT_LIMITS.timeout_seconds : limitsRaw.timeout_seconds,
    max_open_files: limitsRaw.max_open_files === undefined
      ? DEFAULT_LIMITS.max_open_files : limitsRaw.max_open_files,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) fail('MANIFEST_INVALID', `runtime.limits.${key} 必须是正整数`);
  }
  if (limits.memory_mb > LIMITS.memory_mb) {
    fail('MANIFEST_INVALID', `runtime.limits.memory_mb 不得超过宿主上限 ${LIMITS.memory_mb}`);
  }
  if (limits.timeout_seconds > LIMITS.timeout_seconds) {
    fail('MANIFEST_INVALID', `runtime.limits.timeout_seconds 不得超过 ${LIMITS.timeout_seconds}`);
  }
  return {
    type,
    entry,
    python: optionalString(runtime.python, 'runtime.python', 32),
    limits,
  };
}

function normalizeFrontend(raw) {
  const frontend = raw.frontend === undefined ? null : requireObject(raw.frontend, 'frontend');
  const legacyEntry = raw.entry_frontend === undefined ? '' : normalizeFrontendPath(raw.entry_frontend);
  let entry = '';
  if (frontend && frontend.entry !== undefined) {
    entry = assertPackagePath(frontend.entry, 'frontend.entry', { extensions: /\.html?$/i });
  } else if (legacyEntry) {
    entry = `frontend/${legacyEntry}`;
  }
  if (entry && legacyEntry && entry.replace(/^frontend\//, '') !== legacyEntry) {
    fail('MANIFEST_INVALID', 'frontend.entry 与 entry_frontend 必须指向同一文件');
  }
  if (entry && !entry.startsWith('frontend/')) {
    // v1 允许写 index.html，统一补成包内路径；旧入口字段仍保持 frontend/ 相对。
    entry = `frontend/${entry}`;
  }
  const bridge = frontend && frontend.bridge !== undefined ? frontend.bridge : 1;
  if (!Number.isInteger(bridge) || bridge < 1 || bridge > 2) {
    fail('MANIFEST_INVALID', 'frontend.bridge 只支持 1 或 2');
  }
  const theme = frontend && frontend.theme !== undefined ? frontend.theme : 'auto';
  if (!THEMES.has(theme)) fail('MANIFEST_INVALID', 'frontend.theme 只支持 auto/light/dark');
  const minHeight = frontend && frontend.min_height !== undefined ? frontend.min_height : 0;
  if (!Number.isInteger(minHeight) || minHeight < 0 || minHeight > 4000) {
    fail('MANIFEST_INVALID', 'frontend.min_height 必须是 0–4000 的整数');
  }
  if (!entry) return { entry: '', bridge, theme, min_height: minHeight };
  return { entry, bridge, theme, min_height: minHeight, legacy_entry: entry.replace(/^frontend\//, '') };
}

function normalizeRoutes(raw, warnings) {
  const merged = new Map();
  const collect = (list, field, isPrimary) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) fail('MANIFEST_INVALID', `${field} 必须是数组`);
    if (list.length > LIMITS.routes) fail('MANIFEST_INVALID', `${field} 最多 ${LIMITS.routes} 项`);
    const seenInField = new Set();
    for (const entry of list) {
      if (!isPlainObject(entry)) fail('MANIFEST_INVALID', `${field} 条目必须是对象`);
      const routePath = normalizeRoutePath(entry.path);
      if (seenInField.has(routePath)) {
        fail('MANIFEST_ROUTE_DUPLICATE', `${field} 路径重复：${routePath}`);
      }
      seenInField.add(routePath);
      const handler = splitEntry(entry.handler, `${field}.handler`);
      const methods = entry.methods === undefined ? ['GET', 'POST'] : entry.methods;
      if (!Array.isArray(methods) || methods.length === 0) {
        fail('MANIFEST_INVALID', `${field}.methods 必须是非空数组`);
      }
      for (const method of methods) {
        if (!ROUTE_METHODS.has(String(method).toUpperCase())) {
          fail('MANIFEST_INVALID', `${field}.methods 含未知方法：${method}`);
        }
      }
      const timeoutMs = entry.timeout_ms === undefined ? undefined : entry.timeout_ms;
      if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000)) {
        fail('MANIFEST_INVALID', `${field}.timeout_ms 必须是 1000–600000 的整数`);
      }
      const maxBody = entry.max_body_bytes === undefined ? undefined : entry.max_body_bytes;
      if (maxBody !== undefined && (!Number.isInteger(maxBody) || maxBody < 0 || maxBody > 200 * 1024 * 1024)) {
        fail('MANIFEST_INVALID', `${field}.max_body_bytes 超出允许范围`);
      }
      const route = {
        path: routePath,
        handler,
        methods: [...new Set(methods.map((method) => String(method).toUpperCase()))],
      };
      if (timeoutMs !== undefined) route.timeout_ms = timeoutMs;
      if (maxBody !== undefined) route.max_body_bytes = maxBody;
      if (merged.has(routePath)) {
        if (isPrimary) {
          merged.set(routePath, route);
          warnings.push({
            code: 'MANIFEST_ROUTE_OVERRIDDEN',
            message: `api_routes 与 routes 重复声明 ${routePath}，以 routes 为准`,
          });
        } else {
          warnings.push({
            code: 'MANIFEST_ROUTE_OVERRIDDEN',
            message: `api_routes 重复声明 ${routePath}，已保留首个声明`,
          });
        }
      } else {
        merged.set(routePath, route);
      }
    }
  };
  // 先收集旧字段，再收集 v1 routes，后者覆盖前者。
  collect(raw.api_routes, 'api_routes', false);
  collect(raw.routes, 'routes', true);
  if (merged.size > LIMITS.routes) fail('MANIFEST_INVALID', `路由总数不得超过 ${LIMITS.routes}`);
  return [...merged.values()];
}

function normalizePermissionScope(scope, field) {
  try {
    return assertScope(scope);
  } catch {
    return fail('MANIFEST_INVALID', `${field} 的 scope 不合法`);
  }
}

function normalizePermissions(raw) {
  if (raw.permissions === undefined) return [];
  if (!Array.isArray(raw.permissions)) fail('MANIFEST_INVALID', 'permissions 必须是数组');
  if (raw.permissions.length > LIMITS.permissions) {
    fail('MANIFEST_INVALID', `permissions 最多 ${LIMITS.permissions} 项`);
  }
  const seen = new Set();
  return raw.permissions.map((entry, index) => {
    const field = `permissions[${index}]`;
    if (!isPlainObject(entry)) fail('MANIFEST_INVALID', `${field} 必须是对象`);
    const name = requireString(entry.name, `${field}.name`, 64);
    if (!PERMISSION_SET.has(name)) {
      fail('MANIFEST_PERMISSION_UNKNOWN', `未知权限：${name}（未在宿主权限目录中实现，不能声称为已生效）`);
    }
    const key = `${name}\u0000${entry.scope || ''}`;
    if (seen.has(key)) fail('MANIFEST_INVALID', `${field} 重复声明权限 ${name}`);
    seen.add(key);
    let scope = '';
    if (entry.scope !== undefined) {
      scope = normalizePermissionScope(entry.scope, field);
    } else if (RESOURCE_SCOPED.has(name)) {
      fail('MANIFEST_PERMISSION_SCOPE_REQUIRED', `资源型权限 ${name} 必须声明 scope`);
    }
    const reason = requireString(entry.reason, `${field}.reason`, LIMITS.permission_reason);
    return { name, scope, reason };
  });
}

function normalizeSchemaNode(node, field, depth, counter) {
  if (depth > LIMITS.config_depth) fail('MANIFEST_INVALID', `${field} 嵌套层级过深`);
  requireObject(node, field);
  const out = {};
  const allowed = new Set([
    'type', 'properties', 'required', 'enum', 'default', 'minimum', 'maximum',
    'maxLength', 'format', 'items', 'x-sensitive', 'x-multiline', 'title', 'description',
  ]);
  for (const key of Object.keys(node)) {
    if (!key.startsWith('x-') && !allowed.has(key)) {
      fail('MANIFEST_INVALID', `${field} 不支持字段：${key}`);
    }
  }
  if (node.type !== undefined) {
    const types = new Set(['object', 'string', 'integer', 'number', 'boolean', 'array']);
    if (!types.has(node.type)) fail('MANIFEST_INVALID', `${field}.type 不支持：${node.type}`);
    out.type = node.type;
  }
  if (node.title !== undefined) out.title = requireString(node.title, `${field}.title`, 120);
  if (node.description !== undefined) out.description = requireString(node.description, `${field}.description`, 500);
  if (node.format !== undefined) {
    const formats = new Set(['url', 'email', 'date-time']);
    if (!formats.has(node.format)) fail('MANIFEST_INVALID', `${field}.format 不支持：${node.format}`);
    out.format = node.format;
  }
  if (node['x-sensitive'] !== undefined) {
    if (typeof node['x-sensitive'] !== 'boolean') fail('MANIFEST_INVALID', `${field}.x-sensitive 必须是布尔值`);
    out['x-sensitive'] = node['x-sensitive'];
  }
  if (node['x-multiline'] !== undefined) {
    if (typeof node['x-multiline'] !== 'boolean') fail('MANIFEST_INVALID', `${field}.x-multiline 必须是布尔值`);
    out['x-multiline'] = node['x-multiline'];
  }
  if (node.default !== undefined) out.default = node.default;
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum) || node.enum.length === 0 || node.enum.length > 50) {
      fail('MANIFEST_INVALID', `${field}.enum 必须是 1–50 项的数组`);
    }
    out.enum = node.enum.map((item) => {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return item;
      return fail('MANIFEST_INVALID', `${field}.enum 只接受原始值`);
    });
  }
  if (node.minimum !== undefined) {
    if (typeof node.minimum !== 'number' || !Number.isFinite(node.minimum)) {
      fail('MANIFEST_INVALID', `${field}.minimum 必须是数值`);
    }
    out.minimum = node.minimum;
  }
  if (node.maximum !== undefined) {
    if (typeof node.maximum !== 'number' || !Number.isFinite(node.maximum)) {
      fail('MANIFEST_INVALID', `${field}.maximum 必须是数值`);
    }
    out.maximum = node.maximum;
  }
  if (node.maxLength !== undefined) {
    if (!Number.isInteger(node.maxLength) || node.maxLength < 0 || node.maxLength > 10000) {
      fail('MANIFEST_INVALID', `${field}.maxLength 不合法`);
    }
    out.maxLength = node.maxLength;
  }
  if (node.required !== undefined) {
    if (!Array.isArray(node.required)
      || node.required.some((item) => typeof item !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item))) {
      fail('MANIFEST_INVALID', `${field}.required 必须是字段名数组`);
    }
    out.required = [...node.required];
  }
  if (node.properties !== undefined) {
    requireObject(node.properties, `${field}.properties`);
    const names = Object.keys(node.properties);
    counter.properties += names.length;
    if (counter.properties > LIMITS.config_properties) {
      fail('MANIFEST_INVALID', `config 字段总数不得超过 ${LIMITS.config_properties}`);
    }
    out.properties = {};
    for (const name of names) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
        fail('MANIFEST_INVALID', `${field}.properties 字段名不合法：${name}`);
      }
      out.properties[name] = normalizeSchemaNode(
        node.properties[name], `${field}.properties.${name}`, depth + 1, counter,
      );
    }
  }
  if (node.items !== undefined) {
    out.items = normalizeSchemaNode(node.items, `${field}.items`, depth + 1, counter);
  }
  return out;
}

function normalizeConfig(raw) {
  if (raw.config === undefined || raw.config === null) return null;
  const config = requireObject(raw.config, 'config');
  for (const key of Object.keys(config)) {
    if (key !== 'schema' && !key.startsWith('x-')) {
      fail('MANIFEST_INVALID', `config 不支持字段：${key}`);
    }
  }
  if (config.schema === undefined) return null;
  const schema = normalizeSchemaNode(config.schema, 'config.schema', 0, { properties: 0 });
  return { schema };
}

function normalizeUi(raw, warnings, { strict = false } = {}) {
  if (raw.ui === undefined) return { protocol: 1, pages: [], slots: [] };
  const ui = requireObject(raw.ui, 'ui');
  for (const key of Object.keys(ui)) {
    if (!['protocol', 'pages', 'slots'].includes(key) && !key.startsWith('x-')) {
      fail('MANIFEST_INVALID', `ui 不支持字段：${key}`);
    }
  }
  const protocol = ui.protocol === undefined ? 2 : ui.protocol;
  if (!Number.isInteger(protocol) || protocol < 1 || protocol > 2) {
    fail('MANIFEST_INVALID', 'ui.protocol 只支持 1 或 2');
  }
  const pages = [];
  if (ui.pages !== undefined) {
    if (!Array.isArray(ui.pages) || ui.pages.length > LIMITS.ui_pages) {
      fail('MANIFEST_INVALID', `ui.pages 必须是最多 ${LIMITS.ui_pages} 项的数组`);
    }
    const seen = new Set();
    for (const [index, page] of ui.pages.entries()) {
      const field = `ui.pages[${index}]`;
      requireObject(page, field);
      const id = requireString(page.id, `${field}.id`, 32);
      if (!UI_ID_RE.test(id)) fail('MANIFEST_INVALID', `${field}.id 不合法`);
      if (seen.has(id)) fail('MANIFEST_INVALID', `${field}.id 重复：${id}`);
      seen.add(id);
      const slot = optionalString(page.slot, `${field}.slot`, 64) || 'toolbox.tool';
      if (!KNOWN_UI_SLOTS.has(slot)) {
        if (strict) fail('MANIFEST_UI_SLOT_UNKNOWN', `${field}.slot 未识别：${slot}`);
        warnings.push({ code: 'MANIFEST_UI_SLOT_UNKNOWN', message: `${field}.slot 未识别，已忽略：${slot}` });
        continue;
      }
      const rawEntry = assertPackagePath(page.entry, `${field}.entry`, { extensions: /\.html?$/i });
      // 页面入口统一成包内路径；允许作者写 index.html（补 frontend/ 前缀）。
      const entry = rawEntry.startsWith('frontend/') ? rawEntry : `frontend/${rawEntry}`;
      pages.push({
        id,
        title: optionalString(page.title, `${field}.title`, 120),
        entry,
        slot,
      });
    }
  }
  const slots = [];
  if (ui.slots !== undefined) {
    if (!Array.isArray(ui.slots) || ui.slots.length > LIMITS.ui_slots) {
      fail('MANIFEST_INVALID', `ui.slots 必须是最多 ${LIMITS.ui_slots} 项的数组`);
    }
    for (const [index, slot] of ui.slots.entries()) {
      const field = `ui.slots[${index}]`;
      requireObject(slot, field);
      const id = requireString(slot.id, `${field}.id`, 32);
      if (!UI_ID_RE.test(id)) fail('MANIFEST_INVALID', `${field}.id 不合法`);
      const target = requireString(slot.slot, `${field}.slot`, 64);
      if (!KNOWN_UI_SLOTS.has(target)) {
        if (strict) fail('MANIFEST_UI_SLOT_UNKNOWN', `${field}.slot 未识别：${target}`);
        warnings.push({ code: 'MANIFEST_UI_SLOT_UNKNOWN', message: `${field}.slot 未识别，已忽略：${target}` });
        continue;
      }
      const normalized = { id, slot: target };
      if (slot.schema !== undefined) {
        normalized.schema = normalizeSchemaNode(slot.schema, `${field}.schema`, 0, { properties: 0 });
      }
      slots.push(normalized);
    }
  }
  return { protocol, pages, slots };
}

function normalizeDependencies(raw) {
  const dependencies = raw.dependencies === undefined ? {} : requireObject(raw.dependencies, 'dependencies');
  const plugins = [];
  if (dependencies.plugins !== undefined) {
    if (!Array.isArray(dependencies.plugins) || dependencies.plugins.length > LIMITS.dependency_plugins) {
      fail('MANIFEST_INVALID', `dependencies.plugins 必须是最多 ${LIMITS.dependency_plugins} 项的数组`);
    }
    const seen = new Set();
    for (const [index, item] of dependencies.plugins.entries()) {
      const field = `dependencies.plugins[${index}]`;
      requireObject(item, field);
      const toolId = requireString(item.tool_id, `${field}.tool_id`, 64);
      if (!TOOL_ID_RE.test(toolId)) fail('MANIFEST_INVALID', `${field}.tool_id 不合法`);
      if (seen.has(toolId)) fail('MANIFEST_INVALID', `${field}.tool_id 重复：${toolId}`);
      seen.add(toolId);
      const version = item.version === undefined ? '*' : requireString(item.version, `${field}.version`, 32);
      if (!SEMVER_RANGE_RE.test(version)) fail('MANIFEST_INVALID', `${field}.version 不是合法版本范围`);
      if (item.optional !== undefined && typeof item.optional !== 'boolean') {
        fail('MANIFEST_INVALID', `${field}.optional 必须是布尔值`);
      }
      plugins.push({ tool_id: toolId, version, optional: item.optional === true });
    }
    if (raw.tool_id && seen.has(raw.tool_id)) {
      fail('MANIFEST_DEPENDENCY_CYCLE', '插件不能依赖自身');
    }
  }
  const capabilities = [];
  if (dependencies.capabilities !== undefined) {
    if (!Array.isArray(dependencies.capabilities)
      || dependencies.capabilities.length > LIMITS.dependency_capabilities) {
      fail('MANIFEST_INVALID', `dependencies.capabilities 必须是最多 ${LIMITS.dependency_capabilities} 项的数组`);
    }
    for (const [index, item] of dependencies.capabilities.entries()) {
      const field = `dependencies.capabilities[${index}]`;
      requireObject(item, field);
      const name = requireString(item.name, `${field}.name`, 64);
      if (!CAPABILITY_RE.test(name)) fail('MANIFEST_INVALID', `${field}.name 不是合法能力名`);
      const version = item.version === undefined ? '1' : item.version;
      if (!Number.isInteger(Number(version)) || Number(version) < 1) {
        fail('MANIFEST_INVALID', `${field}.version 必须是正整数`);
      }
      capabilities.push({ name, version: String(version), optional: item.optional === true });
    }
  }
  return { plugins, capabilities };
}

function normalizeResources(raw, runtime) {
  const resources = raw.resources === undefined ? {} : requireObject(raw.resources, 'resources');
  const pick = (key, fallback) => (resources[key] === undefined ? fallback : resources[key]);
  const out = {
    memory_mb: pick('memory_mb', runtime.limits.memory_mb),
    timeout_seconds: pick('timeout_seconds', runtime.limits.timeout_seconds),
    max_artifact_mb: pick('max_artifact_mb', LIMITS.max_artifact_mb),
    max_concurrent_jobs: pick('max_concurrent_jobs', 1),
  };
  for (const [key, value] of Object.entries(out)) {
    if (!Number.isInteger(value) || value < 0) fail('MANIFEST_INVALID', `resources.${key} 必须是非负整数`);
  }
  if (out.memory_mb <= 0 || out.memory_mb > LIMITS.memory_mb) {
    fail('MANIFEST_INVALID', `resources.memory_mb 必须在 1–${LIMITS.memory_mb} 之间`);
  }
  if (out.timeout_seconds <= 0 || out.timeout_seconds > LIMITS.timeout_seconds) {
    fail('MANIFEST_INVALID', `resources.timeout_seconds 必须在 1–${LIMITS.timeout_seconds} 之间`);
  }
  if (out.max_artifact_mb > LIMITS.max_artifact_mb) {
    fail('MANIFEST_INVALID', `resources.max_artifact_mb 不得超过 ${LIMITS.max_artifact_mb}`);
  }
  if (out.max_concurrent_jobs < 1 || out.max_concurrent_jobs > LIMITS.max_concurrent_jobs) {
    fail('MANIFEST_INVALID', `resources.max_concurrent_jobs 必须在 1–${LIMITS.max_concurrent_jobs} 之间`);
  }
  return out;
}

function normalizeLifecycle(raw) {
  if (raw.lifecycle === undefined) return {};
  const lifecycle = requireObject(raw.lifecycle, 'lifecycle');
  const out = {};
  for (const [key, value] of Object.entries(lifecycle)) {
    if (!NAMED_HOOKS.includes(key)) {
      fail('MANIFEST_INVALID', `lifecycle 不支持钩子：${key}`);
    }
    const handler = splitEntry(value, `lifecycle.${key}`);
    out[key] = `${handler.module}.${handler.className}`;
  }
  return out;
}

function normalizeEvents(raw) {
  if (raw.events === undefined) return [];
  if (!Array.isArray(raw.events) || raw.events.length > LIMITS.events) {
    fail('MANIFEST_INVALID', `events 必须是最多 ${LIMITS.events} 项的数组`);
  }
  return raw.events.map((item, index) => {
    const field = `events[${index}]`;
    if (typeof item === 'string') {
      if (!EVENT_RE.test(item)) fail('MANIFEST_INVALID', `${field} 事件名不合法`);
      return { name: item };
    }
    requireObject(item, field);
    const name = requireString(item.name, `${field}.name`, 64);
    if (!EVENT_RE.test(name)) fail('MANIFEST_INVALID', `${field}.name 事件名不合法`);
    const out = { name };
    if (item.filter !== undefined) {
      const filter = requireObject(item.filter, `${field}.filter`);
      const keys = Object.keys(filter);
      if (keys.length > 8) fail('MANIFEST_INVALID', `${field}.filter 最多 8 个字段`);
      for (const key of keys) {
        if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) fail('MANIFEST_INVALID', `${field}.filter 字段名不合法`);
        const value = filter[key];
        if (!['string', 'number', 'boolean', 'null'].includes(typeof value) && value !== null) {
          fail('MANIFEST_INVALID', `${field}.filter 只接受原始值`);
        }
        if (typeof value === 'string' && value.length > 128) {
          fail('MANIFEST_INVALID', `${field}.filter 字符串过长`);
        }
      }
      out.filter = { ...filter };
    }
    return out;
  });
}

function normalizeProvides(raw) {
  if (raw.provides === undefined) return [];
  if (!Array.isArray(raw.provides) || raw.provides.length > LIMITS.provides) {
    fail('MANIFEST_INVALID', `provides 必须是最多 ${LIMITS.provides} 项的数组`);
  }
  return raw.provides.map((item, index) => {
    const field = `provides[${index}]`;
    requireObject(item, field);
    const capability = requireString(item.capability, `${field}.capability`, 64);
    if (!CAPABILITY_RE.test(capability)) fail('MANIFEST_INVALID', `${field}.capability 不合法`);
    const version = item.version === undefined ? '1' : item.version;
    if (!Number.isInteger(Number(version)) || Number(version) < 1) {
      fail('MANIFEST_INVALID', `${field}.version 必须是正整数`);
    }
    const entry = splitEntry(item.entry, `${field}.entry`);
    return { capability, version: String(version), entry };
  });
}

function normalizeCompatibility(raw) {
  if (raw.compatibility === undefined) return null;
  const compat = requireObject(raw.compatibility, 'compatibility');
  for (const key of Object.keys(compat)) {
    if (!['platforms', 'host'].includes(key) && !key.startsWith('x-')) {
      fail('MANIFEST_INVALID', `compatibility 不支持字段：${key}`);
    }
  }
  const platforms = normalizeStringArray(compat.platforms, 'compatibility.platforms', {
    maxItems: 4, maxLength: 16, enumSet: PLATFORMS,
  });
  const host = optionalString(compat.host, 'compatibility.host', 64);
  if (host && !SEMVER_RANGE_RE.test(host)) {
    fail('MANIFEST_INVALID', 'compatibility.host 不是合法版本范围');
  }
  return { platforms, host };
}

function collectUnknownFields(raw, warnings, strict) {
  const unknown = Object.keys(raw).filter((key) => !KNOWN_TOP_LEVEL.has(key) && !key.startsWith('x-'));
  if (!unknown.length) return;
  if (strict) fail('MANIFEST_UNKNOWN_FIELD', `strict 模式拒绝未知字段：${unknown.join('、')}`);
  for (const key of unknown) {
    warnings.push({ code: 'MANIFEST_UNKNOWN_FIELD', message: `忽略未知字段：${key}` });
  }
}

/**
 * 解析 Manifest v1。返回 { manifest, warnings }。
 * manifest 同时包含旧字段，可直接被安装器、运行时与 UI 消费。
 */
function parseManifestV1(raw, { strict = false, warnings = [] } = {}) {
  if (!isPlainObject(raw)) fail('MANIFEST_INVALID', 'manifest.json 必须是 JSON 对象');
  collectUnknownFields(raw, warnings, strict);

  // id / version 是 v1 的等价别名；同时出现时必须一致。
  if (raw.id !== undefined && raw.tool_id !== undefined && String(raw.id).trim() !== String(raw.tool_id).trim()) {
    fail('MANIFEST_INVALID', 'id 与 tool_id 必须一致');
  }
  if (raw.version !== undefined && raw.revision !== undefined
    && String(raw.version).trim() !== String(raw.revision).trim()) {
    fail('MANIFEST_INVALID', 'version 与 revision 必须一致');
  }
  const toolIdRaw = raw.tool_id !== undefined ? raw.tool_id : raw.id;
  const revisionRaw = raw.revision !== undefined ? raw.revision : raw.version;

  const toolId = requireString(toolIdRaw, 'tool_id', 64);
  if (!TOOL_ID_RE.test(toolId)) {
    fail('MANIFEST_INVALID', 'tool_id 只允许小写字母、数字、下划线，最长 64 位');
  }
  const name = requireString(raw.name, 'name', LIMITS.name);
  const description = requireString(raw.description, 'description', LIMITS.description);
  const revision = requireString(revisionRaw, 'revision', 32);
  if (!SEMVER_RE.test(revision)) fail('MANIFEST_INVALID', 'revision 必须是 x.y.z 语义化版本');
  const coreApiVersion = requireString(raw.core_api_version, 'core_api_version', 32);
  if (!SEMVER_RE.test(coreApiVersion)) fail('MANIFEST_INVALID', 'core_api_version 必须是 x.y.z 语义化版本');
  const minHostVersion = optionalString(raw.min_host_version, 'min_host_version', 32);
  if (minHostVersion && !SEMVER_RE.test(minHostVersion)) {
    fail('MANIFEST_INVALID', 'min_host_version 必须是 x.y.z 语义化版本');
  }
  const author = normalizeAuthor(raw.author);
  const publisher = normalizePublisher(raw.publisher);
  const repoUrl = assertHttpsUrl(raw.repo_url, 'repo_url');
  const homepage = optionalHttpsUrl(raw.homepage, 'homepage');
  const license = optionalString(raw.license, 'license', LIMITS.license);
  const icon = raw.icon === undefined ? '' : assertPackagePath(raw.icon, 'icon', { extensions: ICON_EXT_RE });
  const categories = normalizeStringArray(raw.categories, 'categories', {
    maxItems: LIMITS.categories, maxLength: 32, enumSet: CATEGORIES,
  });
  const tags = normalizeStringArray(raw.tags, 'tags', {
    maxItems: LIMITS.tags, maxLength: LIMITS.tag, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  });
  const publishDate = optionalString(raw.publish_date, 'publish_date', 40);
  const { locales, defaultLocale } = normalizeLocales(raw);

  const runtime = normalizeRuntime(raw, raw.entry_backend);
  const frontend = normalizeFrontend(raw);
  const routes = normalizeRoutes(raw, warnings);
  const permissions = normalizePermissions(raw);
  const config = normalizeConfig(raw);
  const ui = normalizeUi(raw, warnings, { strict });
  const dependencies = normalizeDependencies(raw);
  const resources = normalizeResources(raw, runtime);
  const lifecycle = normalizeLifecycle(raw);
  const events = normalizeEvents(raw);
  const provides = normalizeProvides(raw);
  const compatibility = normalizeCompatibility(raw);

  const page = optionalString(raw.page, 'page', 64);
  const uiDeclared = raw.ui !== undefined && Array.isArray(raw.ui.pages);
  const uiPages = uiDeclared
    ? ui.pages
    : (frontend.entry
      ? [{
        id: page || 'main',
        title: name,
        entry: frontend.entry,
        slot: 'toolbox.tool',
      }]
      : []);

  const manifest = {
    // —— 旧字段（安装器/运行时/UI 继续读取）——
    tool_id: toolId,
    name,
    description,
    revision,
    author: author.name,
    publish_date: publishDate,
    core_api_version: coreApiVersion,
    entry_backend: runtime.entry,
    entry_frontend: frontend.legacy_entry || '',
    page,
    repo_url: repoUrl,
    locales,
    default_locale: defaultLocale,
    api_routes: routes,

    // —— Manifest v1 字段 ——
    manifest_version: 1,
    min_host_version: minHostVersion,
    homepage,
    icon,
    license,
    categories,
    tags,
    author_detail: author,
    publisher,
    runtime: {
      type: runtime.type,
      entry: runtime.entry,
      python: runtime.python,
      limits: runtime.limits,
    },
    frontend: { entry: frontend.entry, bridge: frontend.bridge, theme: frontend.theme, min_height: frontend.min_height },
    routes,
    permissions,
    config,
    ui: { protocol: ui.protocol, pages: uiPages, slots: ui.slots },
    dependencies,
    resources,
    lifecycle,
    events,
    provides,
    compatibility_decl: compatibility,
    warnings: warnings.slice(),
    raw,
  };
  return { manifest, warnings };
}

function legacyManifest(raw) {
  const parsed = parseManifest(raw);
  const entry = parsed.entry_backend;
  const frontendEntry = parsed.entry_frontend ? `frontend/${parsed.entry_frontend}` : '';
  return {
    ...parsed,
    manifest_version: 0,
    min_host_version: '',
    homepage: '',
    icon: '',
    license: '',
    categories: [],
    tags: [],
    author_detail: { name: parsed.author, url: '' },
    publisher: null,
    runtime: { type: 'python', entry, python: '', limits: { ...DEFAULT_LIMITS } },
    frontend: { entry: frontendEntry, bridge: 1, theme: 'auto', min_height: 0 },
    routes: (parsed.api_routes || []).map((route) => ({
      path: route.path,
      handler: route.handler,
      methods: ['GET', 'POST'],
    })),
    permissions: [],
    config: null,
    ui: {
      protocol: 1,
      pages: frontendEntry
        ? [{ id: parsed.page || 'main', title: parsed.name, entry: frontendEntry, slot: 'toolbox.tool' }]
        : [],
      slots: [],
    },
    dependencies: { plugins: [], capabilities: [] },
    resources: {
      memory_mb: DEFAULT_LIMITS.memory_mb,
      timeout_seconds: DEFAULT_LIMITS.timeout_seconds,
      max_artifact_mb: LIMITS.max_artifact_mb,
      max_concurrent_jobs: 1,
    },
    lifecycle: {},
    events: [],
    provides: [],
    compatibility_decl: null,
    warnings: [],
    raw,
  };
}

/**
 * 统一入口：按包内容自动识别 Legacy / v1，输出同一种归一化 manifest。
 *
 * @param {object} raw 原始 manifest.json
 * @param {object} options
 *   - enforceMode: true 时按 MYBOOKS_PLUGIN_MANIFEST_V1 决定是否接受该版本（安装路径）
 *   - strict: 严格模式（未知字段/未知 Slot 拒绝）
 *   - mode: 显式覆盖环境变量（测试用）
 */
function normalizeManifest(raw, { enforceMode = false, strict = false, mode = null } = {}) {
  const detected = detectManifestVersion(raw);
  if (!detected.supported) {
    fail('MANIFEST_VERSION_UNSUPPORTED', detected.reason || '不支持的 manifest 版本');
  }
  const activeMode = mode || modeFromEnv();
  const warnings = [];

  if (detected.version === 1) {
    if (enforceMode && activeMode === MODES.OFF) {
      fail(
        'MANIFEST_VERSION_UNSUPPORTED',
        'Manifest v1 已被 MYBOOKS_PLUGIN_MANIFEST_V1=off 关闭；不会静默降级为 Legacy 解析',
      );
    }
    if (!enforceMode && activeMode === MODES.OFF) {
      // 已安装的 v1 插件仍可读（不破坏运行），但明确标记解析开关已关闭。
      warnings.push({ code: 'MANIFEST_V1_DISABLED', message: 'Manifest v1 解析开关已关闭，仅以只读方式识别' });
    }
    return parseManifestV1(raw, { strict, warnings });
  }

  if (enforceMode && activeMode === MODES.STRICT) {
    fail('MANIFEST_VERSION_UNSUPPORTED', 'MYBOOKS_PLUGIN_MANIFEST_V1=strict 只接受 manifest_version=1 的包');
  }
  return { manifest: legacyManifest(raw), warnings };
}

/**
 * 非抛出版本，供 CI / 商店发布 / 管理端预检使用。
 */
function validateManifest(raw, { strict = false, mode = null } = {}) {
  try {
    const result = normalizeManifest(raw, { enforceMode: false, strict, mode });
    return {
      ok: true,
      errors: [],
      warnings: result.warnings,
      manifest: result.manifest,
    };
  } catch (err) {
    return {
      ok: false,
      errors: [{ code: err.code || 'MANIFEST_INVALID', message: err.message }],
      warnings: [],
      manifest: null,
    };
  }
}

/**
 * 依赖检查：安装时执行。required 依赖缺失即拒绝，optional 只提示。
 * 不自动安装依赖，避免供应链放大。
 */
function assessDependencies(manifest, installedIds = null) {
  const reasons = [];
  const warnings = [];
  const deps = (manifest && manifest.dependencies && manifest.dependencies.plugins) || [];
  if (!installedIds) return { reasons, warnings };
  const installed = new Set(Array.from(installedIds));
  for (const dep of deps) {
    if (installed.has(dep.tool_id)) continue;
    const message = `缺少依赖插件 ${dep.tool_id}@${dep.version}`;
    if (dep.optional) warnings.push({ code: 'MANIFEST_DEPENDENCY_MISSING', message });
    else reasons.push({ code: 'MANIFEST_DEPENDENCY_MISSING', message });
  }
  return { reasons, warnings };
}

/**
 * 跨多个 manifest 的依赖环检测（仅看声明，不读取安装状态）。
 * 返回成环的 tool_id 列表；空数组表示无环。
 */
function detectDependencyCycles(manifests) {
  const graph = new Map();
  for (const item of manifests) {
    const id = item.tool_id;
    if (!id) continue;
    graph.set(id, (item.dependencies && item.dependencies.plugins ? item.dependencies.plugins : [])
      .map((dep) => dep.tool_id));
  }
  const visiting = new Set();
  const visited = new Set();
  const cycle = new Set();
  const walk = (node, stack) => {
    if (visiting.has(node)) {
      stack.slice(stack.indexOf(node)).forEach((item) => cycle.add(item));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (graph.has(next)) walk(next, stack);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const id of graph.keys()) walk(id, []);
  return [...cycle].sort();
}

module.exports = {
  ENV_MANIFEST_V1,
  MODES,
  SUPPORTED_MANIFEST_VERSION,
  LIMITS,
  DEFAULT_LIMITS,
  KNOWN_UI_SLOTS,
  modeFromEnv,
  detectManifestVersion,
  normalizeManifest,
  parseManifestV1,
  legacyManifest,
  validateManifest,
  assessDependencies,
  detectDependencyCycles,
};
