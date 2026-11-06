# Legacy web panel (archived)

旧版服务端渲染面板的冻结快照，仅用于追溯，不再参与构建、静态托管或 `npm test`。

- `public/`：原 `public/` 页面、样式、脚本、图标与 Service Worker。
- `test/`：原面板的 5 个前端测试。它们在归档目录内仍保留原来的相对路径，可在仓库根目录运行：
  `node --test archive/legacy-panel/test/*.test.js`

当前面板位于 `/mybooks/`，源码在 `web-react/`。
