# 第三方组件与来源

后端项目代码采用 [GPL-3.0-only](LICENSE)。下列组件继续按各自许可证提供，
项目许可证不取代第三方版权声明。用户导入的图书、封面、心得不属于源码许可范围。

## Node.js 依赖

版本以 `package-lock.json` 为准，安装后的许可证保存在各包目录中。
重新分发包含 `node_modules` 的归档或容器时，应保留这些文件和间接依赖的许可声明。

| 直接依赖 | 当前锁定版本 | 包声明的许可 |
| --- | --- | --- |
| express | 4.21.2 | MIT |
| multer | 2.0.2 | MIT |
| cheerio | 1.1.2 | MIT |
| marked | 18.0.11 | MIT |
| dompurify | 3.4.14 | MPL-2.0 OR Apache-2.0 |
| yauzl | 3.2.0 | MIT |
| node-7z | 3.0.0 | ISC |
| 7zip-bin | 5.2.0 | MIT 包装；内含 7-Zip 可执行文件，按 7-Zip 自身许可（LGPL-2.1+，含 unRAR 限制）分发 |

前端通过 `/vendor/marked.umd.js` 和 `/vendor/purify.min.js` 提供安装包中的文件，
上游内嵌的许可头需要保留。依赖升级时请一并核查许可证与通知文件。

图标源 `lucide-static@1.70.0` 作为开发依赖安装，仅用于生成静态 sprite，不进入运行时；
详见下方“图标（Lucide）”。

## 图标（Lucide）

- 项目：[Lucide](https://github.com/lucide-icons/lucide)，npm 包 `lucide-static@1.70.0`。
- 文件：`public/vendor/lucide-sprite.svg`、`public/vendor/lucide/LICENSE`。
- 生成：`scripts/build-icons.mjs` 读取 `scripts/lucide-icons.json`，只把项目实际使用的图标
  包装为 `<symbol>`；不修改图标的路径数据，只去掉固定 `stroke-width` 以便按尺寸调平描边。
- 更新：修改清单后运行 `npm run icons`；`npm run check:icons` 校验生成物与引用是否漂移。
- 许可证：ISC，版权 (c) 2026 Lucide Icons and Contributors。
  ISC 与项目的 GPL-3.0-only 兼容；完整许可见 `public/vendor/lucide/LICENSE`。

## 本地打包的扫码库

- 文件：`public/vendor/html5-qrcode.min.js`
- 项目：[html5-qrcode](https://github.com/mebjas/html5-qrcode)，作者 Minhaz 与贡献者。
- 版本：2.3.8；与发布包 `html5-qrcode@2.3.8/html5-qrcode.min.js` 的 SHA-256 一致：
  `660b12437b1d747e3e68b8be0685c08cb728140110ad213f167b14b66f8b1d8e`。
- 许可证：[Apache-2.0 全文](public/vendor/html5-qrcode.LICENSE)，
  [上游原文](https://github.com/mebjas/html5-qrcode/blob/v2.3.8/LICENSE)。
- 此构建包含 ZXing 解码实现；相关上游项目为 [zxing-js/library](https://github.com/zxing-js/library)。

## Liquid Glass 位移贴图

- 文件：`public/js/liquid-glass.js`（本项目重写，无 npm/运行时依赖）、
  `public/vendor/liquid-glass/LICENSE`。
- 思路来源：[tomagranate/liquid-glass](https://github.com/tomagranate/liquid-glass)，
  包名 `@tomagranate/liquid-glass`，MIT，版权 (c) 2026 Tom。
  改编的是 `generateDisplacementMap` / `sdfRoundRect` 的圆角矩形 SDF 思路；
  实现改为 Chromium `backdrop-filter: url(#filter)` 的实时背景折射，
  并补充滤镜池、降级、生命周期与测试，不包含上游的 React/WebGL 代码。
- 参考验证：[dpawlikowski/liquid-glass](https://github.com/dpawlikowski/liquid-glass)
  （MIT，0.3.0）用于确认 SVG 滤镜进入 `backdrop-filter` 的可行性，以及
  “实时背景”与“静态背景复制层”必须区分；本项目未采用其 feTurbulence 动画。
- 许可：[MIT 全文](public/vendor/liquid-glass/LICENSE)；MIT 与 GPL-3.0-only 兼容。
- 未采用的候选：[rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)
  （React-only）与 dpawlikowski 的静态 scene 复制层（Safari/Firefox 无实时折射）。

## Python 插件运行时依赖

`toolbox-runtime/` 是独立容器，不进入 Node 进程。版本范围见
`toolbox-runtime/requirements.txt`，安装后的许可证在镜像内的包目录中。

| 直接依赖 | 用途 | 包声明的许可 |
| --- | --- | --- |
| tornado | 插件 Handler 兼容层 | Apache-2.0 |
| requests | 插件网络客户端依赖 | Apache-2.0 |
| beautifulsoup4 | 插件 HTML 解析依赖 | MIT |
| cryptography | 插件配置 AES-GCM 加密 | Apache-2.0 OR BSD-3-Clause |
| Pillow | quality_check 的图片检查 | HPND |
| lxml | quality_check / md_to_epub 的 XML 处理 | BSD-3-Clause |
| markdown-it-py | md_to_epub 的 Markdown 解析 | MIT |
| mdit-py-plugins | md_to_epub 的 Markdown 插件 | MIT |

第三方插件本身（例如 Z-Library 工具）由各自仓库提供，许可与内容合规性由插件作者
和使用者负责；本项目不把插件代码并入 GPL 源码。

## 安卓来源

配套安卓改版基于 [Huangder/Lumi_Books](https://github.com/huangder/Lumi_Books)。
安卓的 GPLv3 与字体、图标、渲染组件声明保留在其仓库的 `LICENSE` 和
`app/src/main/assets/licenses/` 中，不由本文件替代。
