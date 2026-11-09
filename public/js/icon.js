/* ============================================================
 * Lucide 图标原语（全站公共）
 * 图标源：public/vendor/lucide-sprite.svg（由 scripts/build-icons.mjs 生成）
 * 加载顺序：icon.js → chrome.js → base.js → api.js → cover.js → ...
 * 只输出 aria-hidden 的装饰图标；可访问名称由图标按钮的 aria-label 承担。
 * ============================================================ */

const ICON_SPRITE = '/vendor/lucide-sprite.svg?v=2';

function icon(name, size = 16, stroke = 1.8, cls = '') {
  const className = cls ? `icon ${cls}` : 'icon';
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="${ICON_SPRITE}#${name}"></use></svg>`;
}
