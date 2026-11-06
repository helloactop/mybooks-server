import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, CSSProperties, ReactElement, ReactNode, RefObject } from 'react';
import { GlassSurface } from '../../glass/GlassSurface';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import { getPopoverPosition } from './popover-position';
import type { GlassPopoverAlign, GlassPopoverSide } from './popover-position';
import './glass-popover.css';

export type GlassPopoverSize = 'sm' | 'md' | 'lg';
export type GlassPopoverChangeReason = 'trigger' | 'escape' | 'outside' | 'action' | 'anchor-hidden' | 'native';
export interface GlassPopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  type: 'button';
  popoverTarget: string;
  popoverTargetAction: 'toggle';
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-haspopup': 'dialog' | 'listbox' | 'menu';
  onClick: () => void;
}
export interface GlassPopoverContentProps { close: () => void; }
export interface GlassPopoverProps extends Omit<ComponentPropsWithoutRef<'div'>,
  'children' | 'defaultValue' | 'popover' | 'onToggle' | 'onBeforeToggle' | 'role' | 'aria-label' | 'dangerouslySetInnerHTML'> {
  label: string;
  trigger: (props: GlassPopoverTriggerProps) => ReactElement;
  children: ReactNode | ((props: GlassPopoverContentProps) => ReactNode);
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, reason: GlassPopoverChangeReason) => void;
  size?: GlassPopoverSize;
  side?: GlassPopoverSide;
  align?: GlassPopoverAlign;
  gap?: number;
  viewportPadding?: number;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Select 等复合控件保留触发器焦点，通过 aria-activedescendant 浏览列表。 */
  popupRole?: 'dialog' | 'listbox' | 'menu';
  focusMode?: 'content' | 'trigger';
  matchTriggerWidth?: boolean;
  maxHeight?: number;
  /** 从触发器原位置展开，并沿同一路径收回。默认保持已有平移动画。 */
  animation?: 'slide' | 'morph';
}

