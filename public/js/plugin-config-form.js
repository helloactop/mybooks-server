/* ============================================================
 * 插件配置表单（纯函数）
 *
 * 只覆盖 Manifest v1 / config-schema.js 真实支持的规则：
 *   type(string/number/integer/boolean) / enum / required /
 *   default / minimum / maximum / maxLength / x-sensitive
 *
 * 不实现后端不支持的 JSON Schema 关键字，避免前端造出“看起来能存”的字段。
 * 浏览器挂 window.MyBooksConfigForm；Node 下导出同名对象供单测。
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof window !== 'undefined') window.MyBooksConfigForm = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MASK = '******';

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function fieldType(node) {
    const type = String((node && node.type) || 'string').toLowerCase();
    if (type === 'integer' || type === 'number' || type === 'boolean') return type;
    return 'string';
  }

  /**
   * 由 Schema 生成表单字段。
   * 敏感字段永远不回填原值，只给出 configured 状态。
   */
  function buildFields(schema, values, sensitive) {
    const properties = isPlainObject(schema && schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema && schema.required) ? schema.required : []);
    const source = isPlainObject(values) ? values : {};
    const flags = isPlainObject(sensitive) ? sensitive : {};
    return Object.keys(properties).map((key) => {
      const node = isPlainObject(properties[key]) ? properties[key] : {};
      const type = fieldType(node);
      const isSensitive = node['x-sensitive'] === true || flags[key] === true;
      const hasValue = source[key] !== undefined && source[key] !== null;
      // 布尔字段没有“空字符串”概念：未配置即 false，避免一进页面就被判成已修改。
      const initial = type === 'boolean'
        ? (hasValue ? source[key] === true : node.default === true)
        : (hasValue ? source[key] : (node.default === undefined ? '' : node.default));
      return {
        key,
        label: String(node.title || key),
        description: String(node.description || ''),
        type,
        required: required.has(key),
        sensitive: isSensitive,
        configured: isSensitive ? !!flags[key] : hasValue,
        enumValues: Array.isArray(node.enum) ? node.enum.slice(0, 50) : [],
        minimum: node.minimum === undefined ? null : Number(node.minimum),
        maximum: node.maximum === undefined ? null : Number(node.maximum),
        maxLength: node.maxLength === undefined ? null : Number(node.maxLength),
        defaultValue: node.default === undefined ? '' : node.default,
        // 敏感字段不回填；普通字段展示真实值（已是服务端允许展示的部分）。
        value: isSensitive ? '' : initial,
      };
    });
  }

  function coerce(field, raw) {
    if (!field) return raw;
    if (field.type === 'boolean') return raw === true || raw === 'true' || raw === 'on' || raw === 1;
    if (field.type === 'integer' || field.type === 'number') {
      if (raw === '' || raw === null || raw === undefined) return '';
      const number = Number(raw);
      return Number.isFinite(number) ? number : raw;
    }
    if (field.enumValues.length) {
      const match = field.enumValues.find((item) => String(item) === String(raw));
      return match === undefined ? raw : match;
    }
    return raw === null || raw === undefined ? '' : String(raw);
  }

  // 返回 '' 表示通过；否则返回可直接展示的中文错误。
  function validateField(field, value) {
    if (!field) return '';
    const empty = value === '' || value === null || value === undefined;
    if (field.required && empty) return '必填项不能为空';
    if (empty) return '';
    if (field.type === 'boolean') return typeof value === 'boolean' ? '' : '必须是布尔值';
    if (field.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) return '必须是整数';
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是数字';
    }
    if (field.type === 'string' && typeof value !== 'string') return '必须是文本';
    if (field.enumValues.length && !field.enumValues.some((item) => item === value)) {
      return '不在允许的取值范围内';
    }
    if (typeof value === 'number') {
      if (field.minimum !== null && Number.isFinite(field.minimum) && value < field.minimum) {
        return `不能小于 ${field.minimum}`;
      }
      if (field.maximum !== null && Number.isFinite(field.maximum) && value > field.maximum) {
        return `不能大于 ${field.maximum}`;
      }
    }
    if (typeof value === 'string' && field.maxLength !== null && Number.isFinite(field.maxLength)
      && value.length > field.maxLength) {
      return `不能超过 ${field.maxLength} 个字符`;
    }
    return '';
  }

  /**
   * 计算提交内容。
   * state: { [key]: { value, clear } }，value 是控件里的原始值。
   * 规则：
   *   · 敏感字段：留空 = 保持原值；填写 = 覆盖；勾选 clear = 删除；
   *   · 普通字段：与初始值相同则不提交；
   *   · 掩码字符串永远不会被当成新值提交。
   */
  function collectChanges(fields, state) {
    const values = {};
    const clear = [];
    const errors = [];
    for (const field of fields || []) {
      const row = (state && state[field.key]) || { value: field.value, clear: false };
      const raw = row.value;
      if (field.sensitive) {
        if (row.clear) {
          if (!field.configured) continue; // 本来就没配置，无需清除
          clear.push(field.key);
          continue;
        }
        if (raw === '' || raw === null || raw === undefined) continue; // 保持原值
        if (raw === MASK) continue; // 防御：掩码不是真实值
        values[field.key] = coerce(field, raw);
        continue;
      }
      const next = coerce(field, raw);
      const same = JSON.stringify(next) === JSON.stringify(field.value === undefined ? '' : field.value);
      if (!same) values[field.key] = next;
    }
    for (const field of fields || []) {
      const row = (state && state[field.key]) || { value: field.value, clear: false };
      if (field.sensitive && row.clear) continue;
      const effective = field.sensitive
        ? (row.value === '' || row.value === null || row.value === undefined ? null : row.value)
        : coerce(field, row.value);
      if (field.sensitive && (effective === null || effective === undefined)) {
        // 留空表示保持原值：必填校验交给服务端按“已配置”状态判断。
        if (field.required && !field.configured) {
          errors.push({ key: field.key, message: '必填项不能为空' });
        }
        continue;
      }
      const message = validateField(field, effective);
      if (message) errors.push({ key: field.key, message });
    }
    return { values, clear, errors, changed: Object.keys(values).length + clear.length };
  }

  function labelForType(type) {
    if (type === 'boolean') return '开关';
    if (type === 'integer') return '整数';
    if (type === 'number') return '数字';
    return '文本';
  }

  return {
    MASK,
    buildFields,
    coerce,
    validateField,
    collectChanges,
    labelForType,
  };
});
