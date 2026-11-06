import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, PointerEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { GlassSurface } from '../../glass/GlassSurface';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import { IconButton } from '../IconButton/IconButton';
import { lockDialogScroll } from './dialog-scroll-lock';
import './glass-dialog.css';

export type GlassDialogSize = 'sm' | 'md' | 'lg';
export type GlassDialogCloseReason = 'escape' | 'backdrop' | 'close-button' | 'native';

export interface GlassDialogProps extends Omit<ComponentPropsWithoutRef<'dialog'>,
  'open' | 'title' | 'children' | 'dangerouslySetInnerHTML' | 'onCancel' | 'onClose' |
  'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'aria-labelledby' | 'aria-describedby'> {
  open: boolean;
  onOpenChange: (open: boolean, reason: GlassDialogCloseReason) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: GlassDialogSize;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

function exitDuration(element: HTMLElement) {
  const value = getComputedStyle(element).getPropertyValue('--ui-duration-exit').trim();
  const duration = Number.parseFloat(value);
  return Number.isFinite(duration) ? Math.max(0, value.endsWith('ms') ? duration : duration * 1000) : 160;
}

export const GlassDialog = /* @__PURE__ */ forwardRef<HTMLDialogElement, GlassDialogProps>(function GlassDialog({
  open, onOpenChange, title, description, children, footer, size = 'md', material = 'liquid',
  intensity = 'regular', closeOnEscape = true, closeOnBackdrop = true, showCloseButton = true,
  closeLabel = '关闭弹窗', initialFocusRef, className, onKeyDown, ...props
}, ref) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const unlockRef = useRef<(() => void) | null>(null);
  const backdropDown = useRef(false);
  const [phase, setPhase] = useState<'open' | 'closing'>('open');
  useImperativeHandle(ref, () => dialogRef.current!, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let timer: number | undefined;
    if (open) {
      setPhase('open');
      if (!dialog.open) {
        unlockRef.current ??= lockDialogScroll();
        try { dialog.showModal(); }
        catch (error) { unlockRef.current(); unlockRef.current = null; throw error; }
        const target = initialFocusRef?.current;
        if (target && dialog.contains(target)) target.focus({ preventScroll: true });
      }
    } else if (dialog.open) {
      setPhase('closing');
      const finish = () => {
        if (openRef.current) return;
        if (dialog.open) dialog.close();
        unlockRef.current?.();
        unlockRef.current = null;
      };
      const duration = exitDuration(dialog);
      if (duration === 0) finish();
      else timer = window.setTimeout(finish, duration);
    }
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [open, initialFocusRef]);

  useLayoutEffect(() => () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    unlockRef.current?.();
    unlockRef.current = null;
  }, []);

  if (import.meta.env.DEV && !title.trim()) throw new Error('GlassDialog 的 title 必须为非空标题。');

  const requestClose = (reason: GlassDialogCloseReason) => {
    if (openRef.current) onOpenChange(false, reason);
  };
  const outside = (event: PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget &&
      (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog {...props} ref={dialogRef} aria-modal="true" aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      className={['ui-glass-dialog', className].filter(Boolean).join(' ')} data-size={size} data-state={phase}
      onCancel={(event) => { event.preventDefault(); if (closeOnEscape) requestClose('escape'); }}
      onClose={() => {
        // 忽略旧 close 事件：快速重新打开或 StrictMode 重挂载时，元素可能已再次处于打开状态。
        if (dialogRef.current?.open) return;
        unlockRef.current?.();
        unlockRef.current = null;
        if (openRef.current) requestClose('native');
      }}
      onPointerDown={(event) => { backdropDown.current = event.button === 0 && outside(event); }}
      onPointerUp={(event) => {
        const dismiss = backdropDown.current && event.button === 0 && outside(event);
        backdropDown.current = false;
        if (dismiss && closeOnBackdrop) requestClose('backdrop');
      }}
      onPointerCancel={() => { backdropDown.current = false; }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== 'Tab') return;
        const dialog = event.currentTarget;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
          'a[href], area[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"], audio[controls], video[controls], summary',
        )).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') &&
          element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
          .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); return; }
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
          event.preventDefault(); first.focus();
        }
      }}>
      <GlassSurface className="ui-glass-dialog__surface" material={material} intensity={intensity}
        padding="none" elevation="lg">
        <header className="ui-glass-dialog__header">
          <div className="ui-glass-dialog__heading">
            <h2 id={`${id}-title`} className="ui-glass-dialog__title">{title}</h2>
            {description && <p id={`${id}-description`} className="ui-glass-dialog__description">{description}</p>}
          </div>
          {showCloseButton && <IconButton className="ui-glass-dialog__close" icon={X} label={closeLabel}
            variant="ghost" material="solid" onClick={() => requestClose('close-button')} />}
        </header>
        <div className="ui-glass-dialog__body" tabIndex={0}>{children}</div>
        {footer && <footer className="ui-glass-dialog__footer">{footer}</footer>}
      </GlassSurface>
    </dialog>,
    document.body,
  );
});
