# My Books · 第三轮 UI 视觉修正

- 日期：2026-10-31
- 分支：`fix/liquid-glass-visual-pass3`
- 基线：`7bd7c582976df3a84899a0f8b9898af4f39c64ae`
- 范围：`public/**`、`test/**`、`docs/**`；未改后端、数据库、同步协议
- 部署：未部署；全部截图与写入测试均在一次性演示库完成

## 1. 结果摘要

这一轮没有重写折射引擎，也没有新增样式体系。只调整既有 tokens、材质层级、书架密度和详情/表单排版：

- 控件阴影、描边和白色高光明显变轻；选中态改为中性玻璃滑块，**蓝色只用于键盘 `:focus-visible`**，状态按钮不再有持续蓝色光圈。
- `.btn-primary` 去掉蓝色渐变和发光阴影，只保留蓝色文字与细边。
- 侧栏、Inspector、弹窗改为接近实体的 Regular/Frosted 材质；遮罩不再做第二层模糊；详情里的收藏集菜单不再挂实时折射。
- 1440×900 打开 Inspector 时主区从 3 列提升为 **4 列**，卡片宽 184px，网格顶部 84px、间距 20px；主画布 / 侧栏 / Inspector 形成轻量明度层级。
- 手机详情 Sheet 改为近实体白，顶部保留轻玻璃标题条和把手（滚动后关闭按钮仍可见）；长简介默认折叠并可展开；底部操作改为「编辑主要 / 心得次要 / 移到回收站独立危险操作」。
- 手机添加书籍：作者与状态纵向排列，ISBN 输入独占一行、扫码与补全按钮另起一行，保存栏始终可触达。
- 自动化：`npm test` **560 / 560 通过**；`npm run check:public` 通过；新增 4 个第三轮静态回归测试。
- 真实浏览器回归：6 个视口无横向溢出；详情、编辑保存、快捷状态、收藏集、Escape、下滑/遮罩、玻璃档位均通过；未发现点击遮挡。打开 Inspector 时隐藏了右下冗余详情按钮，解决其与底部操作按钮的 2px 点击重叠。

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `public/css/style.css` | 收敛 control/selected tokens；移除 `.seg button.active` 蓝色内阴影；选中与焦点分离；简化 `.btn-primary`；补全 `.sel-trigger` 按压/禁用；简介折叠、底部操作分层、手机 Sheet/表单规则 |
| `public/css/liquid-glass.css` | 降低色散/高光/阴影；大面板近实体（侧栏 0.96 灰白、Inspector 0.96 白、弹窗 0.985）；`.modal` 遮罩去 blur；小菜单 0.93；保留小控件 Full 折射 |
| `public/css/shelf-workbench.css` | 网格 104→84px 顶距、32→20px 间距、`1fr` 填充；卡片最小宽 180px；侧栏 #f7f8fa / Inspector #fff；书名作者字号统一；打开 Inspector 时隐藏右下详情按钮 |
| `public/js/book-details.js` | 简介折叠/展开与真实溢出测量；底部操作重排；收藏集弹层移除 `data-glass="refract"` |
| `public/{index,shelf,rank,stats,tags,notes,login,glass-lab}.html` | 资源版本同步 |
| `public/sw.js` | `CACHE_VERSION = 'v173'`，版本清单同步 |
| `test/ui-unification.test.js` | 更新玻璃参数与版本；新增材质、层级、书架密度、详情排版 4 个回归测试 |
| `docs/liquid-glass-visual-pass3/**` | 本轮前后截图与本报告 |

资源版本：`style.css v115`、`liquid-glass.css v4`、`shelf-workbench.css v38`、`book-details.js v2`、`sw v173`。

## 3. 关键 CSS 差异

### 3.1 控件 tokens（`style.css`）

