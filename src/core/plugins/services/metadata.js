/* ============================================================
 * 元数据检索服务：把 metadata.search@1 契约交给 Capability Router
 *
 * Router 负责权限、Provider 选择、超时、错误归一；
 * 这里只保留元数据能力的输入/输出契约与内置 Provider 组装。
 * ============================================================ */

const { ServiceRegistry } = require('../registry');
const { CapabilityRouter } = require('../capability-router');
const {
  CAPABILITY,
  VERSION,
  normalizeInput,
  normalizeCandidates,
} = require('../capabilities/metadata-search');
const { createDoubanProvider } = require('../providers/douban');
const { createOpenLibraryProvider } = require('../providers/openlibrary');

class MetadataSearchService {
  constructor({ registry, grants, logger, timeoutMs } = {}) {
    if (!registry) throw new TypeError('MetadataSearchService 需要 Registry');
    this._router = new CapabilityRouter({ registry, grants, logger, timeoutMs });
  }

  async search(input, { providerId, principal } = {}) {
    const result = await this._router.invoke({
      capability: CAPABILITY,
      version: VERSION,
      input,
      providerId,
      principal,
      contract: {
        normalizeInput,
        permission: 'metadata.read',
        normalizeOutput: (raw, context) => normalizeCandidates(raw, context.providerId, context.input.limit),
      },
    });
    return { candidates: result.output, providerId: result.providerId };
  }
}

function createBuiltinMetadataService({ registry = new ServiceRegistry(), providers = {}, grants, logger, timeoutMs } = {}) {
  const disposers = [
    registry.register(createDoubanProvider(providers.douban)),
    registry.register(createOpenLibraryProvider(providers.openlibrary)),
  ];
  const service = new MetadataSearchService({ registry, grants, logger, timeoutMs });
  return {
    registry,
    service,
    dispose() {
      for (const dispose of disposers.reverse()) dispose();
    },
  };
}

module.exports = { MetadataSearchService, createBuiltinMetadataService };
