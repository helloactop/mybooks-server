import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { GlassDialog } from '../GlassDialog/GlassDialog';
import type { GlassDialogProps } from '../GlassDialog/GlassDialog';
import './content-dialog.css';

export interface ContentDialogProps extends GlassDialogProps {
  anchorRef?: RefObject<HTMLElement | null>;
  scrollKey?: unknown;
  onAfterClose?: () => void;
}

/** 主体居中、统一大小及滚动的业务弹窗外壳；内容由调用方提供。 */
export const ContentDialog = forwardRef<HTMLDialogElement, ContentDialogProps>(function ContentDialog({
  anchorRef, scrollKey, onAfterClose, open, className, style, size = 'lg',
  material = 'liquid', intensity = 'subtle', ...props
}, ref) {
  const root = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => root.current!, []);
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number }>();
  const afterClose = useRef(onAfterClose); afterClose.current = onAfterClose;
  useLayoutEffect(() => {
    const dialog = root.current;
    if (!dialog) return;
    const closed = () => { if (!dialog.open) afterClose.current?.(); };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, []);
  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) return;
    const anchor = anchorRef.current;
    const measure = () => {
      const r = anchor.getBoundingClientRect();
      setBounds((old) => old && old.left === r.left && old.top === r.top && old.width === r.width && old.height === r.height ? old
        : { left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(anchor);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [open, anchorRef]);
  useLayoutEffect(() => {
    if (open) { const body = root.current?.querySelector('.ui-glass-dialog__body'); if (body) body.scrollTop = 0; }
  }, [open, scrollKey]);
  const placement = { ...(bounds ? { left: bounds.left, right: `calc(100% - ${bounds.left + bounds.width}px)`, top: bounds.top,
    bottom: `calc(100% - ${bounds.top + bounds.height}px)`, width: Math.max(0, bounds.width - 32),
    '--dialog-max-height': `${Math.max(0, bounds.height - 32)}px` } : {}),
    ...style } as CSSProperties;
  return <GlassDialog {...props} ref={root} open={open} size={size} material={material} intensity={intensity}
    className={['ui-content-dialog', className].filter(Boolean).join(' ')} style={placement} />;
});
