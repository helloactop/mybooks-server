# React 管理面板工程

新版前端源码位于 `web-react/`，使用 React、Vite 和 TypeScript。已封装 `GlassSurface`、`Button`、`IconButton`、`TextField`、`SegmentedControl`、`GlassDialog`、`GlassPopover`、`ColorPickerDialog`、`Checkbox`、`Switch`、`RadioGroup`、`Select`、`FilterSelect`、`TextArea`、`ToastProvider` / `useToast`、`Tooltip`、`DropdownMenu`、`Badge` 与 `Chip`，
管理首页已加入书库侧栏与只读图书页。书库使用正式路径 `/mybooks/books/all`；旧 `/mybooks/playground/sidebar` 及其子路径自动跳转到对应正式功能，保留有效查询条件，不再载入侧栏演示分类。`/mybooks/playground/library` 预览图书展示，使用独立演示数据和原创 SVG 封面。组件开发预览入口包括 `/mybooks/playground/glass`、
`/mybooks/playground/button`、`/mybooks/playground/icon-button`、`/mybooks/playground/text-field`、`/mybooks/playground/segmented-control`、`/mybooks/playground/glass-dialog`、`/mybooks/playground/glass-popover`、`/mybooks/playground/checkbox`、`/mybooks/playground/switch`、`/mybooks/playground/radio-group`、`/mybooks/playground/select`、`/mybooks/playground/text-area`、`/mybooks/playground/toast`、`/mybooks/playground/tooltip`、`/mybooks/playground/dropdown-menu` 和 `/mybooks/playground/badge`，
仅在 Vite 开发模式提供，生产构建不包含预览页面。
旧面板已归档到 `archive/legacy-panel/`，不再参与构建、静态托管或测试；旧路径由服务器 308 跳转到新面板对应页面。依赖和锁文件统一放在仓库根目录。
站点图标与 Apple 主屏幕图标使用 `web-react/public/app-icon-book-line.png`，原样复用 Android 的 `app/src/main/res/mipmap-nodpi/ic_launcher_book_line.png`（“线稿书”）；入口 HTML 使用 Vite public 资源路径，开发与生产构建自动加上 `/mybooks/` 基路径，所有子页面共用。

## 源码结构

```text
web-react/src/
  design-system/
    tokens/                colors、spacing、typography、radius、shadows、motion
    glass/                 GlassSurface、glass-engine、glass-fallback 及开发预览
    components/            Button、IconButton、TextField、SegmentedControl、GlassDialog、GlassPopover、Checkbox、Switch、RadioGroup、Select、TextArea、Toast、Tooltip、DropdownMenu、Badge、Chip
    index.ts               样式加载与公共组件/类型导出
  shared/api.ts            共用请求、会话失效回跳、结构化错误与分页总数
  features/                library 已接入侧栏与只读图书页；其他业务继续逐步迁移
  layouts/MainLayout.tsx   可选侧栏与竖屏顶栏；组件预览继续使用裸 main
  App.tsx                  应用入口与开发预览分流
```

`features/library/` 已包含 LibraryWorkspace、LibrarySidebar、BookCard、LibraryBooks、只读图书/分类加载、导航状态和竖屏手势；其他业务目录继续预留。

## 开发

使用 Node.js 24（最低 22.12.0），在仓库根目录执行：

```sh
npm ci
npm start
```

另开终端，在同一目录执行：

```sh
npm run dev:admin
```

访问 `http://127.0.0.1:5173/mybooks/`，修改 `web-react/src/main.tsx` 可触发 React 热更新。
开发服务器只监听本机。`/mybooks/` 以外的请求代理到 `http://127.0.0.1:3000`，
包括旧地址跳转和 API。后端使用其他地址时，在启动 Vite 的终端设置
`MYBOOKS_DEV_BACKEND`（PowerShell 示例：`$env:MYBOOKS_DEV_BACKEND='http://127.0.0.1:3002'`）。

新版 `/mybooks/` 默认进入公开首页，只读取已有公开首页接口。点击书库、统计、设置、搜索或图书详情时，游客先打开新版登录弹窗；登录成功后继续原操作。游客不请求私有分类和筛选数据。
登录复用已有认证 API、稳定设备标识和 HttpOnly Cookie，不保存密码或会话令牌。代理保留 Host，以兼容后端的同源校验，不需要开放 CORS。
侧栏底部的头像与昵称来自服务器 `/api/sync/state` 中的 `nickname`、`avatar_uri` 及对应头像资源（兼容历史 `avatar_path`）。仅在真实会话登录后加载，头像通过私有同步接口读取为 Blob，桌面与移动抽屉共用一份资料；重新进入页面时刷新，退出时取消请求并释放头像 URL。资料缺失或图片解码失败时显示默认账户/人物图标，预览不请求个人资料。
设置页通过 `AccountDevicesSetting` 复用 `/api/auth/me`、`/devices` 和 `/logout`，显示已授权设备及登录时间。当前设备置顶且仅提供退出登录；其他设备经确认后撤销授权。加载和操作失败可重试，退出后清空当前页面的私有交互状态并回到公开首页，保留稳定设备标识。
私有业务 API 继续由后端鉴权；新版收到 401 时回到首页并打开新版登录弹窗，不再跳转旧登录页。旧面板已归档，旧页面路径跳转到新面板。
`/mybooks/playground/guest` 使用演示首页验证游客入口；`/mybooks/playground/login` 使用模拟提交验证表单，均仅在开发模式提供。

现有服务不会自动读取 `.env`；自定义存储等配置仍按[部署指南](SELF_HOSTING.md)启动后端。
本地开发不要沿用生产环境的 HTTPS Cookie 配置。

## 设计变量

统一变量位于 `web-react/src/design-system/tokens/`，按颜色、间距、字体、圆角、阴影、动效拆分，
由 `design-system/index.ts` 统一加载，使用 `--ui-` 前缀。
当前提供浅色主题的变量定义，后续组件按语义引用；变量文件本身不渲染组件，
也不设置 body 或旧版页面样式。

| 类别 | 默认规范 | 常用变量 |
| --- | --- | --- |
| 主题色 | `rgb(122, 181, 214)`，浅蓝底搭配深色文字 | `--ui-color-accent`、`--ui-color-on-accent` |
| 圆角 | 面板、控件、弹窗均以 `32px` 为主要圆角 | `--ui-radius-base`、`--ui-radius-surface`、`--ui-radius-control` |
| 文字 | 系统字体，正文 `1rem`（默认 16px），行高 `1.6` | `--ui-font-family`、`--ui-font-size-md`、`--ui-line-height-normal` |
| 背景 | 浅冷灰页面、白色面板、深灰文字 | `--ui-color-canvas`、`--ui-color-surface`、`--ui-color-text` |
| 间距 | 4px 基准，常用 8、12、16、24、32px | `--ui-space-2` 至 `--ui-space-8` |
| 控件与图标 | 常规高度 44px、图标 20px、描边 1.75 | `--ui-control-height-md`、`--ui-icon-size-md`、`--ui-icon-stroke-width` |
| 阴影 | 控件、面板、浮层三级蓝灰色轻阴影 | `--ui-shadow-sm`、`--ui-shadow-md`、`--ui-shadow-lg` |
| 玻璃材质 | 白色半透明底、16px 模糊、140% 饱和度 | `--ui-glass-background`、`--ui-glass-blur`、`--ui-glass-saturation` |
| 动效 | 按下 80ms、悬停 140ms、展开 240ms | `--ui-duration-press`、`--ui-duration-hover`、`--ui-duration-enter` |

正文、说明、弱提示文字分别使用 `--ui-color-text`、`--ui-color-text-secondary`、
`--ui-color-text-muted`；主题色不作为浅色背景上的小字号文字颜色。
链接使用较深的蓝色。组件不添加焦点描边或焦点高亮，预览页采用相同规则。`prefers-reduced-motion: reduce` 下，动效时长、
位移和按下缩放变量会回退为静态值。以后封装组件时需实际引用这些变量。

组件样式引用示例：

```css
.panel {
  padding: var(--ui-space-6);
  color: var(--ui-color-text);
  background: var(--ui-color-surface);
  border-radius: var(--ui-radius-surface);
  box-shadow: var(--ui-shadow-md);
}
```

## 液态玻璃依赖

