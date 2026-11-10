/* ============================================================
 * Plugin Center 聚合服务（只读）
 *
 * 统一组织商店、已安装、详情、权限、配置、版本、任务、日志与
 * Runtime 安全状态。所有事实来源仍是 toolbox 现有模块：
 *   store / installer / plugin-grants / descriptor / tasks / runtime。
 *
 * 本文件不安装、不启停、不写权限、不写配置；写操作继续走
 * /api/toolbox/*，4C.4 再补权限与配置写入。
 * ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { TOOLBOX_DIR, STORAGE_ROOT } = require('../paths');
const dbSingleton = require('../../db/index');
const toolboxRepo = require('../../db/toolbox');
const booksRepo = require('../../db/books');
const storeClient = require('../toolbox/store');
const descriptorApi = require('../toolbox/descriptor');
const grants = require('../toolbox/plugin-grants');
const {
  runtimeHealth, runtimePathStatus, callRuntime,
} = require('../toolbox/runtime');
const { compareSemver, TOOL_ID_RE } = require('../toolbox/manifest');
const { allowUnreviewed } = require('../toolbox/allowlist');
const { legacyCompatEnabled, pluginAuthOnlyEnabled } = require('../toolbox/access-policy');
const { maskSensitive, sensitiveFields, validateConfig } = require('../toolbox/config-schema');
const audit = require('../toolbox/audit');

const { UNENFORCED_PERMISSIONS } = descriptorApi;

class CenterError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'CenterError';
    this.code = code;
    this.status = status;
  }
}

function redactText(value, max = 1000) {
  let text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text) return '';
  text = text.split(TOOLBOX_DIR).join('[path]').split(STORAGE_ROOT).join('[path]');
  text = text.replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '[path]');
  return text.slice(0, max);
}

function isolationMode(info) {
  if (!info) return 'unknown';
  if (info.isolation_mode) return String(info.isolation_mode);
  return info.isolated ? 'process' : 'shared';
}

function uidStatus(info) {
  const uid = info && info.uid_isolation;
  if (!uid || typeof uid !== 'object') return { enabled: false, missing_capabilities: [] };
  return {
    enabled: !!uid.uid_enabled,
    missing_capabilities: Array.isArray(uid.missing_capabilities) ? [...uid.missing_capabilities] : [],
  };
}

function runtimeView(health) {
  const info = health && health.info && typeof health.info === 'object' ? health.info : null;
  const uid = uidStatus(info);
  return {
    online: !!(health && health.online),
    status: health && health.status ? health.status : 0,
    error: redactText((health && health.error) || '', 300),
    isolation_mode: isolationMode(info),
    isolated: !!(info && info.isolated),
    plugin_auth_only: info && info.plugin_auth_only !== undefined ? !!info.plugin_auth_only : null,
    uid_isolation: uid.enabled,
    uid,
  };
}

function riskRank(level) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  return 1;
}

function buildSecurity({ tools, descriptors, health, policy }) {
  const runtime = runtimeView(health);
  const info = health && health.info ? health.info : null;
  const pathStatus = runtimePathStatus(info || {});
  const risks = [];

  const reviewedDescriptors = descriptors.filter((item) => item.trust === 'reviewed');
  const unreviewed = descriptors
    .filter((item) => item.trust !== 'reviewed')
    .map((item) => item.id);
  const enabled = tools.filter((tool) => tool.enabled);
  const failed = tools.filter((tool) => tool.enabled && tool.last_error).map((tool) => tool.tool_id);
  const pendingRestart = tools.filter((tool) => tool.pending_restart).map((tool) => tool.tool_id);
  const strictTools = [...policy.configured].sort();
  const unconfigured = policy.state === 'ok'
    ? tools.map((tool) => tool.tool_id).filter((id) => !policy.configured.has(id))
    : [];

  if (!runtime.online) {
    risks.push({ code: 'RUNTIME_OFFLINE', level: 'high', message: '插件运行时离线，配置与运行状态不可用' });
  } else if (runtime.isolation_mode === 'shared' && unreviewed.length) {
    risks.push({
      code: 'SHARED_WORKER_UNREVIEWED',
      level: 'high',
      message: '共享 Worker 内存在未审查插件，插件可读取同卷其它插件配置',
    });
  } else if (runtime.isolation_mode === 'shared') {
    risks.push({
      code: 'SHARED_WORKER',
      level: 'medium',
      message: '插件运行在共享 Worker 中，进程内不是安全边界',
    });
  }
  if (allowUnreviewed()) {
    risks.push({
      code: 'UNREVIEWED_ALLOWED',
      level: 'high',
      message: 'MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=true：未审查插件与宿主同信任域',
    });
  }
  if (pathStatus.mismatch) {
    risks.push({
      code: 'TOOLBOX_PATH_MISMATCH',
      level: 'high',
      message: 'Node 与 Runtime 的 toolbox 路径不一致，插件产物入库会失败',
    });
  }
  if (runtime.online && runtime.plugin_auth_only !== null
    && runtime.plugin_auth_only !== pluginAuthOnlyEnabled()) {
    risks.push({
      code: 'AUTH_MODE_MISMATCH',
      level: 'high',
      message: 'Node 与 Runtime 的插件认证模式不一致，内部调用可能被拒绝',
    });
  }
  if (!pluginAuthOnlyEnabled()) {
    risks.push({
      code: 'LEGACY_AUTH_COMPAT',
      level: 'medium',
      message: '内部接口仍接受共享内部凭据（Legacy 兼容模式），不是强隔离',
    });
  }
  if (runtime.uid.enabled && runtime.uid.missing_capabilities.length) {
    risks.push({
      code: 'UID_CAPABILITY_MISSING',
      level: 'high',
      message: `独立 UID 模式缺少能力：${runtime.uid.missing_capabilities.join(', ')}`,
    });
  }
  if (policy.state === 'broken') {
    risks.push({
      code: 'GRANTS_POLICY_BROKEN',
      level: 'high',
      message: 'grants.json 损坏且没有可信快照，所有插件权限按拒绝处理',
    });
  }

  const risk = risks.reduce((level, item) => (riskRank(item.level) > riskRank(level) ? item.level : level), 'low');

  return {
    risk,
    runtime: {
      online: runtime.online,
      status: runtime.status,
      error: runtime.error,
      isolation_mode: runtime.isolation_mode,
      isolated: runtime.isolated,
      plugin_auth_only: runtime.plugin_auth_only,
      node_plugin_auth_only: pluginAuthOnlyEnabled(),
      uid: runtime.uid,
      path: { checked: pathStatus.checked, mismatch: pathStatus.mismatch },
    },
    policy: {
      state: policy.state,
      strict_tools: strictTools,
      unconfigured_tools: unconfigured,
    },
    plugins: {
      installed: tools.length,
      enabled: enabled.length,
      reviewed: reviewedDescriptors.length,
      unreviewed,
      failed,
      pending_restart: pendingRestart,
    },
    env: {
      allow_unreviewed: allowUnreviewed(),
      legacy_compat: legacyCompatEnabled(),
    },
    risks,
  };
}

function createCenter(deps = {}) {
  const getDb = () => deps.db || dbSingleton.db;
  const stores = deps.store || storeClient;
  const healthOf = deps.runtimeHealth || runtimeHealth;
  const callRuntimeOf = deps.callRuntime || callRuntime;
  const auditLog = deps.audit || audit;

  function requireTool(id) {
    if (!TOOL_ID_RE.test(String(id || ''))) {
      throw new CenterError('INVALID_PLUGIN_ID', '插件 ID 不合法', 400);
    }
    const tool = toolboxRepo.getTool(getDb(), id);
    if (!tool) throw new CenterError('PLUGIN_NOT_FOUND', '插件未安装', 404);
    return tool;
  }

  function descriptorOf(id) {
    const descriptor = descriptorApi.getPluginDescriptor(id, { db: getDb() });
    if (!descriptor) throw new CenterError('PLUGIN_NOT_FOUND', '插件未安装', 404);
    return descriptorApi.toPublicDescriptor(descriptor);
  }

  function storeEntry(id) {
    const peek = stores.peekIndex();
    if (!peek.loaded) return null;
    return peek.tools.find((item) => item.tool_id === id) || null;
  }

  function rollbackView(tool) {
    const target = tool.previous_path ? path.join(TOOLBOX_DIR, tool.previous_path) : '';
    let available = false;
    try {
      available = !!target && fs.existsSync(target);
    } catch { /* 不可读按不可回滚处理 */ }
    return { available, revision: available ? (tool.previous_revision || '') : '' };
  }

  function storeEntryView(entry) {
    if (!entry) return null;
    // download_url 不下发：浏览器不需要，也避免暴露安装包直链。
    const { download_url: _downloadUrl, ...rest } = entry;
    return rest;
  }

  async function overview() {
    const db = getDb();
    const tools = toolboxRepo.listTools(db);
    const descriptors = descriptorApi.getInstalledPluginDescriptors({ db });
    const health = await healthOf({ timeoutMs: 2000 });
    const policy = grants.loadGrants();
    const security = buildSecurity({ tools, descriptors, health, policy });
    const tasks = toolboxRepo.taskCounts(db);
    const peek = stores.peekIndex();

    let updatesAvailable = null;
    if (peek.loaded) {
      updatesAvailable = tools.filter((tool) => {
        const entry = peek.tools.find((item) => item.tool_id === tool.tool_id);
        return !!entry && compareSemver(entry.latest_revision, tool.revision) > 0
          && entry.compatibility.supported;
      }).length;
    }

    const recent = [];
    for (const tool of tools) {
      if (!tool.last_error) continue;
      recent.push({
        tool_id: tool.tool_id,
        code: 'PLUGIN_ERROR',
        source: 'plugin',
        message: redactText(tool.last_error, 300),
        at: tool.updated_at,
      });
    }
    for (const task of toolboxRepo.listTasks(db, { status: 'failed', limit: 5 })) {
      recent.push({
        tool_id: task.tool_id,
        code: 'TASK_FAILED',
        source: 'task',
        message: redactText(task.error || task.message || '任务失败', 300),
        at: task.finished_at || task.created_at,
      });
    }
    recent.sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));

    return {
      generated_at: new Date().toISOString(),
      counts: {
        installed: tools.length,
        enabled: tools.filter((tool) => tool.enabled).length,
        disabled: tools.filter((tool) => !tool.enabled).length,
        pending_restart: tools.filter((tool) => tool.pending_restart).length,
        failed: tools.filter((tool) => tool.enabled && tool.last_error).length,
        updates_available: updatesAvailable,
      },
      tasks: {
        running: tasks.running,
        completed: tasks.completed,
        failed: tasks.failed,
        cancelled: tasks.cancelled,
        total: tasks.total,
      },
      runtime: {
        online: security.runtime.online,
        status: security.runtime.status,
        error: security.runtime.error,
        isolation_mode: security.runtime.isolation_mode,
        isolated: security.runtime.isolated,
        plugin_auth_only: security.runtime.plugin_auth_only,
        uid_isolation: security.runtime.uid.enabled,
      },
      security: {
        risk: security.risk,
        reviewed: security.plugins.reviewed,
        unreviewed: security.plugins.unreviewed,
        allow_unreviewed: security.env.allow_unreviewed,
        shared_worker_risk: security.runtime.isolation_mode === 'shared' ? security.risk : 'low',
      },
      store: {
        available: peek.loaded && !peek.error,
        fetched_at: peek.fetchedAt ? new Date(peek.fetchedAt).toISOString() : null,
        error: redactText(peek.error || '', 300),
        entry_count: peek.tools.length,
      },
      recent_errors: recent.slice(0, 5),
    };
  }

  async function storeIndex({ q = '', sort = 'name', refresh = false } = {}) {
    const query = String(q || '').trim().slice(0, 100).toLowerCase();
    const index = await stores.getIndex({ force: !!refresh });
    let tools = stores.annotate(index.tools, toolboxRepo.listTools(getDb()));
    if (query) {
      tools = tools.filter((item) => [item.tool_id, item.name, item.author, item.description]
        .some((value) => String(value || '').toLowerCase().includes(query)));
    }
    if (sort === 'updated') {
      tools.sort((a, b) => String(b.publish_date || '').localeCompare(String(a.publish_date || ''))
        || String(a.name || '').localeCompare(String(b.name || '')));
    } else if (sort === 'installed') {
      tools.sort((a, b) => Number(!!b.installed) - Number(!!a.installed)
        || String(a.name || '').localeCompare(String(b.name || '')));
    } else {
      tools.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }
    return {
      store_url: stores.STORE_URL || '',
      fetched_at: index.fetchedAt ? new Date(index.fetchedAt).toISOString() : null,
      cached: !!index.cached,
      error: redactText(index.error || '', 300),
      tools: tools.map(storeEntryView),
    };
  }

  async function storeDetail(id) {
    if (!TOOL_ID_RE.test(String(id || ''))) {
      throw new CenterError('INVALID_PLUGIN_ID', '插件 ID 不合法', 400);
    }
    const index = await stores.getIndex();
    const entry = index.tools.find((item) => item.tool_id === id);
    if (!entry) throw new CenterError('STORE_NOT_FOUND', '商店中没有这个插件', 404);
    const [annotated] = stores.annotate([entry], toolboxRepo.listTools(getDb()));
    return { tool: storeEntryView(annotated), latest_only: true };
  }

  async function installed() {
    const db = getDb();
    const tools = toolboxRepo.listTools(db);
    const descriptors = descriptorApi.getInstalledPluginDescriptors({ db });
    const byId = new Map(tools.map((tool) => [tool.tool_id, tool]));
    const health = await healthOf({ timeoutMs: 2000 });
    const info = health && health.info ? health.info : null;
    const loaded = new Set(Array.isArray(info && info.plugins) ? info.plugins : []);
    const peek = stores.peekIndex();
    const storeMap = new Map(peek.loaded ? peek.tools.map((item) => [item.tool_id, item]) : []);

    return {
      runtime: {
        online: !!(health && health.online),
        plugins: [...loaded],
        isolation_mode: isolationMode(info),
      },
      tools: descriptors.map((descriptor) => {
        const tool = byId.get(descriptor.id);
        const entry = storeMap.get(descriptor.id) || null;
        const latest = entry ? entry.latest_revision : null;
        let runtimeStatus = 'disabled';
        if (tool.enabled) {
          if (!(health && health.online)) runtimeStatus = 'runtime_offline';
          else runtimeStatus = loaded.has(tool.tool_id) ? 'loaded' : 'not_loaded';
        }
        return {
          tool_id: tool.tool_id,
          name: tool.name,
          revision: tool.revision,
          source: descriptor.source,
          enabled: tool.enabled,
          pending_restart: !!tool.pending_restart,
          last_error: redactText(tool.last_error || '', 300),
          installed_at: tool.installed_at,
          updated_at: tool.updated_at,
          manifest_version: descriptor.manifest_version,
          trust: descriptor.trust,
          compatibility: descriptor.compatibility,
          runtime_status: runtimeStatus,
          update_available: !!entry && compareSemver(entry.latest_revision, tool.revision) > 0
            && entry.compatibility.supported,
          latest_revision: latest,
          rollback_available: rollbackView(tool).available,
          has_frontend: !!(descriptor.frontend.entry || (descriptor.ui.pages || []).length),
        };
      }),
    };
  }

  async function detail(id) {
    const tool = requireTool(id);
    const descriptor = descriptorOf(id);
    const health = await healthOf({ timeoutMs: 2000 });
    const info = health && health.info ? health.info : null;
    const loaded = new Set(Array.isArray(info && info.plugins) ? info.plugins : []);
    const entry = storeEntry(id);
    const rollback = rollbackView(tool);
    return {
      plugin: descriptor,
      installed: {
        revision: tool.revision,
        enabled: tool.enabled,
        pending_restart: !!tool.pending_restart,
        last_error: redactText(tool.last_error || '', 300),
        source: tool.source,
        installed_at: tool.installed_at,
        sha256: tool.sha256 || '',
      },
      runtime: {
        online: !!(health && health.online),
        loaded: loaded.has(tool.tool_id),
        isolation_mode: isolationMode(info),
      },
      latest: entry ? {
        revision: entry.latest_revision,
        reviewed: !!entry.reviewed,
        compatibility: entry.compatibility,
      } : null,
      rollback,
      task_counts: toolboxRepo.taskCounts(getDb(), { toolId: id }),
    };
  }

  function policyVersion() {
    try {
      const target = grants.policyPath();
      return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
    } catch {
      return '';
    }
  }

  async function permissions(id) {
    requireTool(id);
    const descriptor = descriptorOf(id);
    const policy = grants.pluginGrantsFor(id);
    const entries = policy.store ? policy.store.list(id) : [];
    const granted = [];
    const effective = [];
    for (const item of entries) {
      for (const scope of item.scopes) {
        granted.push(scope === '*' ? item.permission : `${item.permission}:${scope}`);
        effective.push({ permission: item.permission, scope });
      }
    }
    const grantedNames = new Set(effective.map((item) => item.permission));
    const requested = descriptor.permissions || [];
    const warnings = [];
    if (policy.state === 'absent') {
      warnings.push('该插件尚未配置 grants.json，Legacy 兼容模式下声明权限不会被裁剪');
    } else if (policy.state === 'last-good') {
      warnings.push('grants.json 不可读，当前使用最近一次有效权限快照');
    } else if (policy.state === 'broken') {
      warnings.push('grants.json 损坏且没有可信快照，所有插件权限按拒绝处理');
    }
    const strict = policy.state === 'broken'
      ? true
      : (policy.state === 'ok' || policy.state === 'last-good') && !!policy.configured;

    return {
      policy_state: policy.state,
      configured: !!policy.configured,
      strict,
      version: policyVersion(),
      requested,
      granted,
      effective,
      declared_not_granted: requested
        .filter((item) => !grantedNames.has(item.name))
        .map((item) => item.name),
      unenforced: requested
        .filter((item) => UNENFORCED_PERMISSIONS.has(item.name))
        .map((item) => item.name),
      warnings,
      // 本轮只读；4C.4 才提供写入。
      can_modify: policy.state === 'ok',
      write_supported: false,
    };
  }

  async function config(id) {
    const descriptor = descriptorOf(id);
    const schema = descriptor.configuration && descriptor.configuration.schema;
    if (!schema) {
      throw new CenterError('CONFIG_SCHEMA_MISSING', '该插件没有声明式配置 Schema', 404);
    }
    const health = await healthOf({ timeoutMs: 2000 });
    if (!health || !health.online) {
      throw new CenterError('RUNTIME_UNAVAILABLE', '插件运行时离线，无法读取配置', 503);
    }
    let result;
    try {
      result = await callRuntimeOf(`/internal/tool/${encodeURIComponent(id)}/config`, {
        method: 'GET', timeoutMs: 5000,
      });
    } catch (err) {
      throw new CenterError(
        err && err.code === 'RUNTIME_TIMEOUT' ? 'RUNTIME_TIMEOUT' : 'RUNTIME_UNAVAILABLE',
        '插件运行时离线，无法读取配置',
        503,
      );
    }
    if (!result || !result.ok) {
      const code = result && result.json && result.json.code;
      throw new CenterError(
        code === 'CONFIG_DECRYPT_FAILED' ? 'CONFIG_UNAVAILABLE' : 'CONFIG_UNAVAILABLE',
        code === 'CONFIG_DECRYPT_FAILED'
          ? '插件配置解密失败；配置密钥可能已变化'
          : '插件配置读取失败',
        502,
      );
    }
    const raw = result.json && typeof result.json.config === 'object' && result.json.config
      ? result.json.config : {};
    const fields = sensitiveFields(schema);
    const sensitive = {};
    for (const field of fields) {
      sensitive[field] = raw[field] !== undefined && raw[field] !== null && raw[field] !== '';
    }
    const declared = {};
    for (const key of Object.keys((schema && schema.properties) || {})) {
      if (raw[key] !== undefined) declared[key] = raw[key];
    }
    return {
      schema,
      values: maskSensitive(declared, fields),
      sensitive,
      has_custom_ui: !!(descriptor.frontend.entry || (descriptor.ui.pages || []).length),
      runtime_online: true,
      configured: Object.keys(raw).length > 0,
      validation: validateConfig(schema, declared),
    };
  }

  async function versions(id) {
    const tool = requireTool(id);
    const entry = storeEntry(id);
    const rollback = rollbackView(tool);
    const updateAvailable = !!entry
      && compareSemver(entry.latest_revision, tool.revision) > 0
      && entry.compatibility.supported;
    return {
      current: {
        revision: tool.revision,
        source: tool.source,
        sha256: tool.sha256 || '',
        installed_at: tool.installed_at,
      },
      latest: entry ? {
        revision: entry.latest_revision,
        reviewed: !!entry.reviewed,
        compatibility: entry.compatibility,
      } : null,
      rollback,
      update_available: updateAvailable,
      review: entry && entry.review ? entry.review : null,
    };
  }

  function tasks({ toolId = '', status = '', limit = 50, offset = 0 } = {}) {
    if (toolId && !TOOL_ID_RE.test(String(toolId))) {
      throw new CenterError('INVALID_PLUGIN_ID', '插件 ID 不合法', 400);
    }
    if (status && !toolboxRepo.TASK_STATUSES.includes(status)) {
      throw new CenterError('INVALID_QUERY', '任务状态不合法', 400);
    }
    const capped = Math.max(1, Math.min(Number(limit) || 50, 100));
    const skip = Math.max(0, Number(offset) || 0);
    return {
      // details 是插件私有数据，可能含路径；管理 API 不下发。
      tasks: toolboxRepo.listTasks(getDb(), { status, toolId, limit: capped, offset: skip, maxLimit: 100 })
        .map(({ details: _details, ...task }) => ({
          ...task, error: redactText(task.error || '', 1000), message: redactText(task.message || '', 1000),
        })),
      total: toolboxRepo.countTasks(getDb(), { status, toolId }),
      limit: capped,
      offset: skip,
    };
  }

  function taskDetail(taskId) {
    const id = Number(taskId);
    const task = Number.isSafeInteger(id) && id > 0 ? toolboxRepo.getTask(getDb(), id) : null;
    if (!task) throw new CenterError('TASK_NOT_FOUND', '任务不存在', 404);
    const tool = toolboxRepo.getTool(getDb(), task.tool_id);
    const book = task.result_book_id ? booksRepo.getBook(task.result_book_id) : null;
    const artifacts = toolboxRepo.listArtifactsForTask(getDb(), task.id).map((item) => ({
      artifact_id: item.artifact_id,
      format: item.format,
      mime: item.mime,
      size: item.size,
      sha256: item.sha256,
      title: item.title,
      created_at: item.created_at,
    }));
    const { details: _details, ...taskView } = task;
    return {
      task: { ...taskView, error: redactText(task.error || '', 1000), message: redactText(task.message || '', 1000) },
      plugin: tool ? { tool_id: tool.tool_id, name: tool.name } : null,
      book: book ? { id: book.id, title: book.title } : null,
      artifacts,
    };
  }

  async function logs(id, { type = 'errors', limit = 50, offset = 0 } = {}) {
    requireTool(id);
    const capped = Math.max(1, Math.min(Number(limit) || 50, 200));
    const skip = Math.max(0, Number(offset) || 0);
    if (!['errors', 'tasks', 'audit', 'stdout'].includes(type)) {
      throw new CenterError('INVALID_QUERY', '日志类型不合法', 400);
    }
    if (type === 'stdout') {
      return {
        available: false,
        reason: 'SOURCE_NOT_IMPLEMENTED',
        entries: [],
        total: 0,
        type,
        limit: capped,
        offset: skip,
        note: 'Runtime 不提供逐插件 stdout 捕获；容器日志请查看 toolbox-runtime',
      };
    }
    if (type === 'audit') {
      const result = await auditLog.list({ toolId: id, limit: capped, offset: skip });
      return {
        available: true,
        type,
        entries: result.entries.map((item) => ({
          at: item.at,
          level: item.result === 'success' ? 'info' : 'error',
          source: 'audit',
          tool_id: id,
          code: item.action,
          message: `${item.action} ${item.result}${item.error_code ? ` (${item.error_code})` : ''}`,
        })),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        note: '来自 state/audit.jsonl 的管理操作审计',
      };
    }

    const entries = [];
    if (type === 'errors') {
      const tool = toolboxRepo.getTool(getDb(), id);
      if (tool && tool.last_error) {
        entries.push({
          at: tool.updated_at,
          level: 'error',
          source: 'plugin',
          tool_id: id,
          code: 'PLUGIN_ERROR',
          message: redactText(tool.last_error, 1000),
        });
      }
      for (const task of toolboxRepo.listTasks(getDb(), {
        status: 'failed', toolId: id, limit: 200, maxLimit: 200,
      })) {
        entries.push({
          at: task.finished_at || task.created_at,
          level: 'error',
          source: 'task',
          tool_id: id,
          code: 'TASK_FAILED',
          message: redactText(task.error || task.message || '任务失败', 1000),
        });
      }
    } else {
      for (const task of toolboxRepo.listTasks(getDb(), {
        toolId: id, limit: 200, maxLimit: 200,
      })) {
        entries.push({
          at: task.created_at,
          level: task.status === 'failed' ? 'error' : 'info',
          source: 'task',
          tool_id: id,
          code: String(task.status || '').toUpperCase(),
          message: redactText(task.message || task.error || `${task.operation} ${task.stage}`, 1000),
        });
      }
    }
    entries.sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));
    return {
      available: true,
      type,
      entries: entries.slice(skip, skip + capped),
      total: entries.length,
      limit: capped,
      offset: skip,
      note: 'Runtime stdout 不在本接口内；容器日志请查看 toolbox-runtime',
    };
  }

  async function security() {
    const db = getDb();
    const tools = toolboxRepo.listTools(db);
    const descriptors = descriptorApi.getInstalledPluginDescriptors({ db });
    const health = await healthOf({ timeoutMs: 2000 });
    return buildSecurity({ tools, descriptors, health, policy: grants.loadGrants() });
  }

  async function runtimeAndSecurity() {
    const db = getDb();
    const tools = toolboxRepo.listTools(db);
    const descriptors = descriptorApi.getInstalledPluginDescriptors({ db });
    const health = await healthOf({ timeoutMs: 2000 });
    const securityView = buildSecurity({ tools, descriptors, health, policy: grants.loadGrants() });
    const info = health && health.info && typeof health.info === 'object' ? health.info : {};
    return {
      toolbox: {
        online: !!(health && health.online),
        status: health && health.status ? health.status : 0,
        error: redactText((health && health.error) || '', 300),
        // 只下发部署核对所需字段，绝不返回 toolbox_dir/data_dir 绝对路径。
        info: {
          plugins: Array.isArray(info.plugins) ? info.plugins : [],
          isolated: !!info.isolated,
          isolation_mode: isolationMode(info),
          plugin_auth_only: info.plugin_auth_only !== undefined ? !!info.plugin_auth_only : null,
        },
        path: securityView.runtime.path,
      },
      security: securityView,
    };
  }

  return {
    overview,
    storeIndex,
    storeDetail,
    installed,
    detail,
    permissions,
    config,
    versions,
    tasks,
    taskDetail,
    logs,
    security,
    runtimeAndSecurity,
  };
}

const center = createCenter();

module.exports = { CenterError, createCenter, center };
