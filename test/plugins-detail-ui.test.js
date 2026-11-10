/* ============================================================
 * Phase 4C.4.4：配置表单与详情页共享逻辑单元测试
 *
 * 只测纯函数（字段生成、校验、提交内容计算、掩码与清除语义）。
 * 真实浏览器交互在 4C.4.6 手工验收中记录。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const F = require('../public/js/plugin-config-form.js');

const SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', enum: ['zh-CN', 'en-US'], default: 'zh-CN', title: '界面语言' },
    font_size: { type: 'integer', minimum: 8, maximum: 72, description: '正文字号' },
    ratio: { type: 'number' },
    enabled: { type: 'boolean' },
    api_key: { type: 'string', 'x-sensitive': true, title: 'API Key' },
  },
  required: ['language', 'api_key'],
};

test('buildFields：类型、必填、默认值与敏感字段', () => {
  const fields = F.buildFields(SCHEMA, { language: 'en-US', api_key: '******' }, { api_key: true });
  const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));

  assert.equal(byKey.language.type, 'string');
  assert.equal(byKey.language.required, true);
  assert.equal(byKey.language.value, 'en-US');
  assert.deepEqual(byKey.language.enumValues, ['zh-CN', 'en-US']);

  assert.equal(byKey.font_size.type, 'integer');
  assert.equal(byKey.font_size.minimum, 8);
  assert.equal(byKey.font_size.maximum, 72);
  assert.equal(byKey.font_size.description, '正文字号');

  assert.equal(byKey.enabled.type, 'boolean');
  assert.equal(byKey.api_key.sensitive, true);
  assert.equal(byKey.api_key.configured, true);
  // 敏感字段永远不回填掩码或原文。
  assert.equal(byKey.api_key.value, '');
});

test('buildFields：未配置的必填字段不会凭空产生默认值', () => {
  const fields = F.buildFields(SCHEMA, {}, {});
  const key = fields.find((field) => field.key === 'api_key');
  assert.equal(key.configured, false);
  assert.equal(key.value, '');
});

test('validateField：必填、类型、枚举、范围与长度', () => {
  const fields = Object.fromEntries(F.buildFields(SCHEMA, {}, {}).map((field) => [field.key, field]));
  assert.equal(F.validateField(fields.language, 'zh-CN'), '');
  assert.match(F.validateField(fields.language, 'fr-FR'), /取值范围/);
  assert.equal(F.validateField(fields.font_size, 12), '');
  assert.match(F.validateField(fields.font_size, 12.5), /整数/);
  assert.match(F.validateField(fields.font_size, 4), /不能小于/);
  assert.match(F.validateField(fields.font_size, 100), /不能大于/);
  assert.equal(F.validateField({ ...fields.ratio, maximum: null }, 0.5), '');
  assert.equal(F.validateField({ ...fields.language, required: true }, ''), '必填项不能为空');

  const maxed = { ...fields.language, required: false, maxLength: 3, enumValues: [] };
  assert.match(F.validateField(maxed, 'abcdef'), /不能超过 3/);
});

test('collectChanges：未修改时不提交任何字段', () => {
  const fields = F.buildFields(SCHEMA, { language: 'zh-CN', api_key: '******', font_size: 12 }, { api_key: true });
  const state = {};
  for (const field of fields) state[field.key] = { value: field.value, clear: false };
  const result = F.collectChanges(fields, state);
  assert.deepEqual(result.values, {});
  assert.deepEqual(result.clear, []);
  assert.equal(result.changed, 0);
  assert.deepEqual(result.errors, []);
});

test('collectChanges：普通字段与布尔/数字转换', () => {
  const fields = F.buildFields(SCHEMA, { language: 'zh-CN', api_key: '******', font_size: 12, enabled: false }, { api_key: true });
  const state = {
    language: { value: 'en-US' },
    font_size: { value: '30' },
    enabled: { value: true },
    api_key: { value: '' },
  };
  const result = F.collectChanges(fields, state);
  assert.equal(result.values.language, 'en-US');
  assert.equal(result.values.font_size, 30);
  assert.equal(result.values.enabled, true);
  assert.equal('api_key' in result.values, false);
  assert.equal(result.changed, 3);
});

test('collectChanges：敏感字段留空保持、填写覆盖、掩码不提交', () => {
  const fields = F.buildFields(SCHEMA, { language: 'zh-CN', api_key: '******' }, { api_key: true });

  const kept = F.collectChanges(fields, { language: { value: 'zh-CN' }, api_key: { value: '' } });
  assert.deepEqual(kept.values, {});
  assert.deepEqual(kept.clear, []);

  const masked = F.collectChanges(fields, { api_key: { value: F.MASK } });
  assert.deepEqual(masked.values, {});

  const changed = F.collectChanges(fields, { api_key: { value: 'sk-new' } });
  assert.equal(changed.values.api_key, 'sk-new');
});

test('collectChanges：显式清除只对已配置的敏感字段生效', () => {
  const configured = F.buildFields(SCHEMA, { language: 'zh-CN', api_key: '******' }, { api_key: true });
  const cleared = F.collectChanges(configured, {
    language: { value: 'zh-CN' }, api_key: { value: '', clear: true },
  });
  assert.deepEqual(cleared.clear, ['api_key']);
  assert.equal(cleared.changed, 1);

  const unconfiguredFields = F.buildFields(SCHEMA, { language: 'zh-CN' }, { api_key: false });
  const noop = F.collectChanges(unconfiguredFields, { api_key: { value: '', clear: true } });
  assert.deepEqual(noop.clear, []);
  assert.equal(noop.changed, 0);
});

test('collectChanges：必填敏感字段未配置时阻止保存', () => {
  const fields = F.buildFields(SCHEMA, { language: 'zh-CN' }, { api_key: false });
  const result = F.collectChanges(fields, {
    language: { value: 'zh-CN' },
    api_key: { value: '' },
  });
  assert.ok(result.errors.some((item) => item.key === 'api_key' && /必填/.test(item.message)));
  assert.equal(result.changed, 0);
});

test('collectChanges：本地校验错误会阻止提交', () => {
  const fields = F.buildFields(SCHEMA, { language: 'zh-CN', api_key: '******', font_size: 12 }, { api_key: true });
  const result = F.collectChanges(fields, {
    language: { value: 'zh-CN' },
    api_key: { value: '' },
    font_size: { value: '5' },
  });
  assert.ok(result.errors.some((item) => item.key === 'font_size'));
  assert.equal(result.values.font_size, 5);
  assert.equal(result.changed, 1);
});

test('数组/对象字段只读且永不提交', () => {
  const schema = {
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' }, title: '标签' },
      meta: { type: 'object' },
    },
  };
  const fields = F.buildFields(schema, { tags: ['a'], meta: { x: 1 } }, {});
  assert.equal(fields[0].unsupported, true);
  assert.equal(fields[0].type, 'array');
  assert.equal(fields[1].unsupported, true);
  assert.equal(F.labelForType('array'), '列表（只读）');
  assert.equal(F.labelForType('object'), '对象（只读）');
  assert.equal(F.isUnsupportedType({ type: 'array' }), true);

  const result = F.collectChanges(fields, { tags: { value: '[a]' }, meta: { value: '{}' } });
  assert.deepEqual(result.values, {});
  assert.deepEqual(result.clear, []);
  assert.equal(result.changed, 0);
});

test('必填的数组/对象字段未配置时阻止保存', () => {
  const schema = { type: 'object', properties: { tags: { type: 'array' } }, required: ['tags'] };
  const fields = F.buildFields(schema, {}, {});
  const result = F.collectChanges(fields, {});
  assert.ok(result.errors.some((item) => item.key === 'tags' && /暂不支持/.test(item.message)));
  assert.equal(result.changed, 0);
});

test('labelForType 覆盖四种受支持类型', () => {
  assert.equal(F.labelForType('string'), '文本');
  assert.equal(F.labelForType('integer'), '整数');
  assert.equal(F.labelForType('number'), '数字');
  assert.equal(F.labelForType('boolean'), '开关');
  assert.equal(F.MASK, '******');
});
