import { forwardRef, useId } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import './text-area.css';

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>,
  'children' | 'dangerouslySetInnerHTML' | 'cols'> {
  label: string;
  description?: string;
  error?: string;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  resize?: 'vertical' | 'none';
  onValueChange?: (value: string) => void;
  /** className 和 style 属于外层；此属性用于原生 textarea。 */
  textAreaClassName?: string;
}

export const TextArea = /* @__PURE__ */ forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({
  label, description, error, rows = 4, resize = 'vertical', material = 'liquid', intensity = 'subtle',
  onValueChange, textAreaClassName, id, className, style, disabled, readOnly, required, onChange,
  'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, ...props
}, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const hasError = !!error;
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const descriptionIds = [...new Set([
    ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
    ...(description ? [descriptionId] : []), ...(hasError ? [errorId] : []),
  ])].join(' ') || undefined;
  if (import.meta.env.DEV) {
    if (!label.trim()) throw new Error('TextArea 的 label 必须提供非空的字段名称。');
    if (!Number.isInteger(rows) || rows < 1) throw new Error('TextArea 的 rows 必须为正整数。');
  }
  return <div className={['ui-text-area', className].filter(Boolean).join(' ')} style={style}
    data-material={actualMaterial} data-requested-material={material} data-readonly={!!readOnly} data-resize={resize}>
    <label htmlFor={inputId} className="ui-text-area__label">{label}{required && <span className="ui-text-area__required" aria-hidden="true"> *</span>}</label>
    <div className="ui-text-area__frame">
      {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
      <textarea {...props} ref={ref} id={inputId} rows={rows} disabled={disabled} readOnly={readOnly} required={required}
        aria-invalid={hasError ? true : ariaInvalid} aria-describedby={descriptionIds}
        className={['ui-text-area__input', textAreaClassName].filter(Boolean).join(' ')}
        onChange={(event) => { const next = event.currentTarget.value; onChange?.(event); onValueChange?.(next); }} />
    </div>
    {description && <p id={descriptionId} className="ui-text-area__description">{description}</p>}
    {hasError && <p id={errorId} className="ui-text-area__error">{error}</p>}
  </div>;
});
