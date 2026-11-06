# My books

个人自部署图书管理系统，提供网页管理后台与配套安卓阅读客户端。单管理员、多设备，默认私有访问。

[部署指南](docs/SELF_HOSTING.md) · [API](docs/API.md) · [同步说明](docs/SYNC_PROTOCOL.md) · [参与贡献](CONTRIBUTING.md)

## 功能

- 书目管理、搜索、标签、自定义字段与阅读统计。
- 电子书上传下载、封面和 Markdown 读书心得。
- CSV 导入导出、重复书合并与回收站恢复。
- 设备登录、安卓书目增量同步、阅读数据同步与版本冲突保护。
- 正文按需下载，支持校验与断点续传。

## 开始使用

克隆本仓库后，在项目目录执行：

```sh
cp .env.example .env
docker compose up -d --build
docker compose exec my-books npm run setup
```

首次配置后访问 `http://localhost:3000/login`。已有 `.env` 时不要覆盖。
Node.js 安装、公网接入、备份和升级见[部署指南](docs/SELF_HOSTING.md)。
阅读数据在安卓设备之间同步；Web 端专注书库管理。

新版 React + Vite 管理面板已接入 `/mybooks/`，使用 `/mybooks/books/all`、`/mybooks/settings` 等规范路径。旧面板已归档到 `archive/legacy-panel/`，旧路径会 308 跳转到新面板。
新版默认进入公开首页，点击书库等其他功能时打开登录弹窗，继续使用已有认证与私有 API。图书展示复用 BookCard（封面、书名、作者、译者），支持搜索、分类/状态/格式/作者/译者/出版社筛选、排序和分页。排序与筛选框复用液态玻璃 FilterSelect，点击图书打开只读详情弹窗；详情与登录共用 ContentDialog 的尺寸、定位和滚动样式。
桌面为固定侧栏，竖屏为可滑动收起的抽屉；书库入口为 `/mybooks/books/all`，旧 `/mybooks/playground/sidebar/*` 地址自动跳转到对应正式功能。独立演示图书页位于 `/mybooks/playground/library`。
“我的分类”展示 App 已同步到服务器的文件夹分类树，点击后按书籍归属筛选，父分类包含其子分类；路径为 `/mybooks/folders/:id`。
源码位于 `web-react/`；开发模式可在 `/mybooks/playground/glass` 查看 `GlassSurface` 组件预览。
`Button` 预览位于 `/mybooks/playground/button`，包含液态材质、加载与表单示例。
`IconButton` 预览位于 `/mybooks/playground/icon-button`，包含纯图标操作、切换和加载示例。
`TextField` 预览位于 `/mybooks/playground/text-field`，包含材质、输入、错误提示、密码与表单示例。
`SegmentedControl` 预览位于 `/mybooks/playground/segmented-control`，包含玻璃滑块、键盘切换与禁用示例。
`GlassDialog` 预览位于 `/mybooks/playground/glass-dialog`，包含玻璃弹窗、编辑表单、长内容与嵌套示例。
`GlassPopover` 预览位于 `/mybooks/playground/glass-popover`，包含按钮旁浮层、筛选表单、自动翻转与弹窗内使用示例。
`Checkbox` 预览位于 `/mybooks/playground/checkbox`，包含批量全选、半选、禁用及原生表单示例。
`Switch` 预览位于 `/mybooks/playground/switch`，包含即时设置、滑块、RTL 和原生表单示例。
`RadioGroup` 预览位于 `/mybooks/playground/radio-group`，包含带说明的单选项、键盘、禁用及表单示例。
`Select` 预览位于 `/mybooks/playground/select`，包含玻璃下拉菜单、分组、键盘、表单校验与重置示例。
`TextArea` 预览位于 `/mybooks/playground/text-area`，包含多行输入、拖动高度、只读/禁用和表单示例。
`Toast` 预览位于 `/mybooks/playground/toast`，包含状态反馈、计时暂停、堆叠队列、附加操作和弹窗示例。
`Tooltip` 预览位于 `/mybooks/playground/tooltip`，包含图标说明、键盘、自动翻转、长文本与嵌套示例。
`DropdownMenu` 预览位于 `/mybooks/playground/dropdown-menu`，包含操作菜单、分隔线、危险/禁用项、键盘和嵌套示例。
`Badge / Chip` 预览位于 `/mybooks/playground/badge`，包含状态、数量、选择/移除标签、禁用、长文本和 RTL 示例。
开发与构建命令见[前端工程说明](docs/FRONTEND.md)。

## 许可证

[GPLv3](LICENSE) · [第三方及上游声明](THIRD_PARTY_NOTICES.md) · [安全报告](SECURITY.md)
