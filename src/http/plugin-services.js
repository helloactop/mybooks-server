/* ============================================================
 * 宿主级插件服务组装点（Composition Root）
 *
 * 目标：宿主只创建一套 Kernel / Registry / GrantStore / RuntimeManager，
 * 内置元数据 Provider 通过 Kernel 注册并由 CapabilityRouter 调用；
 * 旧 Toolbox 仍然走原安装/启停/调用链路，Legacy Adapter 只提供统一视图。
 *
 * 之所以保留 HTTP 层注入网络实现：core 里的 Provider 只依赖注入的
 * search/lookupIsbn，这里把豆瓣/Open Library 网络层接进来，避免
 * core → http 反向依赖。
 * ============================================================ */

const { PluginKernel } = require('../core/plugins/kernel');
const { createBuiltinMetadataService } = require('../core/plugins/services/metadata');
const { RuntimeManager } = require('../core/plugins/runtime-manager');
const { createLegacyRuntimeAdapter } = require('../core/plugins/adapters/legacy-runtime');
const { runtimeHealth } = require('../core/toolbox/runtime');
const {
  searchDouban,
  lookupIsbnDouban,
  lookupIsbnOpenLibrary,
  searchOpenLibrary,
} = require('./metadata-sources');

// 唯一宿主内核：Registry / EventBus / GrantStore / Lifecycle 都由它持有。
const kernel = new PluginKernel({ logger: console });

const builtin = createBuiltinMetadataService({
  kernel,
  providers: {
    douban: { search: searchDouban, lookupIsbn: lookupIsbnDouban },
    openlibrary: { search: searchOpenLibrary, lookupIsbn: lookupIsbnOpenLibrary },
  },
});

// Runtime Manager 同样由宿主统一持有；内置 Provider 走进程内调用，
// 不强制经过 Runtime RPC（架构图是逻辑依赖，不是进程边界）。
const runtimes = new RuntimeManager();
runtimes.register(createLegacyRuntimeAdapter({ health: runtimeHealth }));

let started = null;

// 内置 Provider 的激活必须显式完成，避免模块导入时产生异步副作用。
function start() {
  if (!started) {
    started = builtin.start().catch((err) => {
      // 启动失败不缓存失败结果：允许宿主下一次调用重试并暴露真实错误。
      started = null;
      throw err;
    });
  }
  return started;
}

const metadata = {
  // 保持原有 metadata.service.search 形状；旧路由无需感知 Kernel 启动。
  service: {
    async search(input, options) {
      await start();
      return builtin.service.search(input, options);
    },
  },
  registry: builtin.registry,
};

async function dispose() {
  await kernel.dispose();
  for (const item of runtimes.list()) {
    try { await runtimes.dispose(item.runtimeId); } catch { /* 关闭阶段不阻断退出 */ }
  }
}

module.exports = { kernel, metadata, runtimes, start, dispose };
