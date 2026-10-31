# My Books · 书籍详情 UI 与视图图标重构

- 日期：2026-11-01
- 分支：`fix/remaining-ui-auth-interactions`
- 本轮基线：`56fa2f1`（其上包含未提交的侧栏层级修正）
- 范围：`public/js/book-details.js`、`public/css/style.css`、`public/css/shelf-workbench.css`、`public/css/liquid-glass.css`、`public/shelf.html`
- 未改后端 API、数据库、筛选协议或阅读同步；未部署

## 1. 结果摘要

- 书籍详情从“整页编辑表单”改为“阅读优先的信息面板”：评分与系列默认静态展示，点击才进入行内编辑；完整编辑仍是唯一的 `#bookModal`。
- 顶部改为封面（96px）/ 书名（21px、650）/ 作者（13.5px）层级；阅读状态移到封面与标题行下方，独占一行，不再挤压长书名/作者。
- 默认内容顺序：封面与标题 → 阅读状态 → 书籍信息 → 简介 → 阅读记录 → 标签 → 分类 → 电子书 → 更多信息/自定义字段 → 操作。
- 空出版/ISBN/豆瓣/系列/标识符进入可展开“更多信息”；ISBN 提供复制；豆瓣仍可跳转；系列可从更多信息或完整编辑补充。
- 行内编辑保护草稿、输入焦点与滚动位置；Enter 提交、Escape 取消；错误保留输入值和编辑态；评分/系列都走现有 `patchBook()` 与 revision 冲突流程。
- 网格/列表图标改为 16×16 细描边：网格四个空心圆角方框、列表三组细线+方框；选中只靠浅白玻璃滑块和中深色图标，不再有黑色实心填充。
- 回归：`npm test` **572 / 572 通过**；`check:public` 通过（204 files checked / 98 binary-large skipped）。

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `public/js/book-details.js` | 展示优先层级；静态评分/系列；行内编辑状态机、草稿/焦点/滚动保护；更多信息；ISBN 复制；空字段入口 |
| `public/css/style.css` | 详情封面/标题/状态/分组/元数据字体与间距；静态值、快捷输入、错误、更多信息、复制按钮；移动端尺寸 |
| `public/css/shelf-workbench.css` | `.wb-view` 按钮尺寸、未选中/选中图标色、触控 44px；保留视图切换事件与 ARIA |
| `public/css/liquid-glass.css` | 玻璃档位下 `.wb-view` 未选中为中性灰、选中为近黑，选中底仍由外部玻璃滑块承担 |
| `public/shelf.html` | 网格/列表图标 SVG 改为 `fill="none"`、细描边、16px 视口 |

资源版本：style v120、liquid v6、shelf-workbench v44、book-details v5、main v41、sidebar v39、SW `v182`。

## 3. 关键 CSS / 代码差异

### 3.1 详情顶部与内容顺序

```diff
- <div class="bd-hero"> cover + intro (title/author + status 控件) </div>
- <input data-bd-rating> / <input data-bd-series-name> ...
+ <div class="bd-hero"> cover + title/author </div>
+ <div class="seg seg--track bd-status"> 想读 / 在读 / 已读 </div>
+ <section class="bd-info-section">
+   <h3>书籍信息</h3>
+   rating static / series static / 出版 / ISBN(复制) / 豆瓣
+ </section>
+ 简介 → 阅读记录 → 标签 → 分类 → 电子书 → 更多信息 → 操作
```

```css
.bd-cover { width: 96px; box-shadow: 0 3px 10px rgba(0,0,0,.12); }
.bd-title { font-size: 21px; font-weight: 650; }
.bd-author { font-size: 13.5px; }
.bd-section-title {
  font-size: 13px;
  font-weight: 650;
  color: #62646c;
  letter-spacing: 0;
  text-transform: none;
}
.bd-k { font-size: 12px; color: #929399; }
.bd-v { font-size: 13.5px; color: #35363b; }
.bd-summary { font-size: 14px; line-height: 1.7; }
```

移动端：封面 84px、标题 19px；状态仍在标题行之外占满宽度；快捷输入 40px 高/16px，防止 iOS 缩放。桌面 Inspector 封面 96×144，封面阴影不再使用厚重的 `--cover-shadow`。

### 3.2 评分 / 系列静态 → 行内编辑

默认显示：

- 有评分：`8.5 / 10`
- 无评分：`添加评分`
- 有系列：`地球往事 #1`
- 无系列：不在主信息区放空输入框；进入“更多信息 → 添加系列”

点击静态值后渲染：

```html
<span class="bd-v bd-quick-editor" data-bd-inline-editor="rating">
  <input class="bd-quick-input bd-quick-rating" data-bd-inline="rating">
  <span class="bd-unit">/ 10</span>
</span>
```

`BookDetails` 新增 `state.inlineEdit`、`captureInlineDrafts()`、`restoreInlineFocus()`：每次 `render()` 前抓取草稿，重建后恢复输入焦点与滚动位置。Enter 调 `commitInline()`，Escape 取消；失焦在焦点离开编辑器时提交。错误只显示在字段下方并保留输入内容；CONFLICT 会重新加载 revision 后保留草稿供重试。

