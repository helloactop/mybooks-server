/* ============================================================
 * 插件配置管理（Node 侧桥接）
 *
 * 配置的加密与落盘只在 Python Runtime 内完成；Node 只负责：
 *   · 调用 /internal/tool/:id/config 读取与写入；
 *   · 按 Manifest Schema 校验字段；
 *   · 敏感字段掩码、保留与显式清除；
 *   · 版本冲突映射与审计。
 *
 * 不允许在 Node 侧实现 AES-GCM，也不允许直接读写 data/<id>/config.json。
 * ============================================================ */

const crypto = require('node:crypto');

const { ToolboxError } = require('./security');
const { TOOL_ID_RE } = require('./manifest');
const descriptorApi = require('./descriptor');
const audit = require('./audit');
const dbSingleton = require('../../db/index');
const toolboxRepo = require('../../db/toolbox');
const { runtimeHealth, callRuntime } = require('./runtime');
const {
  validateConfig, sensitiveFields, maskSensitive, MASK,
} = require('./config-schema');

const MAX_FIELDS = 64;
const MAX_CLEAR = 32;

function jsonStable(value) {
  if (Array.isArray(value)) return `[${value.map(jsonStable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jsonStable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Runtime 会返回同名算法版本；旧 Runtime 没有 version 字段时用本地等价实现兜底。
function versionOf(values) {
  return `sha256:${crypto.createHash('sha256').update(jsonStable(values || {})).digest('hex')}`;
}

function configPath(id) {
  return `/internal/tool/${encodeURIComponent(id)}/config`;
}

function runtimeError(err) {
  if (err && err.code === 'RUNTIME_TIMEOUT') {
    return new ToolboxError('RUNTIME_UNAVAILABLE', '插件运行时响应超时，无法读取配置', 504);
  }
  if (err && err.code === 'RUNTIME_UNAVAILABLE') {
    return new ToolboxError('RUNTIME_UNAVAILABLE', '插件运行时离线，无法读写配置', 503);
  }
  return new ToolboxError('RUNTIME_UNAVAILABLE', '插件运行时不可用', 503);
}

function createConfigService(deps = {}) {
  const getDb = () => deps.db || dbSingleton.db;
  const healthOf = deps.runtimeHealth || runtimeHealth;
  const callRuntimeOf = deps.callRuntime || callRuntime;
  const auditLog = deps.audit || audit;
  const descriptorFor = deps.descriptorOf || ((id) => {
    const tool = toolboxRepo.getTool(getDb(), id);
    if (!tool) throw new ToolboxError('PLUGIN_NOT_FOUND', '插件未安装', 404);
    const descriptor = descriptorApi.getPluginDescriptor(id, { db: getDb() });
    if (!descriptor) throw new ToolboxError('PLUGIN_NOT_FOUND', '插件未安装', 404);
    return descriptorApi.toPublicDescriptor(descriptor);
  });

  function requireId(raw) {
    const id = String(raw || '').trim();
    if (!TOOL_ID_RE.test(id)) throw new ToolboxError('INVALID_PLUGIN_ID', '插件 ID 不合法', 400);
    return id;
  }

  async function ensureRuntime() {
    let health;
    try {
      health = await healthOf({ timeoutMs: 2000 });
    } catch {
      health = null;
    }
    if (!health || !health.online) {
      throw new ToolboxError('RUNTIME_UNAVAILABLE', '插件运行时离线，无法读写配置', 503);
    }
  }

  async function fetchRaw(id) {
    await ensureRuntime();
    let result;
    try {
      result = await callRuntimeOf(configPath(id), { method: 'GET', timeoutMs: 5000 });
    } catch (err) {
      throw runtimeError(err);
    }
    if (!result || !result.ok) {
      const code = result && result.json && result.json.code;
      if (code === 'CONFIG_NOT_FOUND') return { data: {}, version: '' };
      throw new ToolboxError(
        code === 'CONFIG_DECRYPT_FAILED' ? 'CONFIG_UNAVAILABLE' : 'CONFIG_UNAVAILABLE',
        code === 'CONFIG_DECRYPT_FAILED'
          ? '插件配置解密失败；配置密钥可能已变化'
          : '插件配置读取失败',
        502,
      );
    }
    const json = (result && result.json) || {};
    const data = json.config && typeof json.config === 'object' && !Array.isArray(json.config)
      ? json.config : {};
    const version = typeof json.version === 'string' && json.version ? json.version : versionOf(data);
    return { data, version };
  }

  function schemaOf(id) {
    const descriptor = descriptorFor(id);
    const schema = descriptor.configuration && descriptor.configuration.schema;
    if (!schema) {
      throw new ToolboxError('CONFIG_SCHEMA_MISSING', '该插件没有声明式配置 Schema', 404);
    }
    return {
      descriptor,
      schema,
      fields: sensitiveFields(schema),
      hasCustomUi: !!(descriptor.frontend.entry || (descriptor.ui.pages || []).length),
    };
  }

  function buildView({ schema, fields, hasCustomUi }, data) {
    const sensitive = {};
    for (const field of fields) {
      sensitive[field] = data[field] !== undefined && data[field] !== null && data[field] !== '';
    }
    const declared = {};
    for (const key of Object.keys((schema && schema.properties) || {})) {
      if (data[key] !== undefined) declared[key] = data[key];
    }
    return {
      schema,
      values: maskSensitive(declared, fields),
      sensitive,
      has_custom_ui: hasCustomUi,
      runtime_online: true,
      configured: Object.keys(data).length > 0,
      validation: validateConfig(schema, declared),
    };
  }

  async function read(rawId) {
    const id = requireId(rawId);
    const info = schemaOf(id);
    const { data, version } = await fetchRaw(id);
    return { ...buildView(info, data), version };
  }

  function failValidation(errors) {
    const error = new ToolboxError('CONFIG_VALIDATION_FAILED', '配置校验失败', 400);
    error.details = { errors };
    throw error;
  }

  /**
   * 字段级合并保存：只提交发生变化的字段；敏感字段未出现在 values 时保持原值，
   * 只有出现在 clear_sensitive 才会被删除。
   */
  async function save(rawId, input = {}) {
    const id = requireId(rawId);
    const info = schemaOf(id);
    const { schema, fields } = info;
    const properties = (schema && schema.properties) || {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    const rawValues = input.values === undefined || input.values === null ? {} : input.values;
    if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
      throw new ToolboxError('CONFIG_VALIDATION_FAILED', 'values 必须是对象', 400);
    }
    const keys = Object.keys(rawValues);
    if (keys.length > MAX_FIELDS) failValidation([{ field: '', code: 'CONFIG_TOO_MANY', message: '一次提交的字段过多' }]);

    const rawClear = input.clearSensitive === undefined || input.clearSensitive === null
      ? [] : input.clearSensitive;
    if (!Array.isArray(rawClear) || rawClear.length > MAX_CLEAR) {
      failValidation([{ field: '', code: 'CONFIG_CLEAR_INVALID', message: 'clear_sensitive 必须是数组' }]);
    }
    const clear = [...new Set(rawClear.map((item) => String(item || '').trim()).filter(Boolean))];
    for (const field of clear) {
      if (!Object.prototype.hasOwnProperty.call(properties, field) || !fields.includes(field)) {
        failValidation([{ field, code: 'CONFIG_CLEAR_INVALID', message: `字段 ${field} 不是可清除的敏感配置` }]);
      }
      if (Object.prototype.hasOwnProperty.call(rawValues, field)) {
        failValidation([{ field, code: 'CONFIG_CLEAR_CONFLICT', message: `字段 ${field} 不能同时设置和清除` }]);
      }
    }

    // 掩码值只是展示用的占位符：等于掩码时视为“保持原值”，绝不能写回真实配置。
    const values = {};
    const maskedKept = [];
    for (const key of keys) {
      const value = rawValues[key];
      if (fields.includes(key) && value === MASK) { maskedKept.push(key); continue; }
      values[key] = value;
    }

    const current = await fetchRaw(id);
    const sensitiveState = {};
    for (const field of fields) {
      sensitiveState[field] = current.data[field] !== undefined && current.data[field] !== null && current.data[field] !== '';
    }

    const submittedKeys = Object.keys(values);
    const unknown = submittedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
    if (unknown.length) {
      failValidation(unknown.map((field) => ({
        field, code: 'CONFIG_UNKNOWN_FIELD', message: `未知配置字段 ${field}`,
      })));
    }
    const checked = validateConfig(schema, values, { partial: true });
    if (!checked.ok) failValidation(checked.errors);

    // 必填完整性：合并后（未提供的字段沿用当前值/已配置状态）必须齐全。
    const missing = [];
    for (const field of required) {
      const provided = Object.prototype.hasOwnProperty.call(values, field)
        && values[field] !== undefined && values[field] !== null && values[field] !== '';
      if (provided) continue;
      if (clear.includes(field)) { missing.push(field); continue; }
      const configured = Object.prototype.hasOwnProperty.call(values, field)
        ? values[field] !== undefined && values[field] !== null && values[field] !== ''
        : (fields.includes(field) ? sensitiveState[field] : current.data[field] !== undefined
          && current.data[field] !== null && current.data[field] !== '');
      if (!configured) missing.push(field);
    }
    if (missing.length) {
      failValidation(missing.map((field) => ({
        field, code: 'CONFIG_REQUIRED', message: `缺少必填配置 ${field}`,
      })));
    }

    const changedFields = submittedKeys.filter((key) => jsonStable(values[key]) !== jsonStable(current.data[key]));
    if (!changedFields.length && !clear.length && !maskedKept.length) {
      return { ...buildView(info, current.data), version: current.version, changed: { fields: [], cleared: [] } };
    }

    const ifVersion = input.ifVersion === undefined || input.ifVersion === null
      ? current.version : String(input.ifVersion);
    if (ifVersion !== current.version) {
      const conflict = new ToolboxError('CONFIG_VERSION_CONFLICT', '配置已被其他操作修改，请刷新后重试', 409);
      conflict.details = { current_version: current.version };
      throw conflict;
    }

    await ensureRuntime();
    let result;
    try {
      result = await callRuntimeOf(configPath(id), {
        method: 'PUT',
        body: { version: ifVersion, values, clear },
        timeoutMs: 8000,
      });
    } catch (err) {
      throw runtimeError(err);
    }
    if (!result || !result.ok) {
      const code = result && result.json && result.json.code;
      if (result && result.status === 409 || code === 'CONFIG_VERSION_CONFLICT') {
        const conflict = new ToolboxError('CONFIG_VERSION_CONFLICT', '配置已被其他操作修改，请刷新后重试', 409);
        conflict.details = { current_version: (result.json && result.json.version) || '' };
        throw conflict;
      }
      if (result && result.status === 400 || code === 'CONFIG_INVALID') {
        failValidation((result.json && result.json.errors) || [{
          field: '', code: 'CONFIG_INVALID', message: '配置校验失败',
        }]);
      }
      throw new ToolboxError('CONFIG_SAVE_FAILED', '插件配置保存失败', 502);
    }

    const saved = await fetchRaw(id);
    if (changedFields.length) {
      await auditLog.record({
        action: 'config.update', tool_id: id, result: 'success',
        detail: { changed_fields: changedFields.slice(0, 20) },
      });
    }
    if (clear.length) {
      await auditLog.record({
        action: 'config.secret.clear', tool_id: id, result: 'success',
        detail: { changed_fields: clear.slice(0, 20) },
      });
    }
    return {
      ...buildView(info, saved.data),
      version: saved.version,
      changed: { fields: changedFields, cleared: clear },
    };
  }

  async function recordFailure(id, action, code) {
    if (!TOOL_ID_RE.test(String(id || ''))) return;
    await auditLog.record({ action, tool_id: id, result: 'error', error_code: code || 'UNKNOWN' });
  }

  return { read, save, recordFailure };
}

const config = createConfigService();

module.exports = { createConfigService, config, versionOf, MASK };
