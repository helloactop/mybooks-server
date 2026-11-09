/* ============================================================
 * 元数据检索服务：把 metadata.search@1 契约交给 Capability Router
 *
 * Router 负责权限、超时/取消、错误归一；本层负责：
 *   · 元数据能力的输入/输出契约；
 *   · 按优先级排序的 Provider 选择；
 *   · 可配置的兜底策略（显式 providerId 时永不兜底）。
 *
 * 兜底模式（MYBOOKS_METADATA_FALLBACK / fallback 选项）：
 *   off          只调用优先级最高的 Provider（旧行为）；
 *   no-results   默认：仅当首选返回空结果时尝试下一个；
 *   recoverable  空结果 + 可恢复的上游错误（超时/HTTP 失败）继续尝试。
 * BLOCKED（上游反爬/拒绝访问）与权限/输入错误不兜底，保持旧错误语义。
 * ============================================================ */

const { CapabilityRouter } = require('../capability-router');
const { ServiceRegistry } = require('../registry');
const {
  CAPABILITY,
  VERSION,
  normalizeInput,
  normalizeCandidates,
} = require('../capabilities/metadata-search');
const { createDoubanProvider } = require('../providers/douban');
const { createOpenLibraryProvider } = require('../providers/openlibrary');

const FALLBACK_MODES = Object.freeze(['off', 'no-results', 'recoverable']);
const DEFAULT_FALLBACK = 'no-results';

function normalizeFallback(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_FALLBACK;
  const text = String(value).trim().toLowerCase();
  if (!FALLBACK_MODES.includes(text)) {
    throw new TypeError(`fallback 只能是 ${FALLBACK_MODES.join(' / ')}`);
  }
  return text;
}

// 这些错误可以换一个来源再试；BLOCKED / 权限 / 输入 / 输出格式异常不兜底。
function recoverable(err) {
  return !!err && (err.code === 'UPSTREAM_TIMEOUT' || err.code === 'UPSTREAM_ERROR');
}

class MetadataSearchService {
  constructor({ registry, grants, logger, timeoutMs, fallback } = {}) {
    if (!registry) throw new TypeError('MetadataSearchService 需要 Registry');
    this._registry = registry;
    this._fallback = normalizeFallback(fallback === undefined ? process.env.MYBOOKS_METADATA_FALLBACK : fallback);
    this._router = new CapabilityRouter({ registry, grants, logger, timeoutMs });
  }

  _contract() {
    return {
      normalizeInput,
      permission: 'metadata.read',
      normalizeOutput: (raw, context) => normalizeCandidates(raw, context.providerId, context.input.limit),
    };
  }

  async search(input, { providerId, principal, signal } = {}) {
    const contract = this._contract();
    const base = { capability: CAPABILITY, version: VERSION, input, contract, principal, signal };

    // 显式来源：只调用指定 Provider，不启用兜底。
    if (providerId) {
      const result = await this._router.invoke({ ...base, providerId });
      return { candidates: result.output, providerId: result.providerId };
    }

    const descriptors = this._registry.list(CAPABILITY, VERSION);
    if (!descriptors.length || this._fallback === 'off') {
      const result = await this._router.invoke(base);
      return { candidates: result.output, providerId: result.providerId };
    }

    let firstError = null;
    let chosen = null;
    let empty = null;

    for (const descriptor of descriptors) {
      try {
        const result = await this._router.invoke({ ...base, providerId: descriptor.providerId });
        if (result.output.length > 0) {
          chosen = result;
          break;
        }
        // 空结果：记录首个空来源，继续按策略尝试下一个。
        if (!empty) empty = result;
      } catch (err) {
        if (!firstError) firstError = err;
        if (!recoverable(err) || this._fallback !== 'recoverable') {
          throw firstError;
        }
      }
    }

    if (chosen) return { candidates: chosen.output, providerId: chosen.providerId };
    if (empty) return { candidates: [], providerId: empty.providerId };
    throw firstError || new Error('没有可用的元数据来源');
  }
}

function createBuiltinMetadataService({
  registry,
  kernel,
  providers = {},
  grants,
  logger,
  timeoutMs,
  fallback,
} = {}) {
  const target = registry || (kernel ? kernel.registry : new ServiceRegistry());
  const disposers = [];

  // 通过 Kernel 的组合入口注册内置 Provider；没有 Kernel 时退回纯 Registry。
  if (kernel) {
    kernel.define({
      instanceId: 'builtin.douban',
      providerId: 'douban',
      activate: (ctx) => { ctx.register(createDoubanProvider(providers.douban)); },
    });
    kernel.define({
      instanceId: 'builtin.openlibrary',
      providerId: 'openlibrary',
      activate: (ctx) => { ctx.register(createOpenLibraryProvider(providers.openlibrary)); },
    });
  } else {
    disposers.push(target.register(createDoubanProvider(providers.douban)));
    disposers.push(target.register(createOpenLibraryProvider(providers.openlibrary)));
  }

  const service = new MetadataSearchService({
    registry: target,
    grants: grants || (kernel && kernel.grants),
    logger,
    timeoutMs,
    fallback,
  });

  return {
    registry: target,
    service,
    async start() {
      if (!kernel) return;
      await kernel.start('builtin.douban');
      await kernel.start('builtin.openlibrary');
    },
    dispose() {
      for (const dispose of disposers.reverse()) dispose();
      if (kernel) {
        // 内置实例交给宿主统一关闭；这里只注销本层持有的注册。
      }
    },
  };
}

module.exports = { MetadataSearchService, createBuiltinMetadataService, FALLBACK_MODES, DEFAULT_FALLBACK };
