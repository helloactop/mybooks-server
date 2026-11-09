/* ============================================================
 * 元数据检索服务：能力选择 + 调用编排 + 输出规范化
 *
 * 默认取 Registry 中优先级最高的 Provider；显式 providerId 时不回退。
 * 这里不做 HTTP 缓存、Cookie 提示或书库写入 —— 那些属于路由/宿主。
 * ============================================================ */

const { ServiceRegistry } = require('../registry');
const {
  CAPABILITY,
  VERSION,
  MetadataSearchError,
  normalizeInput,
  normalizeCandidates,
} = require('../capabilities/metadata-search');
const { createDoubanProvider } = require('../providers/douban');
const { createOpenLibraryProvider } = require('../providers/openlibrary');

const DEFAULT_TIMEOUT_MS = 45_000;

function withTimeout(promise, ms) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('元数据查询超时'), { code: 'TIMEOUT' }));
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function mapProviderError(err) {
  if (err instanceof MetadataSearchError) return err;
  const code = err && err.code;
  if (code === 'BLOCKED') {
    return new MetadataSearchError('UPSTREAM_BLOCKED', err.message || '上游拒绝访问', 502, err);
  }
  if (code === 'UPSTREAM') {
    return new MetadataSearchError('UPSTREAM_ERROR', err.message || '上游请求失败', 502, err);
  }
  if (code === 'TIMEOUT' || (err && (err.name === 'TimeoutError' || err.name === 'AbortError'))) {
    return new MetadataSearchError('UPSTREAM_TIMEOUT', '上游请求超时', 504, err);
  }
  return new MetadataSearchError('PROVIDER_ERROR', (err && err.message) || 'Provider 调用失败', 500, err);
}

class MetadataSearchService {
  constructor({ registry, logger, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!registry) throw new TypeError('MetadataSearchService 需要 Registry');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs 不能为负数');
    this._registry = registry;
    this._logger = logger || console;
    this._timeoutMs = timeoutMs;
  }

  async search(input, { providerId } = {}) {
    const normalized = normalizeInput(input);

    const descriptors = providerId
      ? [this._registry.get(CAPABILITY, VERSION, providerId)].filter(Boolean)
      : this._registry.list(CAPABILITY, VERSION);

    if (!descriptors.length) {
      if (providerId) {
        throw new MetadataSearchError('PROVIDER_NOT_FOUND', `未知 Provider：${providerId}`, 404);
      }
      throw new MetadataSearchError('NO_PROVIDER', '没有可用的元数据来源', 503);
    }

    const chosen = descriptors[0];
    try {
      const { invoke } = this._registry.resolve(CAPABILITY, VERSION, chosen.providerId);
      const result = await withTimeout(
        invoke(normalized, { providerId: chosen.providerId }),
        this._timeoutMs,
      );
      return {
        candidates: normalizeCandidates(result, chosen.providerId, normalized.limit),
        providerId: chosen.providerId,
      };
    } catch (err) {
      const mapped = mapProviderError(err);
      if (mapped.code === 'PROVIDER_ERROR') {
        try {
          this._logger.error('[metadata] provider failed', chosen.providerId, err && (err.message || err));
        } catch { /* 日志失败不影响错误返回 */ }
      }
      throw mapped;
    }
  }
}

function createBuiltinMetadataService({ registry = new ServiceRegistry(), providers = {}, logger, timeoutMs } = {}) {
  const disposers = [
    registry.register(createDoubanProvider(providers.douban)),
    registry.register(createOpenLibraryProvider(providers.openlibrary)),
  ];
  const service = new MetadataSearchService({ registry, logger, timeoutMs });
  return {
    registry,
    service,
    dispose() {
      for (const dispose of disposers.reverse()) dispose();
    },
  };
}

module.exports = { MetadataSearchService, createBuiltinMetadataService };