export const GlassPopover = /* @__PURE__ */ forwardRef<HTMLDivElement, GlassPopoverProps>(function GlassPopover({
  label, trigger, children, open, defaultOpen = false, onOpenChange, size = 'md', side = 'bottom', align = 'start',
  gap = 8, viewportPadding = 12, material = 'liquid', intensity = 'regular', initialFocusRef,
  popupRole = 'dialog', focusMode = 'content', matchTriggerWidth = false, maxHeight, animation = 'slide',
  id, className, style, ...props
}, ref) {
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const [nativeOpen, setNativeOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof getPopoverPosition> | null>(null);
  const reasonRef = useRef<GlassPopoverChangeReason>('native');
  const restoreFocus = useRef(false);
  const focusPending = useRef(false);
  const morphShown = useRef(false);
  const morphFrom = useRef<{ transform: string; borderRadius: string } | null>(null);
  const morphAnimations = useRef<Animation[]>([]);
  const stopMorph = () => { morphAnimations.current.forEach((item) => item.cancel()); morphAnimations.current = []; };
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = (enter: boolean) => Math.max(0, parseFloat(getComputedStyle(panelRef.current!).getPropertyValue(enter ? '--ui-duration-enter' : '--ui-duration-exit')) || 0);
  const latest = useRef({ open, onOpenChange });
  latest.current = { open, onOpenChange };
  useImperativeHandle(ref, () => panelRef.current!, []);

  const request = (next: boolean, reason: GlassPopoverChangeReason) => {
    if (next === openRef.current) return;
    reasonRef.current = reason;
    if (latest.current.open === undefined) setInternalOpen(next);
    latest.current.onOpenChange?.(next, reason);
  };
  const requestRef = useRef(request);
  requestRef.current = request;

  // 原生 auto popover 负责外部点击、Esc 与顶层堆叠，toggle 事件同步受控/非受控值。
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const showing = panel.matches(':popover-open');
    if (isOpen && !showing) panel.showPopover({ source: triggerRef.current ?? undefined });
    else if (!isOpen && showing) panel.hidePopover();
  }, [isOpen, nativeOpen]);

  useLayoutEffect(() => {
    if (!nativeOpen) return;
    const panel = panelRef.current!;
    const anchor = triggerRef.current;
    if (!anchor) return;
    let frame = 0;
    const measure = () => {
      if (!panel.matches(':popover-open')) return;
      const visual = window.visualViewport;
      const viewport = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight };
      const rect = anchor.getBoundingClientRect();
      if (!anchor.isConnected || rect.bottom <= viewport.top || rect.top >= viewport.top + viewport.height ||
        rect.right <= viewport.left || rect.left >= viewport.left + viewport.width) {
        requestRef.current(false, 'anchor-hidden');
        return;
      }
      panel.style.setProperty('--popover-viewport-width', `${Math.max(0, viewport.width - viewportPadding * 2)}px`);
      if (matchTriggerWidth) panel.style.setProperty('--popover-width', `${rect.width}px`);
      const body = panel.querySelector<HTMLElement>('.ui-glass-popover__body')!;
      const next = getPopoverPosition({ anchor: rect, width: panel.offsetWidth, height: Math.min(body.scrollHeight, maxHeight ?? Infinity),
        viewport, side, align, gap, padding: viewportPadding, rtl: getComputedStyle(anchor).direction === 'rtl' });
      if (maxHeight !== undefined) next.maxHeight = Math.min(next.maxHeight, maxHeight);
      setPosition((previous) => previous && previous.x === next.x && previous.y === next.y && previous.maxWidth === next.maxWidth &&
        previous.maxHeight === next.maxHeight && previous.side === next.side ? previous : next);
    };
    const schedule = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && panel.contains(event.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reasonRef.current = 'escape'; };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !anchor.contains(event.target)) reasonRef.current = 'outside';
    };
    measure();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(anchor);
    observer.observe(panel);
    if (contentRef.current) observer.observe(contentRef.current);
    const intersection = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) requestRef.current(false, 'anchor-hidden');
    });
    intersection.observe(anchor);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [nativeOpen, side, align, gap, viewportPadding, size, className, style, props.dir, matchTriggerWidth, maxHeight]);

  useLayoutEffect(() => {
    if (animation !== 'morph') return;
    if (!nativeOpen) { morphShown.current = false; return; }
    if (!position || !panelRef.current || !triggerRef.current) return;
    const panel = panelRef.current;
    const anchor = triggerRef.current.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (!width || !height || !anchor.width || !anchor.height) return;
    const scaleX = anchor.width / width;
    const scaleY = anchor.height / height;
    const radius = Math.min(anchor.width, anchor.height) / 2;
    const from = {
      transform: `translate(${anchor.left - position.x}px, ${anchor.top - position.y}px) scale(${scaleX}, ${scaleY})`,
      borderRadius: `${radius / scaleX}px / ${radius / scaleY}px`,
    };
    morphFrom.current = from;
    panel.style.setProperty('--popover-morph-transform', from.transform);
    panel.style.setProperty('--popover-morph-radius', from.borderRadius);
    if (morphShown.current) return;
    morphShown.current = true;
    stopMorph();
    if (reducedMotion()) return;
    const content = panel.querySelector<HTMLElement>('.ui-glass-popover__content');
    const time = duration(true);
    const easing = getComputedStyle(panel).getPropertyValue('--ui-ease-enter').trim() || 'ease-out';
    morphAnimations.current.push(panel.animate([from, { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: getComputedStyle(panel).borderRadius }], { duration: time, easing }));
    // 只淡入文字，玻璃主体始终不做透明度动画，避免背景采样发黑。
    if (content) morphAnimations.current.push(content.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: time * 0.65, delay: time * 0.25, fill: 'backwards', easing: 'ease-out',
    }));
  }, [animation, nativeOpen, position]);

  useLayoutEffect(() => () => { stopMorph(); }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!nativeOpen || !position || !panel) return;
    if (focusMode === 'trigger') {
      // 定位后的可用高度可能缩短；再次确保初始活动项位于列表滚动区域内。
      const activeId = triggerRef.current?.getAttribute('aria-activedescendant');
      const active = activeId ? document.getElementById(activeId) : null;
      const body = panel.querySelector<HTMLElement>('.ui-glass-popover__body');
      if (active && body?.contains(active)) {
        const row = active.getBoundingClientRect();
        const viewport = body.getBoundingClientRect();
        if (row.top < viewport.top) body.scrollTop += row.top - viewport.top - 8;
        else if (row.bottom > viewport.bottom) body.scrollTop += row.bottom - viewport.bottom + 8;
      }
      focusPending.current = false;
      return;
    }
    if (!focusPending.current) return;
    focusPending.current = false;
    const initial = initialFocusRef?.current;
    const first = Array.from(contentRef.current!.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .find((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
    (initial && panel.contains(initial) ? initial : first ?? (popupRole === 'menu' ? panel : panel.querySelector<HTMLElement>('.ui-glass-popover__body')) ?? panel).focus({ preventScroll: true });
  }, [nativeOpen, position, initialFocusRef, focusMode, popupRole]);

  useLayoutEffect(() => () => {
    const panel = panelRef.current;
    if (panel?.matches(':popover-open')) panel.hidePopover();
  }, []);

  if (import.meta.env.DEV) {
    if (!label.trim()) throw new Error('GlassPopover 的 label 必须提供非空的浮层名称。');
    if (![gap, viewportPadding].every((number) => Number.isFinite(number) && number >= 0)) throw new Error('GlassPopover 的 gap 和 viewportPadding 必须为非负有限数。');
    if (maxHeight !== undefined && (!Number.isFinite(maxHeight) || maxHeight <= 0)) throw new Error('GlassPopover 的 maxHeight 必须为正有限数。');
  }
  const panelStyle = { ...style, left: position?.x ?? 0, top: position?.y ?? 0,
    '--popover-max-height': position ? `${position.maxHeight}px` : undefined,
    '--popover-viewport-width': position ? `${position.maxWidth}px` : undefined } as CSSProperties;

  return <>
    {trigger({ ref: triggerRef, type: 'button', popoverTarget: panelId, popoverTargetAction: 'toggle',
      'aria-expanded': isOpen, 'aria-controls': panelId, 'aria-haspopup': popupRole,
      onClick: () => { reasonRef.current = 'trigger'; } })}
    <div {...props} id={panelId} ref={panelRef} popover="auto" role={popupRole} aria-label={label} tabIndex={-1} inert={!nativeOpen}
      className={['ui-glass-popover', className].filter(Boolean).join(' ')} style={panelStyle}
      data-size={size} data-side={position?.side ?? side} data-positioned={!!position} data-animation={animation}
      onBeforeToggle={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.newState === 'open') { morphShown.current = false; stopMorph(); focusPending.current = true; setPosition(null); }
        else {
          restoreFocus.current = reasonRef.current !== 'outside' && !!panelRef.current?.contains(document.activeElement);
          const panel = panelRef.current;
          if (animation === 'morph' && panel && morphFrom.current && !reducedMotion()) {
            const computed = getComputedStyle(panel);
            const current = { transform: computed.transform, borderRadius: computed.borderRadius };
            const content = panel.querySelector<HTMLElement>('.ui-glass-popover__content');
            const opacity = content ? getComputedStyle(content).opacity : '1';
            stopMorph();
            morphAnimations.current.push(panel.animate([current, morphFrom.current], {
              duration: duration(false), easing: computed.getPropertyValue('--ui-ease-exit').trim() || 'ease-in',
            }));
            if (content) morphAnimations.current.push(content.animate([{ opacity }, { opacity: 0 }], { duration: duration(false) * 0.5, fill: 'forwards' }));
          }
        }
      }}
      onToggle={(event) => {
        if (event.target !== event.currentTarget) return;
        const next = event.newState === 'open';
        if (next !== event.currentTarget.matches(':popover-open')) return;
        const reason = reasonRef.current;
        setNativeOpen(next);
        requestRef.current(next, reason);
        if (!next && restoreFocus.current && triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
        reasonRef.current = 'native';
      }}>
      <GlassSurface className="ui-glass-popover__surface" material={material} intensity={intensity} padding="none" elevation="lg">
        <div className="ui-glass-popover__body" tabIndex={focusMode === 'trigger' || popupRole === 'menu' ? -1 : 0}><div ref={contentRef} className="ui-glass-popover__content">
          {typeof children === 'function' ? children({ close: () => request(false, 'action') }) : children}
        </div></div>
      </GlassSurface>
    </div>
  </>;
});
