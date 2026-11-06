import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import './switch.css';

export type SwitchSize = 'sm' | 'md' | 'lg';
export type SwitchLabelPosition = 'start' | 'end';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size' | 'children' | 'dangerouslySetInnerHTML' | 'readOnly' | 'role' | 'aria-checked'> {
  label: string;
  description?: string;
  error?: string;
  size?: SwitchSize;
  labelPosition?: SwitchLabelPosition;
  onCheckedChange?: (checked: boolean) => void;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  /** className 和 style 属于外层，此属性用于原生 input。 */
  inputClassName?: string;
}

export const Switch = /* @__PURE__ */ forwardRef<HTMLInputElement, SwitchProps>(function Switch({
  label, description, error, size = 'md', labelPosition = 'start', onCheckedChange,
  material = 'liquid', intensity = 'subtle', inputClassName, id, className, style,
  disabled, required, onChange, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid,
  ...props
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
  if (import.meta.env.DEV && !label.trim()) throw new Error('Switch 的 label 必须提供非空的设置名称。');

  return (
    <div className={['ui-switch', className].filter(Boolean).join(' ')} style={style} data-size={size}
      data-label-position={labelPosition} data-material={actualMaterial} data-requested-material={material}>
      <label className="ui-switch__label" htmlFor={inputId}>
        <span className="ui-switch__text">{label}{required && <span className="ui-switch__required" aria-hidden="true"> *</span>}</span>
        <span className="ui-switch__control">
          <input {...props} ref={ref} id={inputId} type="checkbox" role="switch" disabled={disabled} required={required}
            className={['ui-switch__input', inputClassName].filter(Boolean).join(' ')}
            aria-invalid={hasError ? true : ariaInvalid} aria-describedby={descriptionIds}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              onChange?.(event);
              onCheckedChange?.(next);
            }} />
          <span className="ui-switch__track" aria-hidden="true">
            {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
            <span className="ui-switch__thumb" />
          </span>
        </span>
      </label>
      {description && <p id={descriptionId} className="ui-switch__description">{description}</p>}
      {hasError && <p id={errorId} className="ui-switch__error">{error}</p>}
    </div>
  );
});