已锁定安装 [`liquid-glass-react@1.1.1`](https://github.com/rdev/liquid-glass-react)，
发布包要求 React / React DOM 19 及以上，与当前工程版本匹配。
它与其他前端依赖一起放在根目录 `devDependencies`，由 Vite 在使用时打包，
无需增加服务端运行依赖。后续 React 组件可直接导入：

```ts
import LiquidGlass from 'liquid-glass-react';
```

`GlassSurface` 使用该依赖生成装饰效果，不加载旧版玻璃脚本。
上游说明 Safari / Firefox 仅部分支持折射效果；实际页面接入时再验证样式、布局和兼容回退。
MIT 版权与许可全文随 `/mybooks/third-party-notices.txt` 一起分发。

## GlassSurface

```tsx
import { GlassSurface } from './design-system';

<GlassSurface material="liquid" intensity="regular" tone="accent" padding="md">
  <h2>面板标题</h2>
  <p>面板内容</p>
</GlassSurface>
```

| 属性 | 可选值 | 默认值 |
| --- | --- | --- |
| `material` | `liquid` / `frosted` / `solid` | `liquid` |
| `intensity` | `subtle` / `regular` / `strong` | `regular` |
| `tone` | `neutral` / `accent` | `neutral` |
| `padding` | `none` / `sm` / `md` / `lg` | `md`（24px） |
| `elevation` | `none` / `sm` / `md` / `lg` | `md` |
| `motion` | 是否启用指针跟随高光 | `true` |

组件转发外层 div 的 ref、className、style、ARIA 和常规 HTML 属性。
它提供材质容器语义，交互控件的按钮、键盘行为由内部组件承担。
正文只渲染一次，独立于装饰层；装饰层隐藏于辅助技术且不接收指针操作。
圆角通过 CSS 继承 `--ui-radius-surface`（32px），文字、内边距、阴影和材质直接引用设计变量，
不把 CSS 圆角重复硬编码为 JavaScript 数字。

`glass-engine.ts` 负责材质预设、浏览器能力、用户偏好和容器尺寸观察：

- Chromium 且支持背景滤镜时使用液态折射；Safari、Firefox 等回退磨砂。
- 无背景滤镜、减少透明度或强制颜色模式下使用实色。
- 减少动态效果或非精细指针环境中关闭跟随高光；表面本身不位移或缩放。
- 容器宽高变化时仅重建装饰层，保留正文与表单输入。

`glass-fallback.css` 将上游的居中位移、内置阴影和装饰层尺寸限制在组件作用域内适配，
无需引入 Tailwind。默认使用 `standard` 模式。上游升级后应重新验证装饰 DOM 选择器。

开发时访问 `http://127.0.0.1:5173/mybooks/playground/glass`，可比较三种材质、切换折射强度、
改变容器宽度并展开额外内容。开发预览不访问书库数据。

## Button

```tsx
import { Plus } from 'lucide-react';
import { Button } from './design-system';

<Button startIcon={Plus} loading={saving} loadingLabel="保存中…" onClick={save}>
  保存图书
</Button>
```

| 属性 | 可选值 | 默认值 |
| --- | --- | --- |
| `variant` | `primary` / `secondary` / `ghost` / `danger` | `primary` |
| `size` | `sm` / `md` / `lg` | `md`（44px） |
| `material` | `liquid` / `frosted` / `solid` | `liquid` |
| `intensity` | `subtle` / `regular` / `strong` | `regular` |
| `loading` | 加载时显示进度、禁止重复操作 | `false` |
| `loadingLabel` | 可选加载文案，始终预留空间以保持宽度稳定 | 未设置 |
| `startIcon` / `endIcon` | 按需导入的 Lucide 图标组件 | 未设置 |
| `fullWidth` | 撑满容器 | `false` |

Button 使用原生 button，默认 `type="button"`；提交和重置需要显式指定 `type`。
ref、事件、className、style、name、value、form 和 ARIA 等属性传递到同一个原生按钮。
Enter、空格与表单行为由浏览器处理，不添加焦点描边。
`disabled` 或 `loading` 时设置原生 disabled；加载时同时设置 aria-busy，
未提供加载文案时保留原有可访问名称。加载状态由调用方控制，组件不发请求。
图标和装饰层对辅助技术隐藏，按钮应提供可读文字；纯图标操作使用 IconButton。

原生按钮的装饰层使用 `GlassDecoration`（span 与 SVG），复用材质回退策略与折射强度预设，
标准位移图及 RGB 滤镜改编自 `liquid-glass-react@1.1.1`，保留 MIT 许可。
默认 regular 与 subtle 控件使用单次位移折射；strong 保留三通道 RGB 分色。
装饰层通过 memo 复用，减少打开弹窗等父级状态变化时的重复渲染；颜色、模糊、位移强度与玻璃边缘保持设计变量控制。
按钮内部不插入 div 或嵌套交互控件，文字与图标不参与背景折射。
高频纹理背景下折射更明显；预览页提供液态、磨砂、实色对比区域。
小号按钮在精细指针环境为 36px，粗指针环境至少 44px；减少动态效果时停止旋转并取消按压缩放。

开发时访问 `http://127.0.0.1:5173/mybooks/playground/button`，可检查材质、四种外观、
三个尺寸、图标、加载/禁用、整行布局，以及原生表单提交和重置。全部操作只影响预览页状态。

## IconButton

```tsx
import { Search, Bookmark } from 'lucide-react';
import { IconButton } from './design-system';

<IconButton icon={Search} label="搜索图书" onClick={openSearch} />
<IconButton icon={Bookmark} label="切换收藏" aria-pressed={bookmarked} onClick={toggleBookmark} />
```

IconButton 复用 Button 的材质、状态与原生交互，默认 `variant="secondary"`、`size="md"`、
`material="liquid"`。`icon` 和非空 `label` 为必填项；label 用于 aria-label 和默认原生 title。
开发模式下空 label 会明确报错；可用 title 自定义或关闭原生提示。

| 属性 | 规范 |
| --- | --- |
| `icon` | 按需导入的 Lucide 图标组件，图标自身对辅助技术隐藏 |
| `label` | 描述操作用途的非空字符串，加载时也保留该名称 |
| `variant` / `material` / `intensity` | 与 Button 相同；默认次要外观、液态材质 |
| `size` | 精细指针下 36 / 44 / 52px 正方形；粗指针下小号至少 44px |
| `loading` / `disabled` | 与 Button 相同，加载时显示旋转图标并阻止重复操作 |
| `aria-pressed` | 原生受控切换状态；次要和轻量外观有选中颜色 |
| `ref` / `type` / HTML 和 ARIA 属性 | 直接传给同一个原生 button；默认 type="button" |

不接收 children、前后图标、整行布局或可见加载文案，保持纯图标和方形尺寸。
CSS 直接引用 Button 的尺寸、图标和圆角变量，支持减少动态效果，不添加焦点描边。
原生 title 仅提供浏览器提示；额外说明可用 aria-describedby 关联页面内容。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/icon-button`，包含材质对比、
常用操作、尺寸、收藏切换、加载、禁用、ref 聚焦与表单示例，不访问书库数据。

## TextField

```tsx
import { Search } from 'lucide-react';
import { TextField } from './design-system';

<TextField label="搜索图书" startIcon={Search} value={query}
  onChange={(event) => setQuery(event.target.value)} />
<TextField label="密码" type="password" name="password" required autoComplete="current-password" />
```

TextField 使用同一个原生 input，ref 直接指向它。标签必填，自动生成唯一 id；
可显式指定 id。默认 `size="md"`、`type="text"`、`material="liquid"`、`intensity="regular"`。
圆角继承 32px 设计变量，字号保持 16px，文字和图标不参与背景折射。

| 属性 | 规范 |
| --- | --- |
| `label` | 非空字段名称，通过原生 label 关联 input；开发时空名称报错 |
| `description` / `error` | 说明和错误文本，自动合并调用方的 aria-describedby；error 同时设置 aria-invalid |
| `size` | sm / md / lg，对应 36 / 44 / 52px；粗指针输入区域至少 44px |
| `type` | text / search / email / url / tel / password / number |
| `startIcon` | 可选 Lucide 图标，对辅助技术隐藏 |
| `material` / `intensity` | 复用玻璃装饰层、折射预设与环境回退策略 |
| `passwordToggle` | 默认 true，仅密码类型显示 IconButton，用于显示/隐藏输入；不提交表单 |
| `className` / `style` | 应用于外层字段容器；inputClassName 用于原生 input |
| 其余原生属性和事件 | 传给 input，包括 name、value、defaultValue、onChange、required、disabled、readOnly、autoComplete、form、ARIA |

支持受控和非受控使用，校验及业务状态由调用方负责，不发请求。
required、email、minLength 等约束由浏览器执行；error 用于呈现业务错误，不设置原生 customValidity。
只读输入可聚焦、复制并提交，禁用输入不可编辑且不提交。
密码按钮切换 type，输入内容与 ref 保留。组件不在切换时自动移动焦点，支持键盘访问。
错误边框、禁用/只读背景与减少动态效果均使用共享设计变量；获得焦点时不改变边框或增加外圈。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/text-field`，包含三种材质、尺寸、
受控/非受控输入、说明与动态错误、ref 聚焦、密码切换和原生表单验证/重置。
预览只使用本页状态，不访问书库；生产构建不包含该页面。

## SegmentedControl

```tsx
import { SegmentedControl } from './design-system';

<SegmentedControl label="阅读状态" value={status} onValueChange={setStatus}
  options={[
    { value: 'unread', label: '未读' },
    { value: 'reading', label: '在读' },
    { value: 'read', label: '已读' },
  ]} />
```

用于少量互斥选项，例如阅读筛选、排序或视图选择。使用 radiogroup / radio 语义，
选中项由品牌蓝滑块呈现；它不包含 tabpanel，也不负责加载业务内容。
默认 `size="md"`、`material="liquid"`、`intensity="regular"`，圆角继承 32px。
滑块和轨道复用 GlassDecoration 与环境回退；文字和图标保持独立，不参与折射。

| 属性 | 规范 |
| --- | --- |
| `label` | 必填的非空分组名称，用于 aria-label |
| `options` | 只读数组；每项 value 唯一，label 非空，可附加 Lucide icon 和 disabled |
| `value` / `onValueChange` | 受控值与变更回调；再次选择当前项不触发回调 |
| `defaultValue` | 非受控初始值；未提供时选择第一个可用项 |
| `size` | sm / md / lg；精细指针下默认单行整体高度 36 / 44 / 52px |
| `disabled` | 禁用整组；也可仅禁用单个选项 |
| `fullWidth` | 默认 false；true 时占满容器，各项等宽 |
| `material` / `intensity` | 液态 / 磨砂 / 实色，以及三档折射强度 |
| `ref` / `className` / `style` / div 属性 | 用于外层 radiogroup；ref 可定位当前 `[tabindex="0"]` 选项 |

Tab 只进入一个可用项；方向键移动并选择，首尾循环、跳过禁用项。
Home / End 选择首尾可用项，Enter / 空格执行按钮选择。支持继承的 RTL 方向。
按用户要求不显示焦点描边；原生 disabled 与键盘操作保留。
选项始终为 type="button"，不会提交表单，也不自动生成表单字段；业务值由调用方保存。

滑块通过 ResizeObserver 适配容器、选项尺寸和窗口变化；切换采用共享 240ms 动效，
减少动态效果时取消过渡。触控环境每项至少 44px 高，整体会随内边距增高。
长文字允许换行。选项变化时保留当前值；若当前值不存在，隐藏滑块并让第一个可用项可通过 Tab 进入，
由调用方决定新的业务选择，不静默触发回调。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/segmented-control`，包含材质对比、
受控/非受控切换、外部赋值、图标、尺寸、禁用、键盘、RTL 和表单内视图切换。
全部只影响本页状态，生产构建不包含该页面。

## GlassDialog

```tsx
import { Button, GlassDialog } from './design-system';

<Button onClick={() => setOpen(true)}>打开弹窗</Button>
<GlassDialog open={open} onOpenChange={setOpen} title="编辑图书"
  description="填写图书信息。"
  footer={<Button onClick={() => setOpen(false)}>完成</Button>}>
  {/* 表单或其他业务内容 */}
</GlassDialog>
```

受控模态弹窗，始终渲染在 document.body 的 Portal 中，使用原生 dialog.showModal() 进入浏览器顶层。
标题通过 aria-labelledby 关联，描述存在时通过 aria-describedby 关联。
GlassSurface 提供面板材质与环境回退，IconButton 提供右上角关闭操作。
圆角 32px，不添加焦点描边；组件不发请求，也不访问书库。

| 属性 | 规范 |
| --- | --- |
| `open` / `onOpenChange` | 必填的受控开关；关闭请求回调 `(false, reason)`，父组件决定是否更新 open |
| `title` / `description` | 必填非空标题；可选简短描述 |
| `children` / `footer` | 正文与可选操作区；操作区支持换行 |
| `size` | sm / md / lg，最大宽度 400 / 560 / 800px；默认 md，实际宽度受视口约束 |
| `material` / `intensity` | 默认 liquid / regular，复用 GlassSurface 的三种材质及强度 |
| `closeOnEscape` / `closeOnBackdrop` | 默认 true，可分别关闭 Esc 或遮罩关闭 |
| `showCloseButton` / `closeLabel` | 默认显示关闭按钮，默认名称“关闭弹窗” |
| `initialFocusRef` | 可指定弹窗内部的初始焦点；否则由浏览器选择初始控件 |
| `ref` / `className` / `style` / dialog 属性 | 用于原生 dialog 根节点；不允许覆盖组件管理的 open 和关闭事件 |

关闭原因是 escape、backdrop、close-button 或 native。底部按钮通常由父组件直接设置 open=false，
这种主动关闭不额外触发 onOpenChange。原生 method="dialog" 表单或 ref.close() 关闭时，
组件以 native 原因通知父组件同步状态。应保持组件挂载并切换 open，以完成退出动效并保留表单状态。

默认入场 240ms、退出 160ms；面板只做位移动效，遮罩独立淡入淡出，不对玻璃容器整体做透明度动画，避免内部控件背景采样变黑。
退出期间保持模态与滚动锁，结束后调用原生 close()。
快速重新打开会取消待完成的关闭；减少动态效果时立即退出。卸载会释放页面滚动锁。
滚动锁为多层弹窗计数，最后一层关闭后恢复 html/body 原有 overflow、scrollbar-gutter 和 body 右侧内边距。
设计系统的 base.css 从首屏使用 scrollbar-gutter: stable 保留滚动条占位，打开时先锁滚动再显示弹窗，避免背景宽度变化。
旧浏览器回退使用实际浮点宽度差补偿，不使用整数 innerWidth/clientWidth 相减。
共享玻璃环境检测只初始化一次，各组件共用四组媒体查询监听；同尺寸关闭/重开保留上次有效玻璃尺寸与滤镜实例。
隐藏期间调整窗口或真正改变容器尺寸时才刷新滤镜，正文和表单不重建。

原生模态机制隔离背景交互；组件补充 Tab / Shift+Tab 的首尾循环。
关闭后由浏览器将焦点还给打开弹窗的元素。正文可聚焦，支持键盘滚动；
初始焦点引用必须指向弹窗内可聚焦元素。禁用 Esc、遮罩和关闭按钮时，调用方仍须提供可用的离开按钮。
遮罩关闭要求按下、松开均位于面板外，避免从正文拖出时误关闭。

高度不超过视口减去上下各 16px，中间正文独立滚动，隐藏正文滚动条，保留滚轮、触控和键盘滚动；标题和操作区保持可见。
表单位于正文、提交按钮位于 footer 时，使用原生 form 属性关联：

```tsx
<GlassDialog open={open} onOpenChange={setOpen} title="编辑图书"
  footer={<Button type="submit" form="book-edit-form">保存</Button>}>
  <form id="book-edit-form" onSubmit={handleSubmit}>{/* 输入字段 */}</form>
</GlassDialog>
```

开发预览为 `http://127.0.0.1:5173/mybooks/playground/glass-dialog`，包含材质/尺寸切换、
表单与初始焦点、长内容滚动、关闭控制和嵌套弹窗；生产构建不包含该页面。

## GlassPopover

```tsx
import { Button, GlassPopover } from './design-system';

<GlassPopover label="图书操作" size="sm"
  trigger={(triggerProps) => <Button {...triggerProps}>更多操作</Button>}>
  {({ close }) => <Button onClick={() => { performAction(); close(); }}>执行操作</Button>}
</GlassPopover>
```

按钮旁的非模态内容浮层，使用原生 popover="auto" 进入顶层，保持触发器与浮层在同一 DOM 上下文中。
它可以越过祖先容器的 overflow 裁切，也可放在 GlassDialog 内。
role="dialog"、必填 label 和触发器的 aria-haspopup / aria-controls / aria-expanded 关联浮层。
可放置普通操作按钮、筛选控件或小型表单；不自动赋予 menu / menuitem 语义或菜单方向键行为。

| 属性 | 规范 |
| --- | --- |
| `label` | 必填非空可访问名称 |
| `trigger` | 渲染函数，返回 Button / IconButton 或原生 button，完整传入 triggerProps |
| `children` | 普通内容，或接收 `{ close }` 的渲染函数，方便操作后关闭 |
| `open` / `onOpenChange` | 可选受控状态与变更回调，回调 `(next, reason)` |
| `defaultOpen` | 非受控初始状态，默认 false |
| `size` | sm / md / lg，对应 240 / 320 / 400px，默认 md，宽度受视口约束 |
| `side` / `align` | 默认 bottom / start；top 或 bottom，start / center / end，支持 RTL 对齐 |
| `gap` / `viewportPadding` | 默认 8 / 12px，非负有限数；分别表示按钮间距与视口边距 |
| `material` / `intensity` | 默认 liquid / regular，复用 GlassSurface 材质、强度和环境回退 |
| `initialFocusRef` | 可选的浮层内初始焦点；默认第一个可用控件，无控件时聚焦正文滚动区 |
| `ref` / `className` / `style` / div 属性 | 传给浮层根 div，ref 支持原生 showPopover / hidePopover；位置与尺寸约束由组件管理 |

触发器必须保留 ref、type="button"、popoverTarget、popoverTargetAction 和 ARIA 属性。
triggerProps.onClick 记录触发原因；需要附加事件时调用它后再处理自己的逻辑。
触发器本身的 disabled / loading 沿用 Button / IconButton 的原生禁用行为。

Enter / 空格通过原生按钮打开或切换，Esc 关闭；焦点位于浮层内时，Esc 或内容操作关闭后回到触发按钮。
点击外部会关闭浮层，Tab 可继续访问其他页面控件，浮层保持非模态，不锁定页面滚动。
打开其他不相关的 auto popover 时，浏览器会关闭原浮层。
这些原生顶层、轻关闭与触发器关联行为参考 [MDN Popover API](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover)。
在 GlassDialog 中，Esc 优先关闭最上层浮层，父弹窗继续保持打开。

回调原因包括 trigger、escape、outside、action、anchor-hidden 和 native。
父组件直接更新受控 open 时不额外发出回调；原生开关事件会同步内部状态。
使用支持 Popover API 的现代浏览器；未引入新的第三方依赖。

定位优先使用 side 指定的一侧，空间不足且另一侧更宽裕时翻转，横向始终避开视口边缘。
内容过长时按可用高度滚动，隐藏滚动条，保留滚轮、触控和键盘操作；正文滚动区可通过 Tab 聚焦。
ResizeObserver 监测按钮、面板和自然内容尺寸；页面/祖先滚动、视口或视觉视口变化时更新位置。
IntersectionObserver 在触发器完全移出可见区域后关闭浮层。

入场/退出使用共享动效变量，仅移动面板，保持整体 opacity=1，避免子控件的玻璃采样在动画期间变黑；CSS display / overlay 离散过渡维持退出画面。
减少动态效果时取消过渡。关闭阶段的内容设为 inert，避免键盘进入退出中的控件。
沿用 32px 圆角、不添加焦点描边；浮层内容保留在 DOM 中，关闭不会重置表单值。
在现有 form 内使用时，遵循原生 HTML 规则，避免在浮层内容中再嵌套 form。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/glass-popover`，包括三种材质、
受控排序、筛选表单、长列表、滚动容器、禁用触发按钮和 GlassDialog 内的浮层。
全部只更新本页状态，生产构建不包含预览页面。

GlassPopover 还提供 popupRole（dialog / listbox / menu）、focusMode（content / trigger）、
matchTriggerWidth 与 maxHeight，供 Select 等复合控件复用定位和顶层浮层。
默认行为仍为 dialog、聚焦内容、不匹配入口宽度且不额外限高；trigger 模式保留入口焦点。

## Checkbox

```tsx
import { Checkbox } from './design-system';

<Checkbox label="选择图书" checked={selected} onCheckedChange={setSelected} />
<Checkbox label="导出封面" name="export" value="covers" defaultChecked />
<Checkbox label="全选" checked={allSelected} indeterminate={someSelected} onCheckedChange={toggleAll} />
```

原生 input type="checkbox"，支持受控 checked 与非受控 defaultChecked。
默认 md / liquid / subtle；沿用共享单次位移折射、环境回退和 memo 装饰层。
方框圆角取主圆角 32px 的四分之一，即默认 8px；点击行至少 44px 高。
标签和图标不参与折射，不添加焦点描边，也不对玻璃层做透明度/缩放动画。

| 属性 | 规范 |
| --- | --- |
| `label` | 必填非空名称，通过原生 label 关联 input；点击文字也可切换 |
| `checked` / `defaultChecked` | 原生受控值 / 非受控默认值 |
| `onCheckedChange` / `onChange` | 可选布尔值回调 / 原生事件；两者均可使用 |
| `indeterminate` | 设置原生半选标记，显示横线；不改变 checked 或表单提交值 |
| `description` / `error` | 自动合并调用方的 aria-describedby；error 设置 aria-invalid 和错误边框 |
| `size` | sm / md / lg，方框 20 / 24 / 28px，文字 14 / 16 / 18px |
| `material` / `intensity` | 三种材质及三档折射强度，默认液态、subtle 轻量折射 |
| `className` / `style` / `inputClassName` | 前两项用于外层字段容器，后者用于原生 input |
| `ref` / 其他 input 属性 | ref 直接指向 input；支持 id、name、value、form、disabled、required、ARIA 和原生事件 |

半选通过 input.indeterminate 表达，辅助技术读取原生混合状态。
浏览器在用户切换时清除半选标记；批量选择场景应由父组件根据选择集合计算 checked 与 indeterminate。
勾选与标记外观直接使用 :checked / :indeterminate，非受控点击不需要额外 React 状态。
disabled 及父 fieldset 的原生禁用行为保留，禁用时不绘制玻璃装饰。
不提供只读开关；checkbox 的原生 readOnly 不负责阻止切换，需要阻止交互时使用 disabled。

Tab 访问、空格切换、required 验证由浏览器处理。
只提交勾选且未禁用的字段；重置恢复非受控 defaultChecked。
受控选择集合在表单重置时由父组件重置，半选状态也应随集合更新。
业务错误文字只负责展示，不调用 setCustomValidity 或自行保存数据。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/checkbox`，包含材质、全选/半选、
禁用/错误、三个尺寸、长标签、原生表单提交与重置、ref 聚焦和键盘操作。
演示数据仅在本页状态中，生产构建不包含该页面。

## Switch

```tsx
import { Switch } from './design-system';

<Switch label="显示阅读进度" checked={showProgress} onCheckedChange={setShowProgress} />
<Switch label="紧凑视图" name="compact" value="enabled" defaultChecked />
```

用于开启/关闭一项设置，底层为原生 input type="checkbox" role="switch"，
辅助技术读取布尔开关状态。只支持开启/关闭，不提供半选。
默认 md / liquid / subtle，胶囊轨道和实色圆形滑块使用共享变量与轻量单次折射。
仅滑块移动，轨道不做整体透明度或缩放动画，不添加焦点描边。

| 属性 | 规范 |
| --- | --- |
| `label` | 必填非空、稳定的设置名称；原生 label 关联 input，点击文字或整行可切换 |
| `checked` / `defaultChecked` | 原生受控状态 / 非受控初始状态 |
| `onCheckedChange` / `onChange` | 布尔值回调 / 原生事件；两者均可使用 |
| `description` / `error` | 合并调用方的 aria-describedby；error 设置 aria-invalid 与错误边框 |
| `size` | sm / md / lg，轨道 40×24 / 48×28 / 56×32px；整行点击区域至少 44px 高 |
| `labelPosition` | 默认 start，标签在轨道前；end 时标签在轨道后，说明同步对齐 |
| `material` / `intensity` | 液态 / 磨砂 / 实色及三档强度，默认 liquid / subtle |
| `className` / `style` / `inputClassName` | 前两项用于外层，后者用于原生 input |
| `ref` / 其他 input 属性 | ref 直接指向 input；支持 id、name、value、form、disabled、required、ARIA 和原生事件 |

Tab 访问、空格切换及 form 提交/重置均沿用原生行为。
只提交开启且未禁用的字段，required 验证由浏览器执行；重置恢复非受控 defaultChecked。
受控值需要在父组件处理表单重置。disabled 及父 fieldset 的原生禁用语义保留，禁用时不绘制玻璃装饰。
不提供 readOnly；需要阻止交互时使用 disabled。

RTL 使用逻辑布局与反向滑块位移，开启时滑块移向行尾。
滑块使用 140ms transform 过渡，尺寸与轨道不变；减少动态效果时取消过渡。
关闭/开启外观直接由 :checked 驱动，非受控切换无需额外 React 状态，玻璃装饰复用 memo 与共享能力检测。
组件不请求服务器；异步保存和保存期间的交互限制由业务调用方处理。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/switch`，包含材质、受控设置、外部赋值、
禁用/错误、三种尺寸、标签位置、长标签、表单、原生事件/布尔回调、ref 聚焦及 RTL。
演示进度区域保留占位，切换时避免改变卡片高度；所有设置只保存在本页，生产构建不包含预览页面。

## RadioGroup

```tsx
import { RadioGroup } from './design-system';

<RadioGroup name="sort" label="排序方式" value={sort} onValueChange={setSort}
  options={[
    { value: 'recent', label: '最近更新', description: '按最近修改时间排列。' },
    { value: 'title', label: '书名' },
  ]} />
```

原生 fieldset / legend 和同名 input type="radio"，外层使用 radiogroup 语义。
name 与 label 为必填非空字符串，name 传给组内所有输入；不同独立单选组应使用不同 name。
每项 value 唯一、label 非空，可提供 description 和 disabled。
默认 md / vertical / liquid / subtle，圆形控件使用共享轻量玻璃与 memo 装饰层。

| 属性 | 规范 |
| --- | --- |
| `name` / `label` / `options` | 原生组名、分组标题及只读选项数组 |
| `value` / `onValueChange` | 受控值与变更回调；value=null 表示受控未选择，重复选择当前项不触发变更 |
| `defaultValue` | 非受控初始选择；未提供时不自动选择首项 |
| `description` / `error` | 分组说明与错误；合并调用方 aria-describedby，error 同时标记组和输入 aria-invalid |
| `required` / `disabled` | 原生组必选 / 整组禁用，选项也可单独禁用 |
| `size` | sm / md / lg，圆形标记 20 / 24 / 28px，点击行至少 44px 高 |
| `orientation` | 默认 vertical；horizontal 时横向排列并自动换行 |
| `material` / `intensity` | 默认 liquid / subtle，共享三种材质和折射强度 |
| `form` | 同时传给 fieldset 和组内 input，可在 form 外参与指定表单的提交与重置 |
| `ref` / 其余 fieldset 属性 | ref 指向原生 fieldset；可通过它定位当前 input:checked，onChange 接收冒泡的原生变更事件 |

Tab、方向键、空格、互斥选择和跳过禁用项均由浏览器处理，不添加自定义按键拦截或焦点描边。
选项标题通过 aria-labelledby 命名，说明独立通过 aria-describedby 关联；点击说明也可选择。
分组标题始终由原生 legend 呈现，长标签和横向选项允许换行。

只提交当前选中且未禁用的输入；required 由浏览器校验。
重置恢复非受控 defaultValue，受控值则由父组件处理重置；保持受控/非受控模式一致。
受控未选择时使用 null，不将 undefined 用于清空受控值。
disabled 通过 fieldset 生效，禁用控件不绘制玻璃装饰；只读和半选不属于此组件 API。

选中标记由原生 :checked 驱动，控件尺寸、滤镜实例保持稳定，轨道不做整体透明度或缩放动画。
组件只通知调用方选择变化，不请求服务或保存业务设置。
开发预览为 `http://127.0.0.1:5173/mybooks/playground/radio-group`，包含材质、受控清空、
外部赋值、选项说明、禁用、键盘、尺寸/横向排列，以及原生表单和表单外字段。
演示状态只保留在本页，生产构建不包含该页面。

## Select

```tsx
import { Select } from './design-system';

<Select label="分类" name="category" value={category} onValueChange={setCategory}
  placeholder="请选择分类" options={[
    { label: '文学', options: [{ value: 'fiction', label: '小说' }, { value: 'poetry', label: '诗歌' }] },
    { value: 'history', label: '历史' },
  ]} />
```

入口与下拉列表均为定制玻璃样式；列表复用 GlassPopover 的顶层弹出、定位、自动翻转和外部关闭。
列表宽度跟随入口，最高 320px，支持分组、选中勾选标记、主题色底、禁用项和无滚动条滚动。
浮层在触发器附近保留 DOM，能用于 GlassDialog 内部，不增加页面滚动锁。

| 属性 | 说明 |
| --- | --- |
| `label` / `options` | 必填标题与选项；选项为 value、label、disabled，分组为 label、options、disabled |
| `value` / `onValueChange` | 受控值及用户确认回调；空字符串清空，不以 undefined 切换模式 |
| `defaultValue` | 非受控初始值，默认空值；表单重置恢复默认选择 |
| `placeholder` | 默认“请选择”；空字符串保留给此项，非必填时可选择它来清空 |
| `description` / `error` | 合并外部 aria-describedby，并关联可见入口；错误设置 aria-invalid |
| `required` / `disabled` | 原生必填与禁用；支持单项、分组及父 fieldset 禁用 |
| `size` | sm / md / lg，高度 36 / 44 / 52px；触屏入口至少 44px，文字均为 16px |
| `material` / `intensity` | 默认 liquid / subtle；入口和列表共同支持 frosted、solid 与共享材质降级 |
| `name` / `form` | 保留真实 select 参与 FormData、校验和 reset；支持表单外关联字段 |
| `className` / `style` | 用于外层布局；triggerClassName 用于入口，selectClassName 用于表单 select |
| `ref` / `onChange` | ref 仍指向 HTMLSelectElement，调用 focus() 转到可见入口；确认选择时派发 change，onChange 接收原生选择变更事件 |

选项 value 必须非空且全局唯一，选项、分组和组件标题均不能为空，分组标题必须唯一。
开发模式检查这些约束。受控值暂时不在 options 中时显示占位提示，不修改调用方状态，
不触发回调；该状态的提交值为空，required 可阻止提交。异步选项使用受控模式并保持数组不可变。

可见入口使用 combobox，菜单使用 listbox / group / option 与 aria-activedescendant。
方向键展开或浏览可选项，Home/End 定位首尾，输入前缀定位匹配项；回车/空格确认，Esc 取消，Tab 关闭并离开。
浏览不会立即改变已选值，禁用项会被跳过；鼠标或触屏点击可直接确认。
列表打开后滚动到当前活动项，Esc 在弹窗内优先关闭菜单，不关闭宿主弹窗；不添加焦点描边。

表单 select 不进入 Tab 顺序或无障碍树，也不打开系统菜单。原生必填校验失败时转到可见入口并展开选择。
只提交未禁用的有名字段；非受控 reset 恢复 defaultValue，受控 reset 由调用方更新 value。
未确认或重复确认同一项不触发变更事件。原生 select 事件属性继续作用于表单节点，键盘交互由可见入口负责。

主要圆角为 32px，选项内圆角为 16px；长选项允许换行，入口文字截断，箭头和内边距支持 RTL。
玻璃装饰使用共享环境缓存，默认轻量折射，禁用入口隐藏装饰；列表只有位移动画，不做整体透明度动画。
此组件不保存设置或请求业务接口。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/select`，包括三种材质、受控赋值/清空、
无匹配值、分组与禁用、长文本/长列表、原生校验/reset、表单外字段、键盘/ref、字母查找、RTL 和弹窗嵌套。
演示仅更新本页状态，生产构建不包含该页面。

## TextArea

```tsx
import { TextArea } from './design-system';

<TextArea label="读书心得" name="notes" value={notes} onValueChange={setNotes}
  rows={4} maxLength={2000} placeholder="记录阅读时的想法……" />
```

| 属性 | 说明 |
| --- | --- |
| `label` | 必填且非空的字段标题，关联原生 textarea |
| `description` / `error` | 说明与错误，与外部 aria-describedby 合并；错误同时设置 aria-invalid |
| `value` / `defaultValue` | 原生受控值 / 非受控初始值；受控清空使用空字符串 |
| `onChange` / `onValueChange` | 原生变更事件 / 当前完整字符串，不处理或改写输入内容 |
| `rows` | 默认 4，必须为正整数；决定初始可见行数 |
| `resize` | 默认 vertical，桌面浏览器可纵向拖动；none 禁止拖动，长内容仍可滚动 |
| `material` / `intensity` | 默认 liquid / subtle；共享材质和降级 |
| `disabled` / `readOnly` / `required` | 原生禁用、只读与必填校验；支持父 fieldset 禁用 |
| `name` / `form` / `maxLength` 等 | 直接传给原生 textarea，保留提交、外部表单、重置、输入法与粘贴行为 |
| `className` / `style` / `textAreaClassName` | 前两者作用于外层，textAreaClassName 作用于 textarea |
| `ref` | 原生 HTMLTextAreaElement，支持聚焦和文本选择 |

文字 16px，采用正文行高、16px 内边距、32px 圆角；不添加焦点描边。
输入框不随每次输入自动测量高度，也不替换节点，玻璃装饰记忆渲染，避免影响输入法、光标和连续输入。
只读文字可复制并提交，禁用字段不提交且不绘制玻璃装饰。非受控 reset 恢复 defaultValue，受控 reset 由父组件更新。
maxlength 遵循浏览器按 UTF-16 代码单元计数的语义，不将其当作中文字数或可见字符数。

预览为 `http://127.0.0.1:5173/mybooks/playground/text-area`，包含三种材质、多行受控输入、长度限制、
说明与错误、只读/禁用、行数、拖动开关、RTL、必填校验、表单外字段和 reset；仅在开发模式提供。

## Toast

```tsx
import { ToastProvider, useToast } from './design-system';

function SaveButton() {
  const { toast } = useToast();
  return <button onClick={() => toast({ title: '保存成功', variant: 'success' })}>演示提示</button>;
}

// 在需要通知的应用根部挂载一次，不要在每个按钮旁重复挂载。
<ToastProvider><SaveButton /></ToastProvider>
```

| API | 说明 |
| --- | --- |
| `toast(options)` | 创建提示并返回 id；相同 id 完整替换原提示并重新计时 |
| `dismiss(id)` | 关闭指定提示；已关闭或不存在的 id 不影响其他提示 |
| `dismissAll()` | 清空等待队列并关闭所有可见提示 |
| `title` / `description` | 必填非空标题与可选说明；按纯文本渲染，说明保留换行 |
| `variant` | success / error / warning / info，默认 info |
| `duration` | 毫秒；默认 5000，0 为手动关闭；error 和带 action 的提示默认 0 |
| `action` | label 与 onClick，点击执行回调后关闭；异步操作和错误处理由调用方负责 |
| Provider `maxVisible` | 同时可见 1–5 条，默认 3，其余先进先出排队 |
| Provider `material` / `intensity` | 默认 liquid / subtle，支持三种材质与环境降级 |
| Provider `label` | 通知区域的可访问名称，默认“通知” |

通知位于右下角，窄屏时占据可用宽度，保留 16px 边距、安全区和可视视口键盘避让。
玻璃卡片采用 32px 圆角和共享设计变量，图标及文字区分语义，不仅依赖颜色。
每条卡片使用一个轻量折射装饰，最多渲染 maxVisible 条；不锁页面滚动，不主动抢焦点，
不做整体透明度或缩放动画。减少动态效果时关闭入场和退场位移。

计时只在提示实际进入可见队列后开始；鼠标/笔悬停、提示内键盘聚焦或页面不可见时暂停，
恢复时继续剩余时长。触屏指针进入不导致永久悬停暂停。更新相同 id 会重置时长；等待中的提示不计时。
默认错误和附加操作提示持续保留，避免在用户阅读或处理前消失。

成功/信息/提醒通过持久的 polite status 区域播报，错误通过 alert 播报；等待队列不提前播报。
提示内按钮保持正常 Tab 行为，没有焦点描边；焦点在提示中时按 Esc 只关闭当前提示。
通过关闭按钮或 Esc 关闭时，若原触发元素仍可用，焦点返回该元素；其他位置按 Esc 不清空通知。

通知通过手动 popover 进入浏览器顶层，不关闭已有 auto popover。
存在原生模态 dialog 时，通知宿主移到当前弹窗，保留交互能力；弹窗关闭后回到页面。
计时状态保留在 Provider，宿主变化不会重新开始倒计时；卸载时清理计时器和监听器。
Toast 只显示调用方提供的结果，不执行保存、删除、网络请求或其他业务操作。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/toast`，包含四种语义、短时/手动关闭、
计时暂停、五条队列、相同 id 替换、按 id 关闭、清空、撤销演示、长文本及弹窗内操作。
仅在开发模式提供；生产入口仍保持空白。

## Tooltip

```tsx
import { Tooltip, IconButton } from './design-system';
import { Heart } from 'lucide-react';

<Tooltip content="把这本书加入收藏"
  trigger={(props) => <IconButton {...props} icon={Heart} label="收藏图书" onClick={toggleFavorite} />} />
```

| 属性 | 说明 |
| --- | --- |
| `content` | 必填的非空纯文本；保留换行，不接收交互内容 |
| `trigger` | 渲染一个原生按钮或转发 ref/事件的 Button、IconButton；必须转发回调提供的属性 |
| `side` / `align` | top / bottom，默认 top；start / center / end，默认 center；支持 RTL |
| `openDelay` / `closeDelay` | 鼠标/笔悬停延迟默认 400ms，离开延迟默认 120ms；均须非负有限数 |
| `disabled` | 关闭提示及其说明关联，保留调用方的外部 aria-describedby |
| `aria-describedby` | 与提示 id 去重合并后传给触发按钮 |
| `material` / `intensity` | 默认 liquid / subtle；共享三种材质与环境降级 |
| `onOpenChange` | 实际显示/关闭状态通知，不提供受控开关 |
| `id` / `ref` / `className` / `style` | 作用于提示面板；ref 指向 HTMLDivElement |

触发器保持原有可访问名称，提示使用 role=tooltip，并通过 aria-describedby 补充说明。
回调同时提供空 title，以覆盖 IconButton 默认原生提示，避免出现两套 Tooltip。
提示默认不提交表单（回调提供 type=button）。不要覆盖 ref、aria-describedby 或事件属性；
需要附加同名事件时，先调用 props 中的原处理器，再执行自己的逻辑。onClick 可直接保留业务操作。

键盘聚焦立即显示并保留焦点；Tab 正常移动，不进入提示；Esc 关闭提示，保持原焦点。
回车/空格和指针按下会关闭当前提示，不阻止按钮自身激活；关闭后到重新进入/聚焦前不会反复出现。
触屏按下不触发悬浮提示，按钮的名称和实际操作始终独立可用；不要把必要信息只放在 Tooltip 中。
原生 disabled 按钮不会强行变成可聚焦或可操作，提示也不为其增加额外 Tab 目标。

鼠标可从按钮跨过间隔移入提示，并在文字上停留或选择复制；指针和焦点均离开后再关闭。
整个应用最多显示一条 Tooltip，不需要 Provider。提示为非交互纯文本，需要按钮、链接或表单时使用 GlassPopover。

提示通过手动 popover 进入顶层，DOM 保留在按钮附近，能越过滚动容器裁切，并用于 GlassDialog / GlassPopover 内。
复用浮层定位算法，优先指定方向，空间不足自动翻转并限制在可视视口内；滚动/缩放时按帧合并定位，
按钮被裁切或离开可视区域时关闭。监听器和观察器只在展开时启用，卸载时清理延迟任务。

外框采用 32px 圆角，说明文字 14px，默认仅一个轻量折射装饰，不跟随指针重复采样。
只做轻微入场位移，无整体透明度动画；减少动态效果时关闭位移，不添加焦点描边或滚动锁。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/tooltip`，包含三种材质、键盘与原按钮操作、
禁用切换、长文本、上下方向、RTL、滚动容器、弹窗与浮层嵌套；仅在开发模式提供。

## DropdownMenu

```tsx
import { DropdownMenu, IconButton } from './design-system';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

<DropdownMenu label="图书操作" items={[
  { id: 'edit', label: '编辑资料', icon: Pencil, onSelect: openEditor },
  { type: 'separator', id: 'danger-section' },
  { id: 'delete', label: '移至回收站', icon: Trash2, danger: true, onSelect: openDeleteConfirmation },
]} trigger={(props) => <IconButton {...props} icon={MoreHorizontal} label="更多图书操作" />} />
```

| 属性 | 说明 |
| --- | --- |
| `label` / `items` | 必填菜单名称与有序条目；所有条目 id 必须非空且唯一 |
| 操作条目 | id、非空 label、onSelect；可选 icon、description、disabled、danger |
| 分隔线条目 | type=separator 与独立 id，不进入键盘导航 |
| `trigger` | 渲染并完整转发回调属性的原生 button、Button 或 IconButton |
| `open` / `defaultOpen` / `onOpenChange` | 受控 / 非受控开关和原因通知，与 GlassPopover 一致 |
| `disabled` | 禁用入口并隐藏菜单；非受控开关同时重置，受控值由调用方维护 |
| `size` / `maxHeight` | sm / md / lg，默认 sm（240px）；默认最高 320px |
| `side` / `align` / `gap` / `viewportPadding` | 复用浮层定位，默认 bottom / start / 8px / 12px |
| `material` / `intensity` | 默认 liquid / subtle；复用 GlassPopover 材质与降级 |
| `id` / `className` / `style` / `dir` / `ref` | 作用于菜单面板；ref 为原生 HTMLDivElement |

入口使用 aria-haspopup=menu、aria-expanded 和 aria-controls，面板为 menu，操作项为 menuitem。
说明通过 aria-describedby 关联；分隔线使用 separator，禁用项为原生 disabled 按钮。
每项 type=button，菜单触发器也默认 type=button，放在 form 内不会误提交。
trigger 的 ref 是回调函数；合并自己的 ref 时调用 props.ref(node)。同名事件需要保留原处理器。

回车、空格、指针点击和下方向键打开菜单并聚焦首个可用项，上方向键打开末项。
菜单内上下方向键循环并跳过禁用项，Home/End 定位首尾，输入前缀查找条目（重复字母循环匹配）。
回车/空格或点击执行 onSelect 并关闭；Esc 关闭并返回入口，Tab / Shift+Tab 关闭后继续入口前后的顺序导航。
所有项禁用时聚焦菜单面板，仍可通过 Esc 或 Tab 离开。浏览和聚焦不执行操作。

点击外部、入口离开可视区域时由原生 auto popover 和定位逻辑关闭，无需额外滚动锁。
菜单置于触发器附近的 DOM，支持 GlassDialog / GlassPopover 内使用，内层 Esc 不关闭宿主。
激活操作时先将焦点返回入口、请求关闭，再调用 onSelect，避免旧菜单关闭时抢走新弹窗的焦点。
危险操作仅设置视觉语义，确认弹窗和业务判断由调用方决定；异步结果、待处理状态和错误由调用方管理。

整张菜单共用一块玻璃背景，菜单项不单独叠加折射滤镜；32px 外圆角、16px 内圆角，点击行至少 44px。
长说明自然换行，键盘活动项在限高菜单内保持可见，正文隐藏滚动条但支持触控、滚轮和键盘滚动。
鼠标悬停只移动焦点，不自动将边缘项目滚入视口；停在顶部或底部不会触发列表自动滚动。
保留已有位移动画与减少动态效果回退，不增加整体透明度动画或焦点描边。
操作列表用于执行命令，选值仍使用 Select；当前条目模型为操作项与分隔线。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/dropdown-menu`，包含三种材质、图标/说明、
危险与禁用项、键盘与原生表单、受控开关/ref、RTL、长列表/长文本，以及弹窗与浮层嵌套。
所有操作仅更新本页状态，生产构建不包含该页面。

## Badge / Chip

```tsx
import { Badge, Chip } from './design-system';
import { BookOpen } from 'lucide-react';

<Badge tone="accent" icon={BookOpen}>在读</Badge>
<Badge>{0}</Badge>
<Chip label="小说" selectable selected={fictionSelected} onSelectedChange={setFictionSelected} />
<Chip label="历史" onRemove={() => removeFilter('history')} />
```

Badge 为展示用 span，文字或数字为必填 children，数字 0 正常显示；默认不增加 Tab 停靠点。
Chip 为标签容器：普通标签显示文本，selectable 启用原生切换按钮，onRemove 增加独立的移除按钮。
同时可选择和移除时，两枚按钮为兄弟节点，移除不会触发选择，也不会产生嵌套 button。

| 属性 | 说明 |
| --- | --- |
| 共同的 `tone` | neutral / accent / success / warning / danger，默认 neutral |
| 共同的 `size` | sm / md / lg；Badge 最小高度 24 / 28 / 32px，Chip 默认高度 28 / 32 / 36px |
| 共同的 `icon` | 可选 Lucide 图标，装饰图标不重复播报文字 |
| 共同的 `material` / `intensity` | 默认 solid / subtle，可显式使用 liquid 或 frosted，并共享环境降级 |
| Badge `children` | 非空文字或有限数字，长内容允许换行 |
| Chip `label` | 必填非空标签文字 |
| Chip `selectable` | 默认 false；启用后使用 type=button 和 aria-pressed |
| Chip `selected` / `defaultSelected` | 受控 / 非受控选择状态，配合 selectable 使用 |
| Chip `onSelectedChange` | 点击、回车或空格切换时通知新的布尔值 |
| Chip `onRemove` / `removeLabel` | 移除请求与按钮可访问名称，默认“移除标签：标签文字” |
| Chip `disabled` | 禁用交互；父 fieldset 的禁用也通过原生按钮生效 |
| 共同的 `ref` / HTML 属性 | ref 均为外层 HTMLSpanElement，className、style、dir 等也作用于外层 |

两个组件默认使用柔和实色，不为列表中的每个标签创建玻璃滤镜。
显式选择液态材质时，每个标签使用一个轻量装饰，文字和图标位于折射层之外；共享 tone 样式位于 components/tag.css。
圆角沿用 32px 设计变量，小标签自然呈胶囊形；长文字换行，移除按钮保留独立空间，支持 RTL。
触屏下交互 Chip 的每个按钮高度至少 44px。禁用 Chip 隐藏玻璃装饰，不添加焦点描边或整体动效。
选择状态通过勾选标记、aria-pressed 与底色表达，选中不会增加描边或改变勾选槽宽度。

移除按钮支持点击、回车和空格；Chip 内按钮聚焦时，Delete / Backspace 也会请求移除并阻止事件继续触发外层删除操作。
onRemove 通知调用方更新标签数组，并由列表拥有者将焦点转移到相邻标签或恢复入口；预览页演示了此处理。
Chip 内所有按钮均为 type=button，不提交表单；界面筛选状态的提交和表单重置由调用方处理。
组件只表达状态和发出回调，不保存分类、修改书籍或调用业务接口。

开发预览为 `http://127.0.0.1:5173/mybooks/playground/badge`，包含三种材质、状态/数量、尺寸、
受控/非受控选择、移除与焦点衔接、独立按钮、禁用/fieldset、表单、长文本和 RTL；仅开发模式提供。

## 书库侧栏与竖屏收纳

应用入口 `/mybooks/` 使用 `features/library/LibraryWorkspace.tsx`，侧栏业务组件位于
`features/library/components/LibrarySidebar.tsx`，通过 `layouts/MainLayout.tsx` 的可选 sidebar/mobileHeader 插槽接入。
已有组件预览不传 sidebar，保持原有独立页面布局。

桌面侧栏宽 208px，采用浅灰底、紧凑导航和分组标题；选中项使用主题色浅底与主题色文字/图标，随设置页主题色变化。
My Books 品牌标题采用 24px，与侧栏收起按钮同一行垂直居中；收起时隐藏文字，竖屏抽屉标题保持相同字号。
导航行的小圆角由 32px 基础圆角派生为 8px；其余设计变量沿用现有系统。
图标全部使用 lucide-react，不使用截图、图标字体或模拟系统窗口按钮。

- My Books 分组为“首页、阅读统计”；已移除“阅读记录”导航入口。
- 书库分组包含全部图书、未读、已读、电子书、PDF 文档和读书心得。
- 我的分类只读获取 `GET /api/sync/folders`，显示 App 已同步到服务器的分类树，支持父子缩进、载入、失败重试和空列表；回到页面时重新读取，快照版本变化后刷新当前分类的图书。
- 新面板不再跳转旧版分类管理或账户页；分类列表只读，未登录时账户入口打开新版登录弹窗，已登录时显示账户状态；齿轮为独立“设置”入口。
- 设置使用 `/mybooks/settings` 路由，内容见“设置与主题色”。

`LibrarySearch` 复用 TextField，清除/菜单/关闭按钮复用 IconButton；输入保持 16px 和既有的搜索占位文字焦点行为。
搜索已移出侧栏，仅在全部图书视图通过 MainLayout 的 topBar 插槽悬浮在右侧主体区域顶部中央，随侧栏展开/收起重新居中，采用液态玻璃材质；其他视图不显示搜索栏。竖屏位于菜单按钮右侧，不遮挡菜单入口。
图书页标题、排序控件位于内容区顶部（16px 上边距），搜索宽度根据主体剩余空间收缩，避免遮挡标题与排序入口。
桌面侧栏顶部可切换展开与 64px 图标模式，收起后保留导航、分类、账户和设置图标，通过可访问名称及原生悬停提示识别。
展开状态独立存入 `mybooks.admin.sidebarCollapsed`，不影响竖屏抽屉；图标模式下的导航仍使用原有 URL 与选中状态。
搜索提交将 q 写入地址并进入全部图书视图，导航和分类选择也保存到地址，支持刷新、前进/后退和原生链接操作。
正式入口的右侧书籍内容与搜索结果使用真实分页接口，旧侧栏预览地址也统一跳转到这些正式功能。
设置入口清空书库搜索上下文；它不跳转到账户页。

应用使用 `/mybooks` 基路径：`/mybooks/` 首页，`/mybooks/books/{all|unread|finished|ebooks|pdf}` 图书列表，
`/mybooks/folders/:id` 为 App 同步分类（包含子分类图书）；原 `/mybooks/collections/:id` 保留给独立 Web 藏书集。其他页面使用 `/mybooks/statistics`、`/mybooks/notes`、`/mybooks/settings`。
搜索、排序、作者/译者/出版社和分页继续使用查询参数；旧 `?view=`、`?collection=` 链接仍可打开，首次渲染会改写为规范路径。
书库和游客演示仍挂在 `/mybooks/playground/library`、`/mybooks/playground/guest`，沿用相同子路径；旧 `/mybooks/playground/sidebar/*` 仅作为对应正式功能的兼容入口。

窄屏（小于 768px）或竖屏采用录屏中的覆盖式左抽屉：宽度为可用视口的 80%，最大 360px，边缘为直角，
与桌面一致的浅灰面板从左侧滑入，右侧保留 32% 黑色遮罩，内容区域保持原位；两种布局的底色和选中项共用颜色变量。
抽屉基于已有 GlassDialog / GlassSurface，使用 solid 材质，继承模态焦点、背景隔离、滚动锁与 Esc/遮罩关闭。
账户区固定在底部，中间导航可独立滚动；切回宽屏横屏时自动关闭抽屉。

useSidebarSwipe 在抽屉内容层补充左滑收纳：超过宽度四分之一，或达到最小拖距的快速左划会关闭；不足时回弹。
纵向意图交给原生滚动，搜索输入不作为拖动起点，拖动后的点击被拦截以免误选菜单项。
手势按帧更新 transform，不在每次 pointermove 重渲染导航；减少动态效果时去掉自动过渡。
sidebar-gesture.ts 保留意图与关闭阈值的纯函数，便于独立验证。

独立的 `LibrarySidebar.preview.tsx` 已移除；书库侧栏统一读取服务器分类，组件演示里的“书库”链接也使用 `/mybooks/books/all`。独立图书与游客演示继续使用各自的演示数据。
参考图片/录屏保留在本地附件目录，未作为运行资源引入，已从 Git 和 Docker 构建上下文排除。

## 图书展示与第一阶段业务接入

`features/library/components/BookCard.tsx` 是纯业务展示组件，接收 `book`，不发请求、不修改数据。卡片只展示封面、书名、作者与译者，不显示未读/在读/已读状态标签。
封面保持原比例、懒加载；缺失或加载失败时显示书名占位。外部 HTTP(S) 封面走既有图片代理，同源封面保留原路径。
作者与译者位于书名下方，译者数组用顿号连接，无译者时不生成该行。批量卡片使用普通背景，不创建液态滤镜。

`LibraryBooks` 复用 BookCard、Select、Button 和 IconButton，具备加载、空列表、搜索无结果、错误重试与响应式网格。
`LibraryToolbar` 只保留液态玻璃排序控件，与页面标题同一行并靠右对齐，使用 sm 控件尺寸（36px 高、88px 宽）。入口初始显示“排序”，选中后显示对应选项，超宽时省略并提供完整文字的原生提示。入口无箭头，菜单不显示“请选择”，菜单宽度按最长选项和勾选图标自动撑开。
排序、作者和出版社统一复用 `design-system/components/FilterSelect/FilterSelect.tsx`，从设计系统入口导出。
共享组件接收受控的 `value`、`options`、`onValueChange` 与 `label`，统一紧凑宽度、文字省略、无箭头、菜单自适应宽度、液态玻璃和共享形变。
可选 `emptyOptionLabel` 用于“全部作者 / 全部出版社”等清除筛选操作；不传时菜单只显示实际选项。
`LibraryFilters` 将作者、排序、译者与出版社组成右侧 2×2 网格，整体高度与左侧标题和数量文字对齐；窄屏缩小单个入口宽度，文字继续省略。
译者筛选同样复用 FilterSelect，支持“全部译者”与 URL 的 `translator` 参数，并可与作者、出版社、搜索、分类一起使用。
真实选项读取已有 `/api/authors` 和新增的只读 `/api/publishers`，接口失败显示重试；开发预览注入独立演示选项。
筛选值写入 URL 的 `author` / `publisher`，与搜索、状态、分类、排序组合，变更后回第一页并支持刷新与前进/后退。
图书 API 通过新增的 `author_exact` 和 `publisher` 参数做参数化精确筛选，避免姓名子串误命中及引号进入搜索语法。
出版社从在架图书聚合，排除空白和回收站，支持现有虚拟书库作用域及 q/limit/offset 读取；不增加数据库表或改动元数据。
只读 `/api/translators` 复用已有译者归一化规则，支持 JSON 数组和历史字符串，按每本书去重计数并排除回收站。
图书查询通过 `has_translator` SQLite 纯函数精确比较归一化姓名；与详情 DTO 使用相同的 `parseTranslators`，不改数据表或阅读记录。
触发器与下拉菜单均使用 Select 的液态玻璃材质；菜单继续使用原生顶层浮层，页面不再有固定顶部悬浮条或刷新按钮。
`GlassPopover` 新增可选 `animation="morph"`：读取入口和面板矩形，以位移、缩放及圆角变化实现从入口长出菜单、关闭回到原位的共享形变。
只对菜单文字做透明度过渡，玻璃主体保持不透明度稳定；定位读取布局尺寸，避免动画中的缩放影响定位。默认弹出动画不变，减少动态效果时关闭形变。
`Select` 通过 `triggerLabel`、`showChevron`、`showPlaceholderOption`、`matchTriggerWidth`、`popoverAlign` 与 `animation` 提供紧凑排序入口，原有组件默认行为保持兼容。
图书页已移除旧版书架切换按钮；尚未迁移页面只显示占位说明，不再提供旧版入口。
`useLibraryBooks` 通过 `shared/api.ts` 读取 `/api/books`，每页 48 本，读取 `X-Total-Count`；缺失总数时按当前页数量判断是否还有下一页。
切换条件或卸载时取消旧请求并忽略过期结果；搜索、分类、排序与页码均写入地址，支持刷新和浏览器返回。
筛选、排序均交给已有服务端，未读继续使用 `wish`、已读使用 `done`，电子书/PDF 使用现有 `format:true` / `format:PDF` 搜索语法。
组合格式和用户查询时包裹用户表达式，确保 `or` 不会绕过格式条件；不在当前分页内自行筛选制造错误总数。

首页与设置页已接入新面板；阅读统计和读书心得暂时显示迁移占位，不再提供旧版入口。
只读书籍详情已接入；后续顺序为编辑与状态操作、添加/导入、分类管理与其他页面，逐项实现新面板，不再依赖旧版页面。
业务校验、数据库、阅读记录与同步语义继续保留在现有后端。

`test/react-library.test.js` 使用隔离临时库验证筛选、分页与搜索组合，并验证请求取消、错误码和登录回跳；不读写个人书库。

## 图书详情弹窗

`features/book-detail/BookDetailDialog.tsx` 接收 `book`、`open`、`onOpenChange`、内容锚点 `anchorRef` 和可选预览加载器，复用 ContentDialog，保持只读。
卡片通过原生按钮打开详情，支持鼠标、触摸、Enter 与空格；关闭弹窗后恢复入口焦点。
左侧上方为 BookCover，下方为作者与译者，无译者时不生成该项；右侧上方显示简介，下方左列显示 ISBN 和 10 分制评分，标签位于 ISBN 右边。书名显示在弹窗标题。
标签支持既有 JSON 字符串/数组，复用只读 Chip，不表示阅读状态。
BookCover 与卡片共用原比例封面、代理地址、缺失/加载失败占位。简介使用纯文本，保留换行，不执行 HTML。
详情打开时读取已有 `GET /api/books/:id`，支持载入、错误重试；关闭、切换图书或卸载时取消旧请求并忽略过期响应。
缺失字段显示“未提供 / 暂无简介 / 暂无评分 / 暂无标签”，0 分遵循既有未评分语义。
弹窗通过实际主体边界定位到右侧内容中心，横屏默认高度按评分字段下沿加原有底部间距计算，不再人为指定高度；竖屏维持 400px，较小视口限制为内容区域高度减 32px。
标题保持固定，长内容在内部上下滚动且隐藏滚动条，切换图书时回到顶部，手机仍保留左右布局。
开发预览注入演示详情，生产构建不包含演示数据。

## 设置与主题色

设置页位于 `features/settings/SettingsPage.tsx`，使用 `view=settings` 路由并复用内容区布局。主题色组件 `ThemeColorSetting` 提供五个预设色与自定义取色；选择后立即覆盖根元素的 `--ui-color-accent*`、`--ui-color-on-accent` 与 `--ui-color-link`，按钮、链接、复选框、开关、分段控件及侧栏选中项统一跟随。选中值保存到 `localStorage['mybooks.admin.themeColor']`，启动时在渲染前恢复，避免首屏闪色。
默认淡蓝保留原有 token 数值；其他颜色按对比度派生悬停、按下、浅色底和链接颜色，文字色在深色与白色之间自动选择。侧边栏选中项使用 `--ui-color-accent-soft` 背景与 `--ui-color-link` 文字/图标，收起态同样生效。
自定义颜色通过共享 `design-system/components/ColorPicker/ColorPickerDialog` 选择，提供色相、饱和度、明度滑杆，实时颜色预览、`#RRGGBB` 输入和恢复默认 / 取消 / 确定；只有确认后才写入主题，取消或关闭不改变当前值。

## 共享业务弹窗与登录

`design-system/components/ContentDialog` 在 GlassDialog 上统一业务弹窗尺寸、材质、主体居中和内部滚动。`anchorRef` 指向右侧 main；`heightAnchorRef` 指向横屏最后一项内容，`layoutKey` 触发布局重测，`scrollKey` 切换时回到顶部。竖屏统一维持 400px，并受可用高度限制。
图书详情以评分为高度锚点，`features/auth/LoginDialog` 以提交按钮为高度锚点，复用同一外壳；登录提供初始化状态、请求错误、重试与关闭取消请求。登录弹窗完全关闭后才恢复待执行操作，避免同时打开两个原生模态弹窗。
登录弹窗使用与竖屏端一致的紧凑单栏尺寸（sm 宽度），不显示左侧品牌与 logo，高度随表单内容自适应，底部仅保留常规内边距；初始化提示、错误与重试出现时随内容增高并受可用高度限制。

## 图标依赖

已锁定安装 [`lucide-react@1.69.0`](https://lucide.dev/guide/react)，
与当前 React 19 版本兼容。Lucide 提供 SVG 图标组件，不提供表单、弹窗等完整 UI 控件。
与其他前端依赖一样，它位于根目录 `devDependencies`，在构建时按需打包。
后续组件使用命名导入，例如：

```ts
import { BookOpen, Search, Settings } from 'lucide-react';
```

按需导入使用的图标，避免整库枚举或动态导入全部图标；Button 已支持前置与后置图标。
ISC 许可及其 Feather 衍生图标的 MIT 声明全文随 `/mybooks/third-party-notices.txt` 分发。

## 构建与部署

```sh
npm run typecheck:admin
npm run build:admin
npm start
```

`build:admin` 已包含类型检查，产物写入 `web-react/dist/`，不提交 Git。
也可使用 `npm run build`。Express 在 `/mybooks/` 公开托管应用外壳和静态产物，让游客进入新版首页；私有 API 仍要求有效会话。
在完成构建前访问会返回 503；旧面板已归档，不影响新面板其他路由。

HTML 禁止缓存，带哈希的静态资源允许浏览器私有长缓存。
SPA 回退只限 `/mybooks/`，缺失资源返回 404；新面板不注册 Service Worker，旧脚本只保留注销和清缓存职责。

Docker 多阶段构建和 `deploy/update.sh` 已包含前端构建，生产环境仍只运行现有 Node 服务，
不运行 Vite 开发服务器。CI 执行类型检查、生产构建和现有后端测试。

TypeScript 和 Vite 使用与操作系统匹配的原生依赖。Docker、CI 与更新脚本安装时
显式包含 optional 依赖并增加下载重试；不要使用 `--omit=optional`，否则可能缺少
Linux 编译器或打包器。Docker 内的构建、新面板 HTTP 访问和旧路径跳转已完成验证。