```diff
- --control-edge: rgba(0, 0, 0, 0.1);
- --control-edge-hover: rgba(0, 0, 0, 0.16);
- --control-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.82);
- --control-shadow: 0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05);
- --selected-edge: rgba(0, 102, 204, 0.38);
- --selected-marker: var(--accent);
+ --control-edge: rgba(0, 0, 0, 0.07);
+ --control-edge-hover: rgba(0, 0, 0, 0.12);
+ --control-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.6);
+ --control-shadow: 0 1px 2px rgba(0,0,0,.03), 0 3px 10px rgba(0,0,0,.035);
+ --selected-edge: rgba(0, 0, 0, 0.1);
+ --selected-marker: var(--ink-2);
```

### 3.2 选中态与键盘焦点分离

```diff
 .seg button.active {
   background: var(--selected-bg);
   border-color: var(--selected-edge);
   color: var(--control-ink);
   font-weight: 600;
-  box-shadow:
-    inset 0 1px 0 rgba(255, 255, 255, 0.95),
-    inset 0 -2px 0 rgba(0, 102, 204, 0.5),
-    var(--selected-shadow);
+  box-shadow: var(--selected-shadow);
 }
+
+:is(.seg button, .btn, .icon-btn, .sel-trigger):focus-visible {
+  outline: 2px solid var(--accent);
+  outline-offset: 2px;
+}
```

鼠标点选后计算样式实测 `outline-style: none`；`box-shadow` 仅剩白色内高光与 1px 中性阴影。

### 3.3 主按钮去掉蓝色渐变

```diff
 .btn-primary {
-  background: linear-gradient(180deg, rgba(0,102,204,.2), rgba(255,255,255,.24)), var(--control-bg);
-  border-color: rgba(0, 102, 204, 0.4);
+  background: var(--control-bg);
+  border-color: rgba(0, 102, 204, 0.26);
   color: var(--accent);
-  box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 4px 14px rgba(0,102,204,.12);
+  box-shadow: var(--control-highlight), var(--control-shadow);
 }
```

### 3.4 大面板近实体、遮罩去双重模糊（`liquid-glass.css`）

```diff
- :is(.wb-side, .wb-inspector, .modal-box) {
-   background-color: rgb(255 255 255 / .86);
-   backdrop-filter: blur(24px) saturate(140%);
-   box-shadow: 多层高光 + 红/青内边 + 大阴影;
- }
+ :is(.wb-side, .wb-inspector, .modal-box) {
+   background-image: none;
+   backdrop-filter: blur(10px) saturate(120%);
+   box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 0 0 .5px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.06);
+ }
+ .wb-side       { background-color: rgb(247 248 250 / .96); }
+ .wb-inspector  { background-color: rgb(255 255 255 / .96); }
+ .modal-box     { background-color: rgb(255 255 255 / .985); }
+
+ .modal {
+   background: rgba(20,20,24,.38);
+   backdrop-filter: none;   /* 只保留弹窗自身的一层模糊 */
+ }
```

同时将 `--liquid-chroma` 从 0.12 降到 0.06，rim/shadow 下调；小控件仍保留 SVG 位移折射，实测书架 5 个滤镜覆盖 8 个折射面。

### 3.5 书架网格（`shelf-workbench.css`）

```diff
 .wb-grid {
-  grid-template-columns: repeat(auto-fill, minmax(176px, 210px));
-  gap: 32px;
-  justify-content: center;
-  padding: 104px clamp(20px, 2.8vw, 48px) 112px;
+  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
+  gap: 20px;
+  padding: 84px clamp(20px, 2vw, 36px) 112px;
 }
```

1440×900 + Inspector 实测 4 列（184px），1920×1080 无 Inspector 为 8 列填满宽度；主画布白、侧栏 #f7f8fa、Inspector 近白，封面不挂任何模糊。

### 3.6 手机详情与添加书籍

