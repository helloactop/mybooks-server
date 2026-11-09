/* ============================================================
 * 内置插件服务的组装点（HTTP 层注入网络实现）
 *
 * core 里的 Provider 只依赖注入的 search/lookupIsbn；
 * 这里把现有的豆瓣/Open Library 网络层接进来，避免 core → http 反向依赖。
 * 当前只有元数据路由使用；旧 toolbox 链路不变。
 * ============================================================ */

const { createBuiltinMetadataService } = require('../core/plugins/services/metadata');
const {
  searchDouban,
  lookupIsbnDouban,
  lookupIsbnOpenLibrary,
  searchOpenLibrary,
} = require('./metadata-sources');

const builtin = createBuiltinMetadataService({
  providers: {
    douban: { search: searchDouban, lookupIsbn: lookupIsbnDouban },
    openlibrary: { search: searchOpenLibrary, lookupIsbn: lookupIsbnOpenLibrary },
  },
});

module.exports = builtin;
