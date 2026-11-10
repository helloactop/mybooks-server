/* ============================================================
 * Plugin Descriptor：Legacy 与 Manifest v1 的统一只读视图
 *
 * 单一事实来源：
 *   · 解析与校验全部交给 manifest-v1.js（内部对 Legacy 复用 parseManifest）；
 *   · 安装器、只读 API、诊断工具都从这里取描述符，不再各自解释 manifest；
 *   · 描述符是冻结的只读对象，修改它不会改变授权、安装状态或数据库。
 *
 * 信任级别由宿主计算（allowlist + SHA-256 + 来源），Manifest 自报无效。
 * 未签名的包永远不会被标为 official。
 * ============================================================ */

const toolboxRepo = require('../../db/toolbox');
const { normalizeManifest, modeFromEnv, MODES, assessDependencies } = require('./manifest-v1');
const { assessCompatibility } = require('./manifest');
const { getReview, shaMatches, allowUnreviewed } = require('./allowlist');
const { RESOURCE_SCOPED } = require('../plugins/permissions');
const { ToolboxError } = require('./security');

// 权限目录中尚未有完整运行时强制点的权限：如实标记，不能宣称已生效。
const UNENFORCED_PERMISSIONS = new Set(['network.public', 'network.private', 'ui.contribute']);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeSource(source) {
  const text = String(source || '').trim();
  if (!text) return 'unknown';
  if (text === 'dev' || text === 'test') return 'local';
  return text;
}

/**
 * 信任级别由宿主赋值。
 *   0. allowlist 命中且 SHA-256 一致 → reviewed（与来源无关：本地安装同包同哈希也算）
 *   1. 本地来源（未命中 allowlist）→ local
 *   2. 声明了 publisher.key_id（但未验签）→ community
 *   3. 其他 → unreviewed
 * official 需要可信公钥验签，本阶段未实现，因此不会返回。
 */
function trustOf({ toolId, revision, sha256, source, raw }) {
  const review = getReview(toolId, revision);
  if (review && (!sha256 || shaMatches(review, sha256))) return 'reviewed';
  if (normalizeSource(source) === 'local') return 'local';
  if (raw && raw.publisher && raw.publisher.key_id) return 'community';
  return 'unreviewed';
}

function reviewStateOf({ toolId, revision, sha256 }) {
  const review = getReview(toolId, revision);
  return !!(review && (!sha256 || shaMatches(review, sha256)));
}

function permissionView(permission) {
  const name = permission.name;
  return {
    name,
    scope: permission.scope || '',
    reason: permission.reason || '',
    resource_scoped: RESOURCE_SCOPED.has(name),
    // 声明 ≠ 授权；enforced 只表示宿主运行时存在强制点。
    enforced: !UNENFORCED_PERMISSIONS.has(name),
  };
}

function compatibilityView(manifest, { trust, sha256, installedIds }) {
  const assessed = assessCompatibility(manifest, {
    reviewed: trust === 'reviewed',
    runtime: (manifest.runtime && manifest.runtime.type) || 'python',
    allowUnreviewed: allowUnreviewed(),
  });
  const deps = assessDependencies(manifest, installedIds);
  const warnings = [...(assessed.warnings || [])];
  for (const item of deps.warnings) warnings.push(item);
  for (const item of manifest.warnings || []) warnings.push(item);
  return {
    supported: assessed.supported && deps.reasons.length === 0,
    manifest_version: manifest.manifest_version,
    core_api_version: manifest.core_api_version,
    host_core_api_version: assessed.host_core_api_version,
    reviewed: assessed.reviewed,
    allow_unreviewed: assessed.allow_unreviewed,
    reasons: [...(assessed.reasons || []), ...deps.reasons],
    warnings,
  };
}

/**
 * 由归一化 manifest 构造冻结描述符。
 * @param {object} manifest normalizeManifest() / parseManifestV1() 的结果
 */