- Sheet：`background: rgb(255 255 255 / .985)`，仅顶部 sticky 标题条 `rgba(255,255,255,.82)` + 12px blur，保留把手和轻玻璃边缘。
- 长简介：>140 字默认 3 行（桌面 4 行）折叠；渲染后测量实际溢出，宽屏能放下时自动移除“展开全文”，避免误报。实测 390：71/167px；1440：83/144px；768：完整放下、无按钮。
- 操作：`.bd-actions-main` 放编辑/心得；`.bd-delete` 独立为红色文字操作。
- 手机表单：`#bookModal .form-grid` 单列，作者与状态上下排列；ISBN 输入 `grid-column: 1/-1`，扫码/补全各占一半；保存栏在 `.book-form-body` 外保持固定可触达。

## 4. 前后截图

目录：`docs/liquid-glass-visual-pass3/`。修改前来自基线提交的独立 worktree；修改后来自一次性种子库，两组使用同一套演示数据（含一本长篇简介）。

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 1440×900 书架 | [before/shelf-1440.png](before/shelf-1440.png) | [after/shelf-1440.png](after/shelf-1440.png) |
| 1440×900 Inspector | [before/inspector-1440.png](before/inspector-1440.png) | [after/inspector-1440.png](after/inspector-1440.png) |
| 1920×1080 书架 | [before/shelf-1920.png](before/shelf-1920.png) | [after/shelf-1920.png](after/shelf-1920.png) |
| 390×844 手机书架 | [before/shelf-390.png](before/shelf-390.png) | [after/shelf-390.png](after/shelf-390.png) |
| 390×844 手机详情 | [before/detail-390.png](before/detail-390.png) | [after/detail-390.png](after/detail-390.png) |
| 390×844 添加书籍 | [before/add-390.png](before/add-390.png) | [after/add-390.png](after/add-390.png) |
| 932×430 横屏 Inspector | [before/landscape-932.png](before/landscape-932.png) | [after/landscape-932.png](after/landscape-932.png) |
| 768×1024 平板详情 | [before/tablet-768.png](before/tablet-768.png) | [after/tablet-768.png](after/tablet-768.png) |
| 390×844 详情滚动后操作 | [before/detail-390.png](before/detail-390.png) | [after/detail-390-actions.png](after/detail-390-actions.png) |

模式验证截图：[Full 1440](after/shelf-1440.png)、[Frost 1440](after/mode-frost-1440.png)、[Solid 1440](after/mode-solid-1440.png)。

主观对比结论：

- 状态选中不再出现持续蓝色光圈，选中滑块与普通按钮保持同一材质语言。
- Inspector 不再像一块发亮的半透明塑料；内容、封面和文字成为主体。
- 1440 Inspector 打开时可见 4 列，底部操作无需额外滚动即可看到。
- 手机 Sheet 不再透出书封，简介折叠后信息密度更合理；添加书籍的 ISBN 按钮不再挤压输入框。

## 5. 真实浏览器测试结果

测试环境：Windows 11、Chrome 156 headless（CDP）、1440/1920/1024/932/768/390 视口；演示库为一次性种子数据。

### 5.1 自动化

```text
npm test                 560 tests / 560 pass / 0 fail (23.5s)
npm run check:public     pass — 200 text files checked, 46 binary/large skipped
```

第三轮新增 4 个静态回归测试（材质/焦点、面板层级、书架密度、详情与手机表单），加上前两轮的 8 个，共 12 个 UI/引擎测试全部通过。

### 5.2 交互与布局实测

