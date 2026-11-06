import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, SelectHTMLAttributes } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import type { GlassPopoverAlign } from '../GlassPopover/popover-position';
import { GlassPopover } from '../GlassPopover/GlassPopover';
import './select.css';

export type SelectSize = 'sm' | 'md' | 'lg';
export interface SelectOption { value: string; label: string; disabled?: boolean; }
export interface SelectOptionGroup { label: string; options: readonly SelectOption[]; disabled?: boolean; }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>,
  'children' | 'dangerouslySetInnerHTML' | 'size' | 'multiple' | 'value' | 'defaultValue' | 'role'> {
  label: string;
  options: readonly (SelectOption | SelectOptionGroup)[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  description?: string;
  error?: string;
  size?: SelectSize;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  /** className 和 style 属于外层，此属性用于表单 select。 */
  selectClassName?: string;
  triggerClassName?: string;
  /** 紧凑入口可使用固定文案，当前值仍保留在下拉选项及无障碍说明中。 */
  triggerLabel?: string;
  matchTriggerWidth?: boolean;
  popoverAlign?: GlassPopoverAlign;
  animation?: 'slide' | 'morph';
  showChevron?: boolean;
  showPlaceholderOption?: boolean;
}

export const Select = /* @__PURE__ */ forwardRef<HTMLSelectElement, SelectProps>(function Select({
  label, options, value, defaultValue, onValueChange, placeholder = '请选择', description, error,
  size = 'md', material = 'liquid', intensity = 'subtle', selectClassName, triggerClassName,
  triggerLabel, matchTriggerWidth = true, popoverAlign = 'start', animation = 'slide', showChevron = true, showPlaceholderOption = true,
  id, className, style, disabled, required, onChange, onInvalid, onFocus, form, dir,
  'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-label': ariaLabel,
  'aria-labelledby': labelledBy, tabIndex, ...props
}, ref) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const labelId = `${selectId}-label`;
  const panelId = `${selectId}-listbox`;
  const descriptionId = `${selectId}-description`;
  const errorId = `${selectId}-error`;
  const currentValueId = `${selectId}-current-value`;
  const nativeRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const [active, setActive] = useState<string | null>(null);
  const hasError = !!error;
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const entries = useMemo(() => [
    { value: '', label: placeholder, disabled: required },
    ...options.flatMap((entry) => 'options' in entry
      ? entry.options.map((option) => ({ ...option, disabled: entry.disabled || option.disabled })) : [entry]),
  ], [options, placeholder, required]);
  const optionIndexes = useMemo(() => new Map(entries.map((option, index) => [option.value, index])), [entries]);
  const selected = entries.find((option) => option.value === (value ?? internalValue)) ?? entries[0];
  const enabled = entries.filter((option) => !option.disabled);
  const activeValue = enabled.find((option) => option.value === active)?.value
    ?? enabled.find((option) => option.value === selected.value)?.value ?? enabled[0]?.value;
  const optionId = (optionValue: string) => `${panelId}-option-${optionIndexes.get(optionValue)}`;
  const descriptionIds = [...new Set([
    ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
    ...(description ? [descriptionId] : []), ...(hasError ? [errorId] : []), ...(triggerLabel ? [currentValueId] : []),
  ])].join(' ') || undefined;
  const latest = useRef({ value, defaultValue, selectedValue: selected.value, entries });
  latest.current = { value, defaultValue, selectedValue: selected.value, entries };
  useImperativeHandle(ref, () => nativeRef.current!, []);

  // 保留真实 select 的 FormData、required、外部 form 和 reset 行为；交互只通过玻璃触发器。
  useLayoutEffect(() => {
    const native = nativeRef.current!;
    const initial = entries.some((entry) => entry.value === defaultValue) ? defaultValue! : '';
    for (const option of native.options) {
      const isDefault = option.value === initial;
      if (option.defaultSelected !== isDefault) option.defaultSelected = isDefault;
    }
    native.value = latest.current.selectedValue;
  }, [entries, defaultValue]);
  useLayoutEffect(() => {
    const owner = nativeRef.current?.form;
    if (!owner) return;
    const reset = (event: Event) => queueMicrotask(() => {
      if (event.defaultPrevented || !nativeRef.current?.isConnected) return;
      const current = latest.current;
      const initial = current.entries.some((entry) => entry.value === current.defaultValue) ? current.defaultValue! : '';
      if (current.value === undefined) setInternalValue(initial);
      nativeRef.current.value = current.value === undefined ? initial : current.selectedValue;
      setOpen(false);
    });
    owner.addEventListener('reset', reset);
    return () => owner.removeEventListener('reset', reset);
  }, [form]);
  useLayoutEffect(() => {
    if (triggerRef.current?.matches(':disabled')) setOpen(false);
  });
  useLayoutEffect(() => {
    if (!open || activeValue === undefined) return;
    const option = panelRef.current?.querySelector<HTMLElement>(`[data-option-index="${optionIndexes.get(activeValue)}"]`);
    const body = panelRef.current?.querySelector<HTMLElement>('.ui-glass-popover__body');
    if (!option || !body) return;
    const row = option.getBoundingClientRect();
    const viewport = body.getBoundingClientRect();
    if (row.top < viewport.top) body.scrollTop += row.top - viewport.top - 8;
    else if (row.bottom > viewport.bottom) body.scrollTop += row.bottom - viewport.bottom + 8;
  }, [open, activeValue, optionIndexes]);

  if (import.meta.env.DEV) {
    const flattened = options.flatMap((entry) => 'options' in entry ? entry.options : [entry]);
    const groups = options.filter((entry) => 'options' in entry);
    if (!label.trim() || !placeholder.trim()) throw new Error('Select 的 label 和 placeholder 必须为非空文字。');
    if (options.some((entry) => !entry.label.trim()) || flattened.some((entry) => !entry.label.trim())) throw new Error('Select 的选项和分组 label 必须为非空文字。');
    if (flattened.some((entry) => entry.value === '') || new Set(flattened.map((entry) => entry.value)).size !== flattened.length) throw new Error('Select 的选项 value 必须非空且唯一，空字符串保留给占位提示。');
    if (new Set(groups.map((entry) => entry.label)).size !== groups.length) throw new Error('Select 的分组 label 必须唯一。');
  }
  const show = (edge?: 'first' | 'last') => {
    if (triggerRef.current?.matches(':disabled')) return;
    search.current = { text: '', time: 0 };
    setActive(edge === 'first' ? enabled[0]?.value ?? null : edge === 'last' ? enabled.at(-1)?.value ?? null
      : enabled.find((option) => option.value === selected.value)?.value ?? enabled[0]?.value ?? null);
    setOpen(true);
  };
  const choose = (next: string) => {
    if (triggerRef.current?.matches(':disabled') || !enabled.some((option) => option.value === next)) return;
    if (next !== selected.value) {
      const native = nativeRef.current!;
      native.value = next;
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.altKey && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { show(); return; }
      const index = enabled.findIndex((option) => option.value === activeValue);
      setActive(enabled[Math.max(0, Math.min(enabled.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.value ?? null);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); show(event.key === 'Home' ? 'first' : 'last');
    } else if (event.key === 'Enter' || event.key === ' ' && (!search.current.text || Date.now() - search.current.time > 700)) {
      event.preventDefault();
      if (open && activeValue !== undefined) choose(activeValue); else show();
    } else if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const character = event.key.toLocaleLowerCase();
      const text = now - search.current.time > 700 ? character : search.current.text + character;
      search.current = { text, time: now };
      const prefix = [...text].every((letter) => letter === character) ? character : text;
      const start = enabled.findIndex((option) => option.value === activeValue);
      const ordered = [...enabled.slice(start + 1), ...enabled.slice(0, start + 1)];
      const match = ordered.find((option) => option.label.toLocaleLowerCase().startsWith(prefix));
      if (match) { setActive(match.value); setOpen(true); }
    }
  };
  const renderOption = (option: SelectOption, groupDisabled = false) => {
    const blocked = !!option.disabled || groupDisabled;
    return <div key={`option:${option.value}`} id={optionId(option.value)} role="option"
      aria-selected={option.value === selected.value} aria-disabled={blocked || undefined}
      className="ui-select__option" data-active={open && option.value === activeValue && !blocked}
      data-option-index={optionIndexes.get(option.value)}
      onPointerMove={(event) => { if (!blocked && event.pointerType === 'mouse') setActive(option.value); }}
      onPointerDown={(event) => event.preventDefault()} onClick={() => { if (!blocked) choose(option.value); }}>
      <span>{option.label}</span><Check className="ui-select__check" aria-hidden="true" focusable="false" />
    </div>;
  };

  return (
    <div className={['ui-select', className].filter(Boolean).join(' ')} style={style} dir={dir} data-size={size}
      data-material={actualMaterial} data-requested-material={material}>
      <label id={labelId} className="ui-select__label" htmlFor={selectId}>{label}{required && <span className="ui-select__required" aria-hidden="true"> *</span>}</label>
      <GlassPopover ref={panelRef} id={panelId} label={label} popupRole="listbox" focusMode="trigger"
        open={open} onOpenChange={(next) => { if (next) show(); else setOpen(false); }}
        matchTriggerWidth={matchTriggerWidth} align={popoverAlign} animation={animation} maxHeight={320} material={material} intensity={intensity} className="ui-select__popover" dir={dir}
        trigger={(triggerProps) => <div className="ui-select__frame">
          {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
          <button {...triggerProps} ref={(node) => { triggerProps.ref.current = node; triggerRef.current = node; }}
            id={selectId} role="combobox" disabled={disabled} tabIndex={tabIndex}
            aria-label={ariaLabel} aria-labelledby={labelledBy ?? (ariaLabel ? undefined : labelId)}
            aria-required={required || undefined} aria-invalid={hasError ? true : ariaInvalid} aria-describedby={descriptionIds}
            aria-activedescendant={open && activeValue !== undefined ? optionId(activeValue) : undefined}
            className={['ui-select__input', triggerClassName].filter(Boolean).join(' ')}
            data-placeholder={selected.value === ''} data-show-chevron={showChevron} onKeyDown={handleKey}>
            <span className="ui-select__value" title={selected.label}>{triggerLabel ?? selected.label}</span>{showChevron && <ChevronDown className="ui-select__chevron" aria-hidden="true" focusable="false" />}
          </button>
        </div>}>
        {showPlaceholderOption && renderOption(entries[0])}
        {options.map((entry, index) => 'options' in entry
          ? <div key={`group:${entry.label}`} role="group" aria-labelledby={`${panelId}-group-${index}`} aria-disabled={entry.disabled || undefined} className="ui-select__group">
            <div id={`${panelId}-group-${index}`} className="ui-select__group-label">{entry.label}</div>
            {entry.options.map((option) => renderOption(option, !!entry.disabled))}
          </div> : renderOption(entry))}
      </GlassPopover>
      {triggerLabel && <span id={currentValueId} className="ui-select__current-value">当前选项：{selected.label}</span>}
      <select {...props} form={form} ref={nativeRef} id={`${selectId}-native`} disabled={disabled} required={required}
        value={selected.value} tabIndex={-1} aria-hidden="true"
        className={['ui-select__native', selectClassName].filter(Boolean).join(' ')}
        onFocus={(event) => { triggerRef.current?.focus({ preventScroll: true }); onFocus?.(event); }}
        onInvalid={(event) => {
          onInvalid?.(event);
          const native = event.currentTarget;
          const firstInvalid = native.form ? Array.from(native.form.elements).find((control) =>
            (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
            && control.willValidate && !control.validity.valid) : native;
          if (!event.defaultPrevented && firstInvalid === native) { triggerRef.current?.focus({ preventScroll: true }); show(); }
          event.preventDefault();
        }}
        onChange={(event) => { const next = event.currentTarget.value; if (value === undefined) setInternalValue(next); onChange?.(event); onValueChange?.(next); }}>
        <option value="" disabled={required}>{placeholder}</option>
        {options.map((entry) => 'options' in entry
          ? <optgroup key={`group:${entry.label}`} label={entry.label} disabled={entry.disabled}>{entry.options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</optgroup>
          : <option key={`option:${entry.value}`} value={entry.value} disabled={entry.disabled}>{entry.label}</option>)}
      </select>
      {description && <p id={descriptionId} className="ui-select__description">{description}</p>}
      {hasError && <p id={errorId} className="ui-select__error">{error}</p>}
    </div>
  );
});
