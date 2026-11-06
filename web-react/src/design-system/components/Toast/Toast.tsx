import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import './toast.css';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';
export interface ToastAction { label: string; onClick: () => void; }
export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** 毫秒；0 为手动关闭，错误或带操作的提示默认不自动关闭。 */
  duration?: number;
  /** 相同 id 替换原提示并重新计时，不重复排队。 */
  id?: string;
  action?: ToastAction;
}
export interface ToastApi {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}
export interface ToastProviderProps {
  children: ReactNode;
  maxVisible?: number;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  label?: string;
}
interface ToastRecord extends ToastOptions {
  id: string;
  version: number;
  variant: ToastVariant;
  duration: number;
  closing: boolean;
  origin: HTMLElement | null;
}
interface ToastClock { remaining: number; started: number | null; timer: ReturnType<typeof setTimeout> | null; }
const ToastContext = createContext<ToastApi | null>(null);
const icons = { success: CheckCircle2, error: CircleAlert, warning: TriangleAlert, info: Info };
const variantNames = { success: '成功', error: '错误', warning: '提醒', info: '提示' };
function pauseClock(clock: ToastClock) {
  if (clock.timer !== null) clearTimeout(clock.timer);
  if (clock.started !== null) clock.remaining = Math.max(0, clock.remaining - (performance.now() - clock.started));
  clock.timer = null;
  clock.started = null;
}
function exitDuration(element: HTMLElement | null) {
  if (!element) return 0;
  const value = getComputedStyle(element).getPropertyValue('--ui-duration-exit').trim();
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? Math.max(0, value.endsWith('ms') ? number : number * 1000) : 160;
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 必须位于 ToastProvider 内部。');
  return context;
}

