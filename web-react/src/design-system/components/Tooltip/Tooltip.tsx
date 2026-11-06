import { forwardRef, useCallback, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent, PointerEvent, ReactElement, RefObject } from 'react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import { getPopoverPosition } from '../GlassPopover/popover-position';
import type { GlassPopoverAlign, GlassPopoverSide } from '../GlassPopover/popover-position';
import './tooltip.css';

export interface TooltipTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  type: 'button';
  title: '';
  'aria-describedby'?: string;
  onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLButtonElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}
export interface TooltipProps {
  content: string;
  trigger: (props: TooltipTriggerProps) => ReactElement;
  id?: string;
  side?: GlassPopoverSide;
  align?: GlassPopoverAlign;
  openDelay?: number;
  closeDelay?: number;
  disabled?: boolean;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  'aria-describedby'?: string;
  onOpenChange?: (open: boolean) => void;
  /** className 和 style 属于提示面板。 */
  className?: string;
  style?: CSSProperties;
}
// 整个应用同时只显示一条 Tooltip，不需要额外 Provider 或常驻的全局监听器。
let closeActiveTooltip: (() => void) | undefined;

export const Tooltip = /* @__PURE__ */ forwardRef<HTMLDivElement, TooltipProps>(function Tooltip({
  content, trigger, id, side = 'top', align = 'center', openDelay = 400, closeDelay = 120,
  disabled = false, material = 'liquid', intensity = 'subtle', 'aria-describedby': describedBy,
  onOpenChange, className, style,
}, ref) {
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const [position, setPosition] = useState<ReturnType<typeof getPopoverPosition> | null>(null);
  const interaction = useRef({ triggerHover: false, panelHover: false, focus: false, dismissed: false });
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ disabled, onOpenChange, openDelay, closeDelay });
  latest.current = { disabled, onOpenChange, openDelay, closeDelay };
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  useImperativeHandle(ref, () => panelRef.current!, []);
  const clearTimers = useCallback(() => {
    if (opening.current !== null) clearTimeout(opening.current);
    if (closing.current !== null) clearTimeout(closing.current);
    opening.current = null; closing.current = null;
  }, []);
  const close = useCallback(() => {
    clearTimers();
    interaction.current.panelHover = false;
    if (closeActiveTooltip === close) closeActiveTooltip = undefined;
    if (!visibleRef.current) return;
    visibleRef.current = false;
    setVisible(false);
    latest.current.onOpenChange?.(false);
  }, [clearTimers]);
  const dismiss = useCallback(() => { interaction.current.dismissed = true; close(); }, [close]);
  const show = (delay: number) => {
    clearTimers();
    const commit = () => {
      opening.current = null;
      const anchor = triggerRef.current;
      if (latest.current.disabled || interaction.current.dismissed || !anchor?.isConnected || anchor.matches(':disabled')) return;
      if (!interaction.current.triggerHover && !interaction.current.focus) return;
      if (closeActiveTooltip !== close) closeActiveTooltip?.();
      closeActiveTooltip = close;
      if (visibleRef.current) return;
      visibleRef.current = true;
      setPosition(null);
      setVisible(true);
      latest.current.onOpenChange?.(true);
    };
    if (delay === 0) commit(); else opening.current = setTimeout(commit, delay);
  };
  const scheduleClose = () => {
    clearTimers();
    if (interaction.current.triggerHover || interaction.current.panelHover || interaction.current.focus) return;
    closing.current = setTimeout(close, latest.current.closeDelay);
  };
  useLayoutEffect(() => { if (disabled) dismiss(); else interaction.current.dismissed = false; }, [disabled, dismiss]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!visible || !panel) return;
    panel.showPopover();
    return () => { if (panel.matches(':popover-open')) panel.hidePopover(); };
  }, [visible]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = triggerRef.current;
    if (!visible || !panel || !anchor) return;
    let frame = 0;
    const measure = () => {
      if (!panel.matches(':popover-open')) return;
      const visual = window.visualViewport;
      const viewport = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? innerWidth, height: visual?.height ?? innerHeight };
      const rect = anchor.getBoundingClientRect();
      if (!anchor.isConnected || anchor.matches(':disabled') || !anchor.getClientRects().length || rect.bottom <= viewport.top ||
        rect.top >= viewport.top + viewport.height || rect.right <= viewport.left || rect.left >= viewport.left + viewport.width) { dismiss(); return; }
      panel.style.setProperty('--tooltip-max-width', `${Math.max(0, viewport.width - 24)}px`);
      const next = getPopoverPosition({ anchor: rect, width: panel.getBoundingClientRect().width,
        height: panel.scrollHeight + panel.offsetHeight - panel.clientHeight,
        viewport, side, align, gap: 8, padding: 12, rtl: getComputedStyle(anchor).direction === 'rtl' });
      setPosition((previous) => previous && previous.x === next.x && previous.y === next.y && previous.maxWidth === next.maxWidth &&
        previous.maxHeight === next.maxHeight && previous.side === next.side ? previous : next);
    };
    const schedule = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && panel.contains(event.target)) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); dismiss();
    };
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !anchor.contains(event.target)) dismiss();
    };
    measure();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(anchor); observer.observe(panel);
    const intersection = new IntersectionObserver(([entry]) => { if (entry && !entry.isIntersecting) dismiss(); });
    intersection.observe(anchor);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
      document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside, true);
    };
  }, [visible, side, align, content, className, style, dismiss]);
  useLayoutEffect(() => () => {
    clearTimers();
    if (closeActiveTooltip === close) closeActiveTooltip = undefined;
  }, [clearTimers, close]);

  if (import.meta.env.DEV) {
    if (!content.trim()) throw new Error('Tooltip 的 content 必须为非空文字。');
    if (![openDelay, closeDelay].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Tooltip 的延时必须为非负有限数。');
  }
  const descriptionIds = [...new Set([...(describedBy?.split(/\s+/).filter(Boolean) ?? []), ...(!disabled ? [panelId] : [])])].join(' ') || undefined;
  const panelStyle = { ...style, left: position?.x ?? 0, top: position?.y ?? 0,
    '--tooltip-max-height': position ? `${position.maxHeight}px` : undefined } as CSSProperties;
  return <>
    {trigger({ ref: triggerRef, type: 'button', title: '', 'aria-describedby': descriptionIds,
      onPointerEnter: (event) => { if (event.pointerType === 'touch') return; interaction.current.triggerHover = true; show(latest.current.openDelay); },
      onPointerLeave: () => { interaction.current.triggerHover = false; interaction.current.dismissed = false; scheduleClose(); },
      onPointerDown: dismiss,
      onFocus: () => { interaction.current.focus = true; show(0); },
      onBlur: () => { interaction.current.focus = false; interaction.current.dismissed = false; scheduleClose(); },
      onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') dismiss(); },
    })}
    <div id={panelId} ref={panelRef} popover="manual" role="tooltip" className={['ui-tooltip', className].filter(Boolean).join(' ')}
      style={panelStyle} data-material={actualMaterial} data-side={position?.side ?? side} data-positioned={!!position}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') { interaction.current.panelHover = true; clearTimers(); } }}
      onPointerLeave={() => { interaction.current.panelHover = false; scheduleClose(); }}>
      {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
      <span className="ui-tooltip__text">{content}</span>
    </div>
  </>;
});
