# 原生控件的标准折射贴图

`rdev-standard.jpg` 原样摘自 npm 发布包 `liquid-glass-react@1.1.1` 的
`dist/index.esm.js` 中 `displacementMap` 数据 URI。

- 上游：https://github.com/rdev/liquid-glass-react
- Copyright 2025 MAX ROVENSKY，MIT。
- 完整许可保存在 `web-react/public/third-party-notices.txt`，构建后随产物分发。

`GlassDecoration` 使用原生 span 和 SVG 适配其折射滤镜，供 Button 等原生控件使用，
不把上游的 div 布局节点插入 button。升级上游时需核对贴图、滤镜和许可。