export function ToastProvider({ children, maxVisible = 3, material = 'liquid', intensity = 'subtle', label = '通知' }: ToastProviderProps) {
  const providerId = useId();
  const sequence = useRef(0);
  const records = useRef<ToastRecord[]>([]);
  const [items, setItems] = useState<ToastRecord[]>([]);
  const clocks = useRef(new Map<string, ToastClock>());
  const exits = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const viewportRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(() => typeof document === 'undefined' ? null : document.body);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const announced = useRef(new Map<string, number>());
  const [polite, setPolite] = useState({ version: 0, text: '' });
  const [urgent, setUrgent] = useState({ version: 0, text: '' });
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const limit = Math.max(1, Math.min(5, Math.trunc(maxVisible) || 3));
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const visible = items.slice(0, limit);
  const hasVisible = visible.length > 0;
  const publish = useCallback((next: ToastRecord[]) => { records.current = next; setItems(next); }, []);
  const restoreFocus = useCallback((record: ToastRecord) => {
    const active = document.activeElement;
    const card = viewportRef.current?.querySelector(`[data-toast-version="${record.version}"]`);
    const origin = record.origin;
    if (active && card?.contains(active) && origin?.isConnected && !origin.closest('[inert]') &&
      !origin.matches(':disabled') && origin.getClientRects().length > 0) origin.focus({ preventScroll: true });
  }, []);
  const remove = useCallback((id: string) => {
    const clock = clocks.current.get(id);
    if (clock) pauseClock(clock);
    clocks.current.delete(id);
    exits.current.delete(id);
    announced.current.delete(id);
    publish(records.current.filter((record) => record.id !== id));
  }, [publish]);
  const dismiss = useCallback((id: string) => {
    const record = records.current.find((entry) => entry.id === id);
    if (!record || record.closing) return;
    const clock = clocks.current.get(id);
    if (clock) pauseClock(clock);
    const visibleNow = records.current.slice(0, limitRef.current).some((entry) => entry.id === id);
    const mountedCard = viewportRef.current?.querySelector(`[data-toast-version="${record.version}"]`);
    if (!visibleNow || !mountedCard) { remove(id); return; }
    restoreFocus(record);
    const duration = exitDuration(viewportRef.current);
    if (duration === 0) { remove(id); return; }
    publish(records.current.map((entry) => entry.id === id ? { ...entry, closing: true } : entry));
    exits.current.set(id, setTimeout(() => remove(id), duration));
  }, [publish, remove, restoreFocus]);
  const dismissAll = useCallback(() => {
    // 先清队列，防止退场过程中下一条提示补位。
    records.current.slice(limitRef.current).forEach((record) => remove(record.id));
    records.current.forEach((record) => dismiss(record.id));
  }, [dismiss, remove]);
  const toast = useCallback((options: ToastOptions) => {
    const variant = options.variant ?? 'info';
    const duration = options.duration ?? (variant === 'error' || options.action ? 0 : 5000);
    if (import.meta.env.DEV) {
      if (!options.title.trim()) throw new Error('Toast 的 title 必须为非空文字。');
      if (!Number.isFinite(duration) || duration < 0) throw new Error('Toast 的 duration 必须为非负有限数。');
      if (options.id !== undefined && !options.id.trim()) throw new Error('Toast 的 id 必须非空。');
      if (options.action && !options.action.label.trim()) throw new Error('Toast 操作必须提供非空 label。');
    }
    const version = ++sequence.current;
    const id = options.id ?? `${providerId}-toast-${version}`;
    const old = records.current.find((record) => record.id === id);
    const oldClock = clocks.current.get(id);
    if (oldClock) pauseClock(oldClock);
    const oldExit = exits.current.get(id);
    if (oldExit !== undefined) clearTimeout(oldExit);
    exits.current.delete(id);
    clocks.current.set(id, { remaining: duration, started: null, timer: null });
    const origin = old?.origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const record: ToastRecord = { ...options, title: options.title.trim(), id, variant, duration, version, closing: false, origin };
    publish(old ? records.current.map((entry) => entry.id === id ? record : entry) : [...records.current, record]);
    return id;
  }, [providerId, publish]);
  const api = useMemo(() => ({ toast, dismiss, dismissAll }), [toast, dismiss, dismissAll]);

  useEffect(() => {
    const changed = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    const running: ToastClock[] = [];
    if (!hidden && !hovered && !focused) {
      items.slice(0, limit).forEach((record) => {
        if (record.closing || record.duration === 0) return;
        const clock = clocks.current.get(record.id);
        if (!clock) return;
        clock.started = performance.now();
        clock.timer = setTimeout(() => dismiss(record.id), clock.remaining);
        running.push(clock);
      });
    }
    return () => running.forEach(pauseClock);
  }, [items, limit, hidden, hovered, focused, dismiss]);
  useEffect(() => {
    const newlyVisible = items.slice(0, limit).filter((record) => !record.closing && announced.current.get(record.id) !== record.version);
    if (!items.length) {
      setPolite({ version: 0, text: '' }); setUrgent({ version: 0, text: '' }); return;
    }
    newlyVisible.forEach((record) => announced.current.set(record.id, record.version));
    const message = (list: ToastRecord[]) => list.map((record) => `${variantNames[record.variant]}：${record.title}${record.description ? `。${record.description}` : ''}`).join('。');
    const regular = newlyVisible.filter((record) => record.variant !== 'error');
    const errors = newlyVisible.filter((record) => record.variant === 'error');
    if (regular.length) setPolite({ version: regular.at(-1)!.version, text: message(regular) });
    if (errors.length) setUrgent({ version: errors.at(-1)!.version, text: message(errors) });
  }, [items, limit]);

  // 原生模态 dialog 会使外部节点 inert，将通知宿主移动到当前弹窗以保持可操作。
  useLayoutEffect(() => {
    const updateHost = () => {
      const active = document.activeElement;
      const currentDialog = active instanceof Element ? active.closest<HTMLDialogElement>('dialog:modal') : null;
      const modals = document.querySelectorAll<HTMLDialogElement>('dialog:modal');
      const next = currentDialog ?? modals[modals.length - 1] ?? document.body;
      setHost((previous) => previous === next ? previous : next);
    };
    updateHost();
    const observer = new MutationObserver((changes) => {
      if (changes.some((change) => change.type === 'attributes' || [...change.addedNodes, ...change.removedNodes]
        .some((node) => node instanceof Element && (node.matches('dialog') || !!node.querySelector('dialog'))))) updateHost();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('focusin', updateHost);
    return () => { observer.disconnect(); document.removeEventListener('focusin', updateHost); };
  }, []);
  useLayoutEffect(() => { setHovered(false); setFocused(false); }, [host]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !hasVisible) return;
    viewport.showPopover();
    return () => { if (viewport.matches(':popover-open')) viewport.hidePopover(); };
  }, [host, hasVisible]);
  useLayoutEffect(() => {
    if (!hasVisible) return;
    const update = () => {
      const visual = window.visualViewport;
      const offset = visual ? Math.max(0, window.innerHeight - visual.height - visual.offsetTop) : 0;
      viewportRef.current?.style.setProperty('--toast-keyboard-offset', `${offset}px`);
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => { window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); };
  }, [host, hasVisible]);
  useEffect(() => () => {
    clocks.current.forEach(pauseClock);
    exits.current.forEach(clearTimeout);
    exits.current.clear();
  }, []);

  if (import.meta.env.DEV && (!Number.isInteger(maxVisible) || maxVisible < 1 || maxVisible > 5 || !label.trim())) {
    throw new Error('ToastProvider 的 maxVisible 必须为 1–5 的整数，label 必须非空。');
  }
  return <ToastContext.Provider value={api}>{children}{host && createPortal(<>
    <div className="ui-toast-announcer" role="status" aria-live="polite" aria-atomic="true"><span key={polite.version}>{polite.text}</span></div>
    <div className="ui-toast-announcer" role="alert" aria-atomic="true"><span key={urgent.version}>{urgent.text}</span></div>
    <div ref={viewportRef} popover="manual" role="region" aria-label={label} className="ui-toast-viewport"
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape') return;
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-toast-id]') : null;
        if (target?.dataset.toastId) { event.preventDefault(); event.stopPropagation(); dismiss(target.dataset.toastId); }
      }}>
      <ol className="ui-toast-list">{visible.map((record) => {
        const Icon = icons[record.variant];
        return <li key={record.id} role="group" aria-label={`${variantNames[record.variant]}：${record.title}`}
          className="ui-toast" data-toast-id={record.id} data-toast-version={record.version} data-state={record.closing ? 'closing' : 'open'}
          data-variant={record.variant} data-material={actualMaterial} inert={record.closing} aria-hidden={record.closing || undefined}>
          {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
          <div className="ui-toast__content"><Icon className="ui-toast__icon" aria-hidden="true" focusable="false" />
            <div className="ui-toast__text"><p className="ui-toast__title">{record.title}</p>
              {record.description && <p className="ui-toast__description">{record.description}</p>}
              {record.action && <Button className="ui-toast__action" variant="ghost" material="solid" size="sm" onClick={() => { record.action!.onClick(); dismiss(record.id); }}>{record.action.label}</Button>}
            </div>
            <IconButton className="ui-toast__close" icon={X} label={`关闭提示：${record.title}`} variant="ghost" material="solid" onClick={() => dismiss(record.id)} />
          </div>
        </li>;
      })}</ol>
      {items.length > limit && <p className="ui-toast-queue">还有 {items.length - limit} 条提示等待展示</p>}
    </div>
  </>, host)}</ToastContext.Provider>;
}
