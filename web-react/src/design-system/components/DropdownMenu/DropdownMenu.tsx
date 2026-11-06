import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, RefCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { GlassPopover } from '../GlassPopover/GlassPopover';
import type { GlassPopoverChangeReason, GlassPopoverProps, GlassPopoverTriggerProps } from '../GlassPopover/GlassPopover';
import './dropdown-menu.css';

export interface DropdownMenuItem {
  type?: 'item';
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}
export interface DropdownMenuSeparator { type: 'separator'; id: string; }
export type DropdownMenuEntry = DropdownMenuItem | DropdownMenuSeparator;
export interface DropdownMenuTriggerProps extends Omit<GlassPopoverTriggerProps, 'ref' | 'aria-haspopup'> {
  ref: RefCallback<HTMLButtonElement>;
  'aria-haspopup': 'menu';
  disabled: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}
export interface DropdownMenuProps extends Pick<GlassPopoverProps,
  'size' | 'side' | 'align' | 'gap' | 'viewportPadding' | 'material' | 'intensity' | 'dir'> {
  label: string;
  items: readonly DropdownMenuEntry[];
  trigger: (props: DropdownMenuTriggerProps) => ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, reason: GlassPopoverChangeReason) => void;
  disabled?: boolean;
  maxHeight?: number;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export const DropdownMenu = /* @__PURE__ */ forwardRef<HTMLDivElement, DropdownMenuProps>(function DropdownMenu({
  label, items, trigger, open, defaultOpen = false, onOpenChange, disabled = false, size = 'sm',
  side = 'bottom', align = 'start', material = 'liquid', intensity = 'subtle', maxHeight = 320,
  id, className, ...props
}, ref) {
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [active, setActive] = useState<string | null>(null);
  const lastFocused = useRef<string | null>(null);
  const pointerFocusing = useRef(false);
  const search = useRef({ text: '', time: 0 });
  const isOpen = !disabled && (open ?? internalOpen);
  const enabled = useMemo(() => items.filter((item): item is DropdownMenuItem => item.type !== 'separator' && !item.disabled), [items]);
  const tabId = enabled.find((item) => item.id === active)?.id ?? enabled[0]?.id;
  const initialEdge = useRef<'first' | 'last'>('first');
  const initialId = (initialEdge.current === 'last' ? enabled.at(-1) : enabled[0])?.id;
  useImperativeHandle(ref, () => panelRef.current!, []);

  const request = (next: boolean, reason: GlassPopoverChangeReason) => {
    if (next && (disabled || triggerRef.current?.matches(':disabled'))) return;
    if (open === undefined) setInternalOpen(next);
    if (next !== isOpen) onOpenChange?.(next, reason);
    if (!next) { initialEdge.current = 'first'; search.current = { text: '', time: 0 }; }
  };
  const prepare = (edge: 'first' | 'last') => {
    initialEdge.current = edge;
    search.current = { text: '', time: 0 };
    const next = (edge === 'last' ? enabled.at(-1) : enabled[0])?.id;
    initialFocusRef.current = next ? itemRefs.current.get(next) ?? null : null;
    setActive(next ?? null);
  };
  const keepVisible = (item: HTMLButtonElement) => {
    const body = panelRef.current?.querySelector<HTMLElement>('.ui-glass-popover__body');
    if (!body) return;
    const row = item.getBoundingClientRect();
    const viewport = body.getBoundingClientRect();
    if (row.top < viewport.top) body.scrollTop += row.top - viewport.top - 8;
    else if (row.bottom > viewport.bottom) body.scrollTop += row.bottom - viewport.bottom + 8;
  };
  const focusItem = (index: number) => {
    const item = enabled[(index + enabled.length) % enabled.length];
    if (item) itemRefs.current.get(item.id)?.focus({ preventScroll: true });
  };
  const close = (reason: GlassPopoverChangeReason) => {
    triggerRef.current?.focus({ preventScroll: true });
    request(false, reason);
  };
  const activate = (item: DropdownMenuItem) => {
    if (disabled || item.disabled || triggerRef.current?.matches(':disabled')) return;
    // 先归还焦点并请求关闭，随后打开的新弹窗或浮层不会被旧菜单的关闭事件抢走焦点。
    close('action');
    item.onSelect();
  };
  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close('escape'); return; }
    if (event.key === 'Tab') {
      // 从触发按钮恢复顺序导航，浏览器继续执行本次 Tab / Shift+Tab。
      close('action'); return;
    }
    const index = enabled.findIndex((item) => item.id === lastFocused.current);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (enabled.length) focusItem(index < 0 ? (event.key === 'ArrowDown' ? 0 : enabled.length - 1) : index + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); if (enabled.length) focusItem(event.key === 'Home' ? 0 : enabled.length - 1);
    } else if (event.key.length === 1 && event.key !== ' ') {
      event.preventDefault();
      const character = event.key.toLocaleLowerCase();
      const now = Date.now();
      const text = now - search.current.time > 700 ? character : search.current.text + character;
      search.current = { text, time: now };
      const prefix = [...text].every((letter) => letter === character) ? character : text;
      const ordered = [...enabled.slice(index + 1), ...enabled.slice(0, index + 1)];
      const match = ordered.find((item) => item.label.toLocaleLowerCase().startsWith(prefix));
      if (match) itemRefs.current.get(match.id)?.focus({ preventScroll: true });
    }
  };
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current?.matches(':disabled')) request(false, 'action');
  });
  useLayoutEffect(() => { if (disabled && open === undefined) setInternalOpen(false); }, [disabled, open]);
  useLayoutEffect(() => {
    if (!isOpen) {
      initialEdge.current = 'first';
      lastFocused.current = null;
      search.current = { text: '', time: 0 };
    }
  }, [isOpen]);
  useLayoutEffect(() => {
    if (!isOpen || !lastFocused.current || enabled.some((item) => item.id === lastFocused.current)) return;
    const panel = panelRef.current;
    if (document.activeElement !== document.body && !panel?.contains(document.activeElement)) return;
    (enabled[0] ? itemRefs.current.get(enabled[0].id) : panel)?.focus({ preventScroll: true });
  }, [isOpen, enabled]);

  if (import.meta.env.DEV) {
    if (items.some((item) => !item.id.trim()) || new Set(items.map((item) => item.id)).size !== items.length) throw new Error('DropdownMenu 的条目 id 必须非空且唯一。');
    if (items.some((item) => item.type !== 'separator' && !item.label.trim())) throw new Error('DropdownMenu 的操作 label 必须为非空文字。');
  }
  return <GlassPopover {...props} id={panelId} ref={panelRef} label={label} popupRole="menu" initialFocusRef={initialFocusRef}
    open={isOpen} onOpenChange={(next, reason) => { if (next) prepare(initialEdge.current); request(next, reason); }}
    size={size} side={side} align={align} material={material} intensity={intensity} maxHeight={maxHeight}
    className={['ui-dropdown-menu', className].filter(Boolean).join(' ')} onKeyDown={handleMenuKey}
    trigger={(popoverProps) => trigger({ ...popoverProps, 'aria-haspopup': 'menu', disabled,
      ref: (node) => { popoverProps.ref.current = node; triggerRef.current = node; },
      onClick: () => { popoverProps.onClick(); if (!isOpen) prepare('first'); },
      onKeyDown: (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const edge = event.key === 'ArrowDown' ? 'first' : 'last';
        prepare(edge);
        if (isOpen) focusItem(edge === 'first' ? 0 : enabled.length - 1); else request(true, 'trigger');
      },
    })}>
    {items.map((item, index) => {
      if (item.type === 'separator') return <div key={item.id} role="separator" aria-orientation="horizontal" className="ui-dropdown-menu__separator" />;
      const Icon = item.icon;
      const labelId = `${panelId}-label-${index}`;
      const descriptionId = `${panelId}-description-${index}`;
      return <button key={item.id} type="button" role="menuitem" disabled={disabled || item.disabled}
        data-menu-item-id={item.id} data-danger={!!item.danger} tabIndex={item.id === tabId ? 0 : -1}
        aria-labelledby={labelId} aria-describedby={item.description ? descriptionId : undefined}
        className="ui-dropdown-menu__item" ref={(node) => {
          if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id);
          if (item.id === initialId) initialFocusRef.current = node;
        }}
        onFocus={(event) => {
          lastFocused.current = item.id;
          setActive(item.id);
          if (!pointerFocusing.current) keepVisible(event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse' || item.disabled || disabled) return;
          // 悬停只移动焦点，不把边缘处的半可见项目滚入视口。
          pointerFocusing.current = true;
          try { event.currentTarget.focus({ preventScroll: true }); }
          finally { pointerFocusing.current = false; }
        }}
        onClick={() => activate(item)}>
        {Icon && <Icon className="ui-dropdown-menu__icon" aria-hidden="true" focusable="false" />}
        <span className="ui-dropdown-menu__text"><span id={labelId} className="ui-dropdown-menu__label">{item.label}</span>
          {item.description && <span id={descriptionId} className="ui-dropdown-menu__description">{item.description}</span>}
        </span>
      </button>;
    })}
  </GlassPopover>;
});
