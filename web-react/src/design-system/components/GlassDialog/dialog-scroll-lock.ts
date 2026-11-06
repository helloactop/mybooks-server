// 多个模态弹窗共用页面滚动锁，最后一层关闭后恢复原来的内联样式。
let locks = 0;
let restore: (() => void) | undefined;

export function lockDialogScroll() {
  if (locks++ === 0) {
    const root = document.documentElement;
    const body = document.body;
    const rootOverflow = root.style.overflow;
    const bodyOverflow = body.style.overflow;
    const bodyPadding = body.style.paddingRight;
    const rootGutter = root.style.scrollbarGutter;
    const rootWidth = root.getBoundingClientRect().width;
    const stableGutter = CSS.supports('scrollbar-gutter', 'stable');
    const padding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
    if (stableGutter) root.style.scrollbarGutter = 'stable';
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    // 旧浏览器按实际浮点宽度补偿，避免 innerWidth/clientWidth 取整造成亚像素位移。
    if (!stableGutter) {
      const scrollbar = Math.max(0, root.getBoundingClientRect().width - rootWidth);
      if (scrollbar > 0) body.style.paddingRight = `${padding + scrollbar}px`;
    }
    restore = () => {
      root.style.overflow = rootOverflow;
      body.style.overflow = bodyOverflow;
      body.style.paddingRight = bodyPadding;
      root.style.scrollbarGutter = rootGutter;
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) { restore?.(); restore = undefined; }
  };
}
