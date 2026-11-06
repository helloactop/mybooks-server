import { forwardRef, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { Check, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import type { BadgeTone } from '../Badge/Badge';
import '../tag.css';
import './chip.css';

export type ChipSize = 'sm' | 'md' | 'lg';
export type ChipTone = BadgeTone;
export interface ChipProps extends Omit<ComponentPropsWithoutRef<'span'>,
  'children' | 'dangerouslySetInnerHTML' | 'onClick' | 'onChange' | 'tabIndex'> {
  label: string;
  icon?: LucideIcon;
  tone?: ChipTone;
  size?: ChipSize;
  selectable?: boolean;
  selected?: boolean;
  defaultSelected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
}

export const Chip = /* @__PURE__ */ forwardRef<HTMLSpanElement, ChipProps>(function Chip({
  label, icon: Icon, tone = 'neutral', size = 'md', selectable = false, selected, defaultSelected = false,
  onSelectedChange, onRemove, removeLabel, disabled = false, material = 'solid', intensity = 'subtle',
  className, onKeyDown, ...props
}, ref) {
  const [internalSelected, setInternalSelected] = useState(defaultSelected);
  const isSelected = selectable && (selected ?? internalSelected);
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const removalName = removeLabel ?? `移除标签：${label}`;
  if (import.meta.env.DEV) {
    if (!label.trim()) throw new Error('Chip 的 label 必须提供非空文字。');
    if (onRemove && !removalName.trim()) throw new Error('Chip 的 removeLabel 必须为非空文字。');
    if (!selectable && (selected !== undefined || defaultSelected || onSelectedChange)) throw new Error('选择状态和回调需要配合 selectable 使用。');
  }
  const contents = <>
    {selectable && <Check className="ui-tag__icon ui-chip__check" aria-hidden="true" focusable="false" />}
    {Icon && <Icon className="ui-tag__icon" aria-hidden="true" focusable="false" />}
    <span className="ui-tag__label">{label}</span>
  </>;
  return <span {...props} ref={ref} className={['ui-tag ui-chip', className].filter(Boolean).join(' ')}
    data-tone={tone} data-size={size} data-selected={isSelected} data-disabled={disabled}
    data-material={actualMaterial} data-requested-material={material}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !onRemove || disabled || event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (!(event.target instanceof HTMLButtonElement) || event.target.matches(':disabled')) return;
      event.preventDefault(); event.stopPropagation(); onRemove();
    }}>
    {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
    {selectable ? <button type="button" className="ui-tag__content ui-chip__main" disabled={disabled} aria-pressed={isSelected}
      onClick={() => { const next = !isSelected; if (selected === undefined) setInternalSelected(next); onSelectedChange?.(next); }}>{contents}</button>
      : <span className="ui-tag__content ui-chip__main">{contents}</span>}
    {onRemove && <button type="button" className="ui-chip__remove" disabled={disabled} aria-label={removalName} onClick={onRemove}>
      <X className="ui-tag__icon" aria-hidden="true" focusable="false" />
    </button>}
  </span>;
});
