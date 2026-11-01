# 05 · Spacing 与 Radius

## 1. 间距现状

基线没有 spacing token。实际值以 2px 为最小单位、以 4px 为主要节奏，但存在大量 6/10/14/18/22/26/34/54/68 等光学补偿值。

### 1.1 已登记的实际间距

| 范围 | 值 | 用途 | 源码 |
|---|---|---|---|
| 顶栏内宽 | `max-width: 1024px`，内边距 `0 20px`；≤819 `0 16px` | 全站导航 | `style.css:147-156,645-649` |
| 顶栏高度 | 桌面 `min-height: 44px`；手机 `48px`；品牌按钮本身 30px | 导航 | `style.css:155,649`；`style.css:246-256` |
| 主内容 | `max-width: 1120px; padding: 44px 22px 80px`；≥820 `44px 24px 90px`；≤559.98 `30px 18px 60px`；≥1400 `max-width: 1220px` | 普通页面 | `style.css:1630-1634,4490-4506,4608-4611` |
| 页脚 | `padding: 26px 22px 40px` | 公共页脚 | `style.css:3358-3367` |
| 弹窗 | 桌面 `padding: 26px 24px 30px`，外层 28px；竖屏 `20px 16px 22px`；横屏 `18px 16px max(22px, safe-area)` | 表单/设置弹窗 | `style.css:2361-2373,4510-4517,4534-4567,4576-4602` |
| 书籍表单 | `#bookModal` 最大 760px；网格 `gap: 14px 16px`；分区 `margin-top: 18px; padding-top: 16px`；手机 `gap: 13px` | 添加/编辑 | `style.css:5064-5093,5130-5165` |
| 书籍详情 | 滚动区 `padding: 24px 24px 32px`；移动 `16px 20px calc(24px + safe-area)`；Inspector `44px 24px 96px` | BookDetails | `style.css:2615-2621,3020-3025,3040-3042`；`shelf-workbench.css:107` |
| 书架外壳 | 面板外边距 8px；三栏 `232px / 1fr / 332px`；列间距 8px | 书架布局 | `shelf-workbench.css:46-63` |
| 书架网格 | `padding: 0 clamp(20px,2vw,36px) 112px`；≤819 `0 16px 104px`；≤560 `0 13px 100px`；列表 `0 clamp(18px,3vw,44px) 110px` | 书架 | `shelf-workbench.css:374-382,1039,1263-1274,1336-1341` |
| 书架 scope | `padding: 68px clamp(20px,2vw,36px) 0` | 书架标题/计数 | `shelf-workbench.css:602-617` |
| 书架侧栏滚动 | `padding: 54px 8px 76px`；手机 `10px 8px 76px` | 资料库 | `shelf-workbench.css:113,141` |
| 书架分组 | `.wb-section + .wb-section { margin-top: 22px; }` | Finder 分组 | `shelf-workbench.css:174-175` |
| 书架行 | `min-height: 36px; padding: 0 10px`；触屏 44px | Finder 条目 | `shelf-workbench.css:216-224,1344-1346` |
| 书架卡片 | `gap: 8px`；封面与文字间距 8px | 卡片 | `shelf-workbench.css:442-453` |
| 统计 | hero `padding: 34px 34px 30px`；panel `26px 26px 24px`；≤560 `26px 22px 24px` / `22px 20px` | 统计页 | `style.css:2083-2092,2154-2160,4490-4495` |
| 分类管理 | 双列 `gap: 20px`；行 `padding: 10px 20px`；宽区块 `margin-top: 20px` | `/tags` | `style.css:4744-4772,4819` |
| 登录 | 页面 `padding: clamp(20px,5vh,56px) 16px`；卡片 `26px 30px 30px`；≤560 `18px 16px 22px` | `/login` | `login.css:2-15,297-302` |
| 首页 | hero `padding: 64px 24px 72px`；卡片网格 `gap: 13px`；深色横幅 `padding: clamp(40px,5vw,60px) 24px 0` | 首页 | `style.css:3496-3505,3550-3559,3533-3542` |
| 首页画廊 | 大卡 `688–1250px`，小卡 `188–470px`，间距 13px，内容内边距 22–70px | Apple parity | `style.css:3741-3783,4382-4483` |

### 1.2 高频间距