### 3.3 更多信息、ISBN 与空字段

- 主信息区只展示有实际值的出版、ISBN、豆瓣；低频空字段放在 `更多信息`。
- 更多信息包含空出版、空 ISBN、空豆瓣、系列添加、标识符、空字段说明和自定义字段。
- ISBN 旁提供轻量“复制”；复制成功显示 toast，失败给出可手动复制的提示。
- 豆瓣仍为新窗口链接；系列仍可从静态值或更多信息进入行内编辑。
- 编辑全部按钮仍在底部，提供所有字段和文件入口。

### 3.4 视图切换图标

```diff
- <svg width="13" height="13" fill="currentColor"><g>四个实心 rect</g></svg>
+ <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3">
+   四个等宽等距的圆角空心方框
+ </svg>
- <svg><g fill="currentColor">三条粗实心横条</g></svg>
+ <svg fill="none" stroke="currentColor" stroke-width="1.25">
+   三个细线方框 + 三条细线
+ </svg>
```

```css
.wb-view button { width: 28px; height: 28px; color: #6e6e73; }
.wb-view button.active { color: #1d1d1f; background: var(--selected-bg); border-color: var(--selected-edge); }
@media (hover: none), (pointer: coarse) {
  .wb-view button { width: 44px; min-width: 44px; height: 44px; }
}
```

选中不由图标填充表达，而由外部 `.seg--track` 的浅白玻璃滑块、柔和边缘和深色图标表达；无蓝粗边。

## 4. 浏览器截图

验收在真实 Chrome 与一次性演示库中完成，覆盖桌面 Inspector 1440、独立详情 Sheet 1440/390、手机详情 390、横屏 932、空评分/空系列/更多信息，以及书架视图切换。截图仅用于本轮核对，未随仓库提交。

## 5. 测试与浏览器验收

### 5.1 自动化

```text
npm test                 572 tests / 572 pass / 0 fail
npm run check:public     pass — 205 text files checked, 111 binary/large skipped
```

新增/更新的组件测试覆盖：

- 默认不渲染评分/系列输入框；存在静态入口、更多信息、ISBN 复制。
- `captureInlineDrafts` / `restoreInlineFocus` / `commitInline` / `focusout` 接线。
- 详情分组标题 13px/650、无 uppercase；快捷输入、更多信息、复制样式存在。
- 网格图标四个空心方框 + 列表细线图标，无 `fill="currentColor"`。
- 桌面 28px、触控 44px；未选中 #6e6e73、选中 #1d1d1f。

### 5.2 真实 Chrome 结果

- Inspector 1440：首屏无评分/系列输入；长标题和长作者换行正常；阅读状态独占一行；评分/系列静态值可点击；ISBN 有复制；操作区滚到底可达。
- 评分行内编辑：输入 `11` 后显示错误、保留值 `11`、输入焦点仍在；Escape 取消后详情仍打开，原评分 `9.1/10` 未丢。
- 系列行内编辑：输入草稿后点击“更多信息”触发一次渲染，草稿保留、焦点仍在系列输入、滚动位置保持（120px）。
- 空字段：无评分显示“添加评分”；系列不占主信息空输入；更多信息提供“添加系列”、空出版/ISBN/豆瓣/标识符与完整编辑提示；电子书为空时只有一行文字。
- 有数据书籍：长标题/作者、9 条标签、2 个分类、3 条阅读记录、评分/系列/出版/ISBN 全部正确显示。
- 独立 Sheet 1440/390 使用同一 BookDetails 只读模式：无编辑/删除/文件入口；标题、状态、书籍信息、简介、记录、标签正常；无横向溢出。
- 视图切换：1440 grid→list（17 行）→grid；active 图标同步；无控制台错误；932 触控按钮 44px。
- 计算样式：历史封面 96px；视图按钮桌面 28px/触控 44px；SVG 16px、`fill: none`、`stroke: currentColor`；未选中 #6e6e73、选中 #1d1d1f。

## 6. 未验证 / 已知限制

- 未在真实 Safari / Firefox / iOS / Android 实机验证；软键盘、触控光标和真实 GPU 未实测。
- 行内编辑的失焦提交与再次切换字段属于交互边界：当前在焦点离开编辑器时提交，点击另一个静态编辑入口会等待当前提交完成后再进入。
- 只读详情不提供“更多信息”及空字段入口，符合公开白名单；完整编辑仍只在管理端。
- 手机横屏 Inspector 高度有限，需要滚动查看完整信息。
- 未部署、未修改真实书库。

## 7. 回滚

无数据库或后端变更。回滚本轮静态资源：

```bash
git restore public/js/book-details.js public/css/style.css \
  public/css/shelf-workbench.css public/css/liquid-glass.css \
  public/shelf.html public/*.html public/sw.js test/ui-unification.test.js
rm -rf docs/book-detail-ui-refactor
```

回滚后递增 `public/sw.js` 的 `CACHE_VERSION`（当前 `v182`），让客户端重新取资源；不要覆盖真实 `data/` 或 `auth.json`。
