import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import './segmented-control.css';

export type SegmentedControlSize = 'sm' | 'md' | 'lg';

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>,
  'children' | 'defaultValue' | 'onChange' | 'role' | 'aria-label'> {
  label: string;
  options: readonly SegmentedControlOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: SegmentedControlSize;
  disabled?: boolean;
  fullWidth?: boolean;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
}

export const SegmentedControl = /* @__PURE__ */ forwardRef<HTMLDivElement, SegmentedControlProps>(function SegmentedControl({
  label, options, value, defaultValue, onValueChange, size = 'md', disabled = false,
  fullWidth = false, material = 'liquid', intensity = 'regular', className, style,
  ...props
}, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [internalValue, setInternalValue] = useState(() => defaultValue ?? options.find((option) => !option.disabled)?.value);
  const selectedValue = value === undefined ? internalValue : value;
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const enabled = disabled ? [] : options.filter((option) => !option.disabled);
  const tabValue = enabled.find((option) => option.value === selectedValue)?.value ?? enabled[0]?.value;
  useImperativeHandle(ref, () => rootRef.current!, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const selected = selectedValue === undefined ? undefined : optionRefs.current.get(selectedValue);
    if (!root || !selected) { setIndicator(null); return; }
    let frame = 0;
    const measure = () => {
      const next = { left: selected.offsetLeft, top: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight };
      setIndicator((previous) => previous && Object.keys(next).every((key) => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(root);
    observer?.observe(selected);
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', schedule); };
  }, [selectedValue, options, size, fullWidth, props.dir, className, style]);

  if (import.meta.env.DEV) {
    if (!label.trim()) throw new Error('SegmentedControl 的 label 必须提供非空的分组名称。');
    if (new Set(options.map((option) => option.value)).size !== options.length) throw new Error('SegmentedControl 的选项 value 必须唯一。');
    if (options.some((option) => !option.label.trim())) throw new Error('SegmentedControl 的选项 label 必须为非空文字。');
  }

  const select = (next: string) => {
    if (next === selectedValue) return;
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, currentValue: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !enabled.length) return;
    const rtl = getComputedStyle(rootRef.current!).direction === 'rtl';
    let nextIndex: number;
    const currentIndex = enabled.findIndex((option) => option.value === currentValue);
    switch (event.key) {
      case 'ArrowRight': nextIndex = currentIndex + (rtl ? -1 : 1); break;
      case 'ArrowLeft': nextIndex = currentIndex + (rtl ? 1 : -1); break;
      case 'ArrowDown': nextIndex = currentIndex + 1; break;
      case 'ArrowUp': nextIndex = currentIndex - 1; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = enabled.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const next = enabled[(nextIndex + enabled.length) % enabled.length];
    optionRefs.current.get(next.value)?.focus();
    select(next.value);
  };
  const rootStyle = { ...style, '--segment-count': Math.max(1, options.length) } as CSSProperties;

  return (
    <div {...props} ref={rootRef} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}
      className={['ui-segmented-control', className].filter(Boolean).join(' ')} style={rootStyle}
      data-size={size} data-disabled={disabled} data-full-width={fullWidth}
      data-material={actualMaterial} data-requested-material={material}>
      {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
      <span className="ui-segmented-control__indicator" aria-hidden="true" hidden={!indicator}
        style={indicator ? { width: indicator.width, height: indicator.height, transform: `translate(${indicator.left}px, ${indicator.top}px)` } : undefined}>
        {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
      </span>
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, disabled: optionDisabled }) => (
        <button key={optionValue} ref={(node) => { if (node) optionRefs.current.set(optionValue, node); else optionRefs.current.delete(optionValue); }}
          type="button" role="radio" aria-checked={optionValue === selectedValue}
          disabled={disabled || optionDisabled} tabIndex={optionValue === tabValue ? 0 : -1}
          className="ui-segmented-control__option" onClick={() => select(optionValue)}
          onKeyDown={(event) => handleKey(event, optionValue)}>
          {Icon && <Icon className="ui-segmented-control__icon" aria-hidden="true" focusable="false" />}
          <span className="ui-segmented-control__label">{optionLabel}</span>
        </button>
      ))}
    </div>
  );
});