| 值 | 常见用途 |
|---:|---|
| 2px | 分段内部 gap、密集菜单行 |
| 4px | 标签/图标与文字的微间隙、分段轨道内边距 |
| 6px | 图标按钮内部、菜单项、表单字段行内 gap |
| 8px | 控件/卡片/面板的默认 gap |
| 10px | 按钮内 gap、侧栏行内 gap、卡片内容 |
| 12px | 表单字段、列表行、卡片间距 |
| 14px | 菜单内边距、移动表单 gap |
| 16px | 区块 gap、弹窗内边距基准、移动页面边距 |
| 18px | 弹窗标题下、分区间距 |
| 20px | 面板内边距、分类管理 gap |
| 22px | 书架分组、面板内边距、页脚左右 |
| 24px | 主容器边距、模态标题区、详情区 |
| 28px | 桌面弹窗外边距/面板内边距 |
| 32px | 首页/展示区、详情动作区 |
| 36px | 书架 scope 左右最大值、笔记正文内边距 |
| 40px | 弹窗底、首页 CTA |
| 44px | 触屏命中区、导航高度 |
| 48px | 手机顶栏/菜单项命中区 |
| 52px | 移动侧栏头、分组底部 |
| 64px | 首页 hero 上下、高密度展示区 |
| 80px | 页面上下留白、书架滚动底部 |
| 112px | 书架网格底部（为底部浮动工具条留位） |

## 2. 间距系统【规范值·未落地】

建议第二阶段引入以下值，不改变现有视觉，只把重复字面量替换为 token：

| Token | 值 | 用途 |
|---|---:|---|
| `--space-2` | 2px | 微间隙 |
| `--space-4` | 4px | 最小节奏 |
| `--space-6` | 6px | 行内 gap |
| `--space-8` | 8px | 默认 gap |
| `--space-10` | 10px | 控件内 gap |
| `--space-12` | 12px | 表单/列表 |
| `--space-14` | 14px | 菜单/移动表单 |
| `--space-16` | 16px | 区块基准 |
| `--space-18` | 18px | 分区 |
| `--space-20` | 20px | 面板 |
| `--space-22` | 22px | 书架分组 |
| `--space-24` | 24px | 页面/详情 |
| `--space-28` | 28px | 弹窗外层 |
| `--space-32` | 32px | 展示区块 |
| `--space-36` | 36px | 大内衬 |
| `--space-40` | 40px | 弹窗底/CTA |
| `--space-44` | 44px | 触屏目标 |
| `--space-48` | 48px | 手机导航 |
| `--space-52` | 52px | 移动侧栏头 |
| `--space-64` | 64px | hero |
| `--space-80` | 80px | 页面上下 |
| `--space-112` | 112px | 书架底部留白 |

规则：

- 允许 2px 的“光学半步”，但不得新增 3/5/7/9/11/13/15 等无登记值；
- 间距优先用 `gap`，不用相邻 `margin` 叠罗汉；
- 同一分组内的行距保持一致；分组之间用 18–22px；
- 不用 padding 伪造命中区；触屏命中区用 `min-height: 44px` 或真实尺寸；
- 不通过缩小间距来“塞下更多内容”，应先调整密度档位或换行策略。

## 3. 圆角现状

### 3.1 Token 映射

| Token | 值 | 当前实际用途 |
|---|---:|---|
| `--radius-xs` | 6px | 未使用 |
| `--radius-sm` | 10px | `.wb-action`、`.cat-op`、`.modal` 家族局部 |
| `--radius-md` | 14px | `.sel-menu`、`.bd-pop` |
| `--radius` | 18px | `.cat-col`、`.detail-notes`、笔记编辑框 |
| `--radius-lg` | 20px | `.panel`、`.stats-hero`、桌面 `.modal-box`、竖屏弹窗 |
| `--radius-xl` | 24px | 书架面板、详情抽屉、登录卡片、`#bookDetailModal` |
| `--radius-pill` | 999px | 按钮、标签、下拉触发器、分段轨道 |

### 3.2 组件圆角映射