function createDescriptor(manifest, {
  source = 'unknown',
  sha256 = '',
  trust = null,
  installed = false,
  installedIds = null,
  extraWarnings = [],
} = {}) {
  const raw = clone(manifest.raw || {});
  const toolId = manifest.tool_id;
  const revision = manifest.revision;
  const resolvedTrust = trust || trustOf({ toolId, revision, sha256, source, raw });
  const compatibility = compatibilityView({
    ...manifest,
    warnings: [...(manifest.warnings || []), ...extraWarnings],
  }, { trust: resolvedTrust, sha256, installedIds });

  const runtime = manifest.runtime || {};
  const frontend = manifest.frontend || {};
  const ui = manifest.ui || { protocol: 1, pages: [], slots: [] };

  return deepFreeze({
    id: toolId,
    manifest_version: manifest.manifest_version,
    version: revision,
    legacy: manifest.manifest_version === 0,

    identity: {
      id: toolId,
      name: manifest.name,
      author: clone(manifest.author_detail || { name: manifest.author || '', url: '' }),
      publisher: clone(manifest.publisher || null),
      repo_url: manifest.repo_url || '',
      homepage: manifest.homepage || '',
      license: manifest.license || '',
    },

    metadata: {
      description: manifest.description || '',
      icon: manifest.icon || '',
      categories: clone(manifest.categories || []),
      tags: clone(manifest.tags || []),
      publish_date: manifest.publish_date || '',
      locales: clone(manifest.locales || []),
      default_locale: manifest.default_locale || '',
      page: manifest.page || '',
    },

    runtime: {
      type: runtime.type || 'python',
      entry: clone(runtime.entry || manifest.entry_backend || null),
      python: runtime.python || '',
      limits: clone(runtime.limits || {}),
    },

    routes: clone(manifest.routes || manifest.api_routes || []),
    frontend: {
      entry: frontend.entry || '',
      bridge: frontend.bridge || 1,
      theme: frontend.theme || 'auto',
      min_height: frontend.min_height || 0,
    },

    // 只声明；实际授权在 grants.json / GrantStore，不在这里体现。
    permissions: (manifest.permissions || []).map(permissionView),

    configuration: {
      schema: clone(manifest.config && manifest.config.schema ? manifest.config.schema : null),
      sensitive_fields: Object.keys((manifest.config && manifest.config.schema
        && manifest.config.schema.properties) || {})
        .filter((key) => manifest.config.schema.properties[key]['x-sensitive'] === true),
    },

    ui: {
      protocol: ui.protocol || 1,
      pages: clone(ui.pages || []),
      slots: clone(ui.slots || []),
    },

    dependencies: clone(manifest.dependencies || { plugins: [], capabilities: [] }),
    resources: clone(manifest.resources || {}),
    lifecycle: clone(manifest.lifecycle || {}),
    events: clone(manifest.events || []),
    capabilities: clone(manifest.provides || []),

    compatibility,
    source: normalizeSource(source),
    trust: resolvedTrust,
    installed: !!installed,
    manifest_mode: modeFromEnv(),

    // 仅内部诊断使用：对外 DTO 必须经过 toPublicDescriptor()。
    raw,
  });
}

/**
 * 解析原始 manifest 并生成描述符。非法 manifest 抛 ToolboxError。
 */
function createPluginDescriptor(raw, {
  source = 'unknown',
  sha256 = '',
  trust = null,
  installed = false,
  installedIds = null,
  strict = false,
  mode = null,
} = {}) {
  const { manifest, warnings } = normalizeManifest(raw, {
    enforceMode: false, strict, mode,
  });
  return createDescriptor(manifest, {
    source, sha256, trust, installed, installedIds, extraWarnings: warnings,
  });
}

