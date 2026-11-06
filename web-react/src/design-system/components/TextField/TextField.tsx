import { forwardRef, useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import { IconButton } from '../IconButton/IconButton';
import './text-field.css';

export type TextFieldSize = 'sm' | 'md' | 'lg';
export type TextFieldType = 'text' | 'search' | 'email' | 'url' | 'tel' | 'password' | 'number';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type' | 'children' | 'dangerouslySetInnerHTML'> {
  label: string;
  description?: string;
  error?: string;
  size?: TextFieldSize;
  type?: TextFieldType;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  startIcon?: LucideIcon;
  /** 仅 type="password" 时生效。 */
  passwordToggle?: boolean;
  /** className 和 style 属于外层；此属性用于原生 input。 */
  inputClassName?: string;
}

export const TextField = /* @__PURE__ */ forwardRef<HTMLInputElement, TextFieldProps>(function TextField({
  label, description, error, size = 'md', type = 'text', material = 'liquid',
  intensity = 'regular', startIcon: StartIcon, passwordToggle = true, inputClassName,
  id, className, style, disabled, readOnly, required,
  'aria-describedby': describedBy, 'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const [passwordVisible, setPasswordVisible] = useState(false);
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const hasError = !!error;
  const invalid = hasError || ariaInvalid === true || ariaInvalid === 'true' || ariaInvalid === 'grammar' || ariaInvalid === 'spelling';
  const descriptionIds = [...new Set([
    ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
    ...(description ? [descriptionId] : []),
    ...(hasError ? [errorId] : []),
  ])].join(' ') || undefined;

  if (import.meta.env.DEV && !label.trim()) throw new Error('TextField 的 label 必须提供非空的字段名称。');

  return (
    <div className={['ui-text-field', className].filter(Boolean).join(' ')} style={style}
      data-size={size} data-disabled={!!disabled} data-readonly={!!readOnly} data-invalid={invalid}
      data-material={actualMaterial} data-requested-material={material}>
      <label className="ui-text-field__label" htmlFor={inputId}>
        {label}{required && <span className="ui-text-field__required" aria-hidden="true"> *</span>}
      </label>
      <div className="ui-text-field__frame">
        {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
        {StartIcon && <StartIcon className="ui-text-field__icon" aria-hidden="true" focusable="false" />}
        <input {...props} ref={ref} id={inputId}
          className={['ui-text-field__input', inputClassName].filter(Boolean).join(' ')}
          type={type === 'password' && passwordVisible ? 'text' : type}
          disabled={disabled} readOnly={readOnly} required={required}
          aria-invalid={hasError ? true : ariaInvalid} aria-describedby={descriptionIds} />
        {type === 'password' && passwordToggle && (
          <IconButton className="ui-text-field__reveal" icon={passwordVisible ? EyeOff : Eye}
            label={passwordVisible ? '隐藏密码' : '显示密码'} aria-controls={inputId}
            size="sm" variant="ghost" material="solid" disabled={disabled}
            onClick={() => setPasswordVisible((visible) => !visible)} />
        )}
      </div>
      {description && <p id={descriptionId} className="ui-text-field__description">{description}</p>}
      {hasError && <p id={errorId} className="ui-text-field__error">{error}</p>}
    </div>
  );
});