| 检查 | 结果 |
| --- | --- |
| 桌面 Inspector | 1440：4 列 / 184px / 顶距 84 / 间距 20；摘要折叠 83/144；操作区 bottom 795 < 900；无横向溢出 |
| 1920 书架 | 8 列填满内容区，无横向溢出 |
| 390 详情 | Sheet 内滚动；摘要 71/167；展开/收起往返正常；滚到底操作与删除按钮可见 |
| 390 添加书籍 | 表单 358px 单列；作者 364–408、状态 446–490（上下排列）；ISBN 128–172、按钮 180–220（另起一行）；保存按钮可见 |
| 768 详情 | Sheet 320–960；摘要完整显示无“展开”按钮；关闭钮 44px |
| 932 横屏 | Inspector 592–924 × 8–356；可滚动；无横向溢出；底部工具条不重叠 |
| 双击书卡 | 打开 `#bookModal`，不打开旧详情/新抽屉 |
| 快捷状态 | 未读 ↔ 在读 来回切换并恢复，无蓝色描边 |
| Inspector 编辑保存 | 标题同步到 Inspector 与网格，保存后无残留弹窗 |
| 全站抽屉编辑保存 | 保存后抽屉重新打开并显示新标题 |
| Escape 层级 | 先关收藏集弹层，Inspector 保持；再按关闭 Inspector |
| 收藏集新建 / 关闭 | chip 出现、弹层关闭 |
| 手机 Sheet 下滑 | 关闭成功；下拉把手 36×4、关闭钮 44×44 |
| 点击遮挡 | 打开 Inspector 时隐藏右下详情按钮；操作按钮点击点命中 `.bd-actions-main`，无遮挡 |
| 模式切换 | 桌面 full 5 滤镜/8 折射面；frost/solid 0；主区 1184、顶栏 1134 全程不变。手机 full 4/7，frost/solid 0，主区 390 不变 |
| 减少透明度 | 自动 Solid，0 滤镜 |
| 减少动态 | Full 保留，过渡关闭 |
| 添加书籍保存 | 手机端成功保存并出现在书架 |
| 页面控制台 | 全站页面 `window.__pageErrors` 为空 |

## 6. 未测试设备与已知限制

- **未在真实 Safari / Firefox / iOS / Android 实机验证**。本机为 Windows；Safari/Firefox 的 Frost 档位由引擎单测和强制 `?glass=frost` 验证（0 滤镜、无位移），但真实字体、滚动、安全区和合成器表现未实测。
- **未验证真实移动 GPU、软键盘顶起、iOS 旋转与安全区**。当前仅在 headless Chromium 的模拟视口与触摸事件下验证。
- Headless 截图不等于实机视觉：透明度、模糊、高光在不同 DPR/显示器上会略有差异。
- **任务书中提到的“用户提供的四张截图”未以附件或文件出现在工作区**；本轮以基线提交的真实页面截图作为修改前对照，并依据实际渲染结果做主观审查。
- 932×430 横屏 Inspector 仅 348px 高，内容需要滚动；底部预留 74px 给工具条。若希望横屏同时看到全部操作，需要单独调整该断点。
- 1920×1080 采用 8 列以消除大面积空白；如果更偏好大封面、少列，可单独加列数上限，不影响本轮四列目标。
- Full 档依赖 Chromium 对 `backdrop-filter: url()` 的支持；未来浏览器若回归会退回 Frost，不会伪造折射。
- 没有 Playwright；使用 Chrome DevTools Protocol headless 截图与交互探针。

## 7. 回滚方案

无后端/数据库/同步迁移，回滚仅涉及静态资源。

**用户层面**：书架 → 视图设置 → 玻璃效果 → 柔和/关闭，立即生效并持久化。

**源码层面**（本轮尚未提交）：

```bash
git restore public/css/style.css public/css/liquid-glass.css public/css/shelf-workbench.css \
  public/js/book-details.js public/sw.js \
  public/index.html public/shelf.html public/rank.html public/stats.html public/tags.html \
  public/notes.html public/login.html public/glass-lab.html \
  test/ui-unification.test.js
rm -rf docs/liquid-glass-visual-pass3
```

若已提交，使用 `git revert <提交>`；回滚后把 `public/sw.js` 的 `CACHE_VERSION` 再递增一次（当前 `v173`）让客户端刷新缓存。不要改写历史或强制推送。

## 8. 复现

```bash
"C:/Program Files/nodejs/node.exe" scripts/test.js
"C:/Program Files/nodejs/node.exe" scripts/check-public.mjs

# 或在 Node 已在 PATH 的环境
npm test
npm run check:public
```

截图使用一次性种子库（`MYBOOKS_SEED_DEMO=true`）与 headless CDP；未访问生产服务器。