function descriptorFromRecord(tool, { installedIds = null } = {}) {
  if (!tool) return null;
  const raw = (tool.manifest && tool.manifest.raw) || tool.manifest || {};
  const source = tool.source || 'unknown';
  const trust = trustOf({
    toolId: tool.tool_id, revision: tool.revision, sha256: tool.sha256, source, raw,
  });
  try {
    const { manifest, warnings } = normalizeManifest(raw, { enforceMode: false });
    const descriptor = createDescriptor(manifest, {
      source, sha256: tool.sha256, trust, installed: true, installedIds, extraWarnings: warnings,
    });
    return descriptor;
  } catch (err) {
    // 解析失败不能影响已安装插件继续运行：返回降级描述符并保留错误码。
    const record = {
      id: tool.tool_id,
      manifest_version: Number.isInteger(tool.manifest && tool.manifest.manifest_version)
        ? tool.manifest.manifest_version : 0,
      version: tool.revision || '',
      legacy: !(tool.manifest && tool.manifest.manifest_version),
      identity: {
        id: tool.tool_id,
        name: tool.name || tool.tool_id,
        author: { name: (tool.manifest && tool.manifest.author) || '', url: '' },
        publisher: null,
        repo_url: '',
        homepage: '',
        license: '',
      },
      metadata: {
        description: (tool.manifest && tool.manifest.description) || '',
        icon: '',
        categories: [],
        tags: [],
        publish_date: '',
        locales: [],
        default_locale: '',
        page: '',
      },
      runtime: {
        type: tool.runtime || 'python',
        entry: (tool.manifest && tool.manifest.entry_backend) || null,
        python: '',
        limits: {},
      },
      routes: clone((tool.manifest && tool.manifest.api_routes) || []),
      frontend: { entry: '', bridge: 1, theme: 'auto', min_height: 0 },
      permissions: [],
      configuration: { schema: null, sensitive_fields: [] },
      ui: { protocol: 1, pages: [], slots: [] },
      dependencies: { plugins: [], capabilities: [] },
      resources: {},
      lifecycle: {},
      events: [],
      capabilities: [],
      compatibility: {
        supported: false,
        manifest_version: recordManifestVersion(tool),
        core_api_version: (tool.manifest && tool.manifest.core_api_version) || '',
        reasons: [{ code: err.code || 'MANIFEST_INVALID', message: err.message }],
        warnings: [],
      },
      source: normalizeSource(source),
      trust,
      installed: true,
      manifest_mode: modeFromEnv(),
      raw: clone(raw),
    };
    return deepFreeze(record);
  }
}

function recordManifestVersion(tool) {
  const value = tool.manifest && tool.manifest.manifest_version;
  return Number.isInteger(value) ? value : 0;
}

function installedIdsOf(db, excludeId = '') {
  return toolboxRepo.listTools(db)
    .map((tool) => tool.tool_id)
    .filter((id) => id !== excludeId);
}

/**
 * 已安装插件的描述符；未安装返回 null。
 * 描述符读取数据库记录与包内原始 manifest，不触发任何安装/授权动作。
 */
function getPluginDescriptor(toolId, { db } = {}) {
  if (!db) throw new ToolboxError('DESCRIPTOR_NO_DB', '必须提供数据库连接', 500);
  const tool = toolboxRepo.getTool(db, toolId);
  if (!tool) return null;
  return descriptorFromRecord(tool, { installedIds: installedIdsOf(db, toolId) });
}

function getInstalledPluginDescriptors({ db } = {}) {
  if (!db) throw new ToolboxError('DESCRIPTOR_NO_DB', '必须提供数据库连接', 500);
  const tools = toolboxRepo.listTools(db);
  const ids = tools.map((tool) => tool.tool_id);
  return tools.map((tool) => descriptorFromRecord(tool, {
    installedIds: ids.filter((id) => id !== tool.tool_id),
  }));
}

/**
 * 对外 DTO：去掉原始 manifest、内部时间字段与任何绝对路径。
 * 结构与内部描述符一致，方便 4C 管理端直接消费。
 */
function toPublicDescriptor(descriptor) {
  if (!descriptor) return null;
  const copy = clone(descriptor);
  delete copy.raw;
  return deepFreeze(copy);
}

module.exports = {
  UNENFORCED_PERMISSIONS,
  trustOf,
  reviewStateOf,
  createDescriptor,
  createPluginDescriptor,
  descriptorFromRecord,
  getPluginDescriptor,
  getInstalledPluginDescriptors,
  toPublicDescriptor,
  isManifestV1Enabled: () => modeFromEnv() !== MODES.OFF,
};
