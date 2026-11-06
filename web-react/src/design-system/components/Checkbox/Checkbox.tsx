import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Check, Minus } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import './checkbox.css';

export type CheckboxSize = 'sm' | 'md' | 'lg';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size' | 'children' | 'dangerouslySetInnerHTML' | 'readOnly' | 'role' | 'aria-checked'> {
  label: string;
  description?: string;
  error?: string;
  size?: CheckboxSize;
  /** 原生半选标记，不改变 checked 或表单提交值；用户操作后由浏览器清除。 */
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  /** className 和 style 属于字段容器，此属性用于原生 input。 */
  inputClassName?: string;
}

export const Checkbox = /* @__PURE__ */ forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({
  label, description, error, size = 'md', indeterminate = false, onCheckedChange,
  material = 'liquid', intensity = 'subtle', inputClassName, id, className, style,
  disabled, required, onChange, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const hasError = !!error;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const descriptionIds = [...new Set([
    ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
    ...(description ? [descriptionId] : []), ...(hasError ? [errorId] : []),
  ])].join(' ') || undefined;
  useImperativeHandle(ref, () => inputRef.current!, []);
  useLayoutEffect(() => { if (inputRef.current) inputRef.current.indeterminate = indeterminate; }, [indeterminate]);

  if (import.meta.env.DEV && !label.trim()) throw new Error('Checkbox 的 label 必须提供非空的选项名称。');

  return (
    <div className={['ui-checkbox', className].filter(Boolean).join(' ')} style={style} data-size={size}
      data-material={actualMaterial} data-requested-material={material}>
      <label className="ui-checkbox__label" htmlFor={inputId}>
        <span className="ui-checkbox__control">
          <input {...props} ref={inputRef} id={inputId} type="checkbox" disabled={disabled} required={required}
            className={['ui-checkbox__input', inputClassName].filter(Boolean).join(' ')}
            aria-invalid={hasError ? true : ariaInvalid} aria-describedby={descriptionIds}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              onChange?.(event);
              onCheckedChange?.(next);
            }} />
          <span className="ui-checkbox__box" aria-hidden="true">
            {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
            <Check className="ui-checkbox__mark ui-checkbox__check" aria-hidden="true" focusable="false" />
            <Minus className="ui-checkbox__mark ui-checkbox__mixed" aria-hidden="true" focusable="false" />
          </span>
        </span>
        <span className="ui-checkbox__text">{label}{required && <span className="ui-checkbox__required" aria-hidden="true"> *</span>}</span>
      </label>
      {description && <p id={descriptionId} className="ui-checkbox__description">{description}</p>}
      {hasError && <p id={errorId} className="ui-checkbox__error">{error}</p>}
    </div>
  );
});