| 组件 | 圆角 | 源码 |
|---|---:|---|
| 主按钮/图标按钮 | 999px / 50% | `style.css:1467-1480,1573-1588` |
| 分段轨道/滑块 | 999px | `style.css:1410-1425` |
| 自定义下拉触发器 | 999px | `style.css:1671-1683` |
| 下拉菜单 | 14px | `style.css:1726-1746` |
| 标签胶囊 | 999px | `style.css:2273-2285` |
| 表单输入/文本域 | 12px | `style.css:2418-2437` |
| 弹窗（桌面/竖屏） | 20px | `style.css:4516,4544-4546` |
| 弹窗（横屏抽屉） | 20px 20px 0 0 | `style.css:4581-4586` |
| 详情抽屉（桌面/手机） | 24px / 24px 24px 0 0 | `style.css:3004-3017,3033-3039` |
| 书架三栏面板 | 24px | `shelf-workbench.css:82-84` |
| 书架封面 | 8px | `shelf-workbench.css:455-464` |
| 书架列表/移动列表行 | 14px | `shelf-workbench.css:1048-1060` |
| 书架表头 | 0 | `shelf-workbench.css:1106-1123` |
| 统计 hero | 20px | `style.css:2083-2086` |
| 统计面板 | 20px | `style.css:2154-2157` |
| 分类管理列 | 18px | `style.css:4750-4754` |
| 登录卡片 | 24px | `login.css:7-14` |
| 登录表单/身份块 | 18px / 16px | `login.css:91-99,148-156` |
| 首页产品卡 | 18px | `style.css:3561-3564` |
| 首页小卡 | 18px | `style.css:3982-3986` |
| Glass Lab 舞台 | 26px（开发页） | `glass-lab.html:29-39` |

### 3.3 书封圆角是特例

书封不是普通卡片。它使用**左小右大的非对称圆角**模拟书脊：

| 场景 | 圆角 | 证据 |
|---|---|---|
| 旧版书架卡片 | `4px 12px 12px 4px` | `style.css:1871-1875` |
| 首页封面 | `4px 16px 16px 4px` | `style.css:3646-3650` |
| 产品卡封面 | `4px 12px 12px 4px` | `style.css:3582-3587` |
| 详情封面 | `4px 10px 10px 4px` | `style.css:2654-2658` |
| 心得封面 | `3px 8px 8px 3px` | `style.css:3151-3156` |
| 榜单封面 | `4px`（小尺寸不区分书脊） | `style.css:4700-4706` |
| 首页画廊大封面 | `5px 14px 14px 5px` | `style.css:3948-3956` |
| 首页画廊小封面 | `4px 9px 9px 4px` | `style.css:4018-4029` |
| 书架工作台封面 | `8px` 四角 | `shelf-workbench.css:455-464` |

**这是有意的视觉语言，不是不一致。**但同一“书封”在不同页面使用了 8 种右侧圆角/比例，属于封面组件家族需要统一“变体命名”而不是统一数值。第二阶段应定义 `book-cover--library`（书架 2:3、8px）与 `book-cover--display`（展示 5:7、左侧 4px/右侧 10–16px）两个正式变体，再逐步收敛页面上的临时值。

## 4. 圆角系统【规范值·未落地】

建议第二阶段使用以下角色，不再按页面随手取值：

| 角色 | 值 | 适用 |
|---|---:|---|
| `--radius-thumb` | 4px | 小缩略图内缘、书脊侧 |
| `--radius-control-sm` | 8px | 小图标按钮、密集行内控件 |
| `--radius-control` | 10px | 分类操作、行内按钮 |
| `--radius-input` | 12px | 输入框、文本域、选择项 |
| `--radius-menu` | 14px | 下拉菜单、浮层 |
| `--radius-card-sm` | 16px | 小卡片、身份块 |
| `--radius-card` | 18px | 普通卡片、分类列、笔记正文 |
| `--radius-card-lg` | 20px | 统计面板、桌面弹窗、hero |
| `--radius-panel` | 24px | 书架三栏、详情抽屉、登录卡片 |
| `--radius-pill` | 999px | 胶囊控件 |

规则：

- 同一层级的容器使用同一圆角；不要 18/20/24 混用表达同一“大卡片”；
- 嵌套表面使用同心圆角：`childRadius = parentRadius - inset`，结果不小于 0；这是新组件规则，不回溯改现有组件；
- 胶囊控件内部不要再套大圆角卡片；
- 圆角不能裁掉焦点环；需要时给外层留 padding 或把焦点画在内侧；
- 不在新组件中使用 5/7/9/11/13/26px 等未登记值。

## 5. 间距与圆角的验收线

- 1440、1280、1024、932、768、560、390、360 宽度下无横向溢出；
- 书架三档密度下封面宽度分别为 140/180/210，间距 14/20/24；
- 桌面 Inspector 打开时 1440 网格为 4 列，1920 填满宽度而不是居中留大边；
- 手机 390 下书架标准密度 2 列、紧凑密度 3 列；
- 弹窗在竖屏使用 `svh` 高度，地址栏显隐不跳高；
- 触屏上主要控件命中区不小于 44×44px；
- 任何新增圆角/间距必须能在本文件找到对应角色或注明例外。
