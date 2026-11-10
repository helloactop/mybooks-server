/* ============================================================
 * Manifest v1 config.schema 校验
 *
 * 只实现 manifest-v1.js 归一化后实际保留的字段子集：
 *   type / properties / required / enum / minimum / maximum /
 *   maxLength / items / x-sensitive
 * 校验结果只包含字段名与规则，不回报用户填写的原始值。
 * ============================================================ */

const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validateNode(node, value, field, errors) {
  if (!isPlainObject(node)) return;
  const type = String(node.type || '').toLowerCase();
  if (type && TYPES.has(type)) {
    const actual = typeOf(value);
    const ok = (type === 'number' && actual === 'integer')
      || actual === type
      || (type === 'integer' && actual === 'integer');
    if (!ok) {
      errors.push({ field, code: 'CONFIG_TYPE', message: `字段 ${field || '(root)'} 应为 ${type}` });
      return;
    }
  }
  if (node.enum !== undefined) {
    const allowed = Array.isArray(node.enum) ? node.enum : [];
    if (allowed.length && !allowed.some((item) => item === value)) {
      errors.push({ field, code: 'CONFIG_ENUM', message: `字段 ${field} 不在允许取值内` });
    }
  }
  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < Number(node.minimum)) {
      errors.push({ field, code: 'CONFIG_MINIMUM', message: `字段 ${field} 小于最小值` });
    }
    if (node.maximum !== undefined && value > Number(node.maximum)) {
      errors.push({ field, code: 'CONFIG_MAXIMUM', message: `字段 ${field} 超过最大值` });
    }
  }
  if (typeof value === 'string' && node.maxLength !== undefined && value.length > Number(node.maxLength)) {
    errors.push({ field, code: 'CONFIG_MAX_LENGTH', message: `字段 ${field} 超过长度上限` });
  }
  if (Array.isArray(value) && isPlainObject(node.items)) {
    value.forEach((item, index) => {
      validateNode(node.items, item, field ? `${field}[${index}]` : `[${index}]`, errors);
    });
  }
}

/**
 * 校验配置。
 * partial=true 时只校验本次提交的字段（不做 required 检查），
 * 供管理端“字段级合并更新”使用；规则与整份校验完全一致。
 */
function validateConfig(schema, values, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(schema) || schema.type !== 'object') {
    return { ok: false, errors: [{ field: '', code: 'CONFIG_SCHEMA_INVALID', message: '配置 Schema 无效' }] };
  }
  const input = isPlainObject(values) ? values : {};
  if (!isPlainObject(values)) {
    errors.push({ field: '', code: 'CONFIG_TYPE', message: '配置必须是对象' });
  }
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!partial) {
    for (const key of required) {
      if (input[key] === undefined || input[key] === null || input[key] === '') {
        errors.push({ field: key, code: 'CONFIG_REQUIRED', message: `缺少必填配置 ${key}` });
      }
    }
  }
  for (const [key, node] of Object.entries(properties)) {
    if (input[key] === undefined) continue;
    validateNode(node, input[key], key, errors);
  }
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      errors.push({ field: key, code: 'CONFIG_UNKNOWN_FIELD', message: `未知配置字段 ${key}` });
    }
  }
  return { ok: errors.length === 0, errors };
}

function sensitiveFields(schema) {
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return [];
  return Object.keys(schema.properties)
    .filter((key) => schema.properties[key] && schema.properties[key]['x-sensitive'] === true);
}

const MASK = '******';

function maskSensitive(values, fields) {
  const input = isPlainObject(values) ? { ...values } : {};
  for (const field of fields || []) {
    if (input[field] !== undefined && input[field] !== null && input[field] !== '') input[field] = MASK;
  }
  return input;
}

module.exports = { validateConfig, sensitiveFields, maskSensitive, MASK };
