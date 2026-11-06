import { forwardRef, useId } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import './radio-group.css';

export type RadioGroupSize = 'sm' | 'md' | 'lg';
export type RadioGroupOrientation = 'vertical' | 'horizontal';
export interface RadioGroupOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}
export interface RadioGroupProps extends Omit<ComponentPropsWithoutRef<'fieldset'>,
  'name' | 'children' | 'defaultValue' | 'dangerouslySetInnerHTML' | 'role' | 'aria-labelledby'> {
  name: string;
  label: string;
  options: readonly RadioGroupOption[];
  /** undefined 为非受控；null 表示受控但尚未选择。 */
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  description?: string;
  error?: string;
  required?: boolean;
  size?: RadioGroupSize;
  orientation?: RadioGroupOrientation;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
}

export const RadioGroup = /* @__PURE__ */ forwardRef<HTMLFieldSetElement, RadioGroupProps>(function RadioGroup({
  name, label, options, value, defaultValue, onValueChange, description, error, required = false,
  size = 'md', orientation = 'vertical', material = 'liquid', intensity = 'subtle',
  id, className, disabled, form, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const labelId = `${groupId}-label`;
  const descriptionId = `${groupId}-description`;
  const errorId = `${groupId}-error`;
  const hasError = !!error;
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  const descriptionIds = [...new Set([
    ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
    ...(description ? [descriptionId] : []), ...(hasError ? [errorId] : []),
  ])].join(' ') || undefined;

  if (import.meta.env.DEV) {
    if (!name.trim() || !label.trim()) throw new Error('RadioGroup 的 name 和 label 必须为非空字符串。');
    if (options.some((option) => !option.label.trim())) throw new Error('RadioGroup 的选项 label 必须为非空文字。');
    if (new Set(options.map((option) => option.value)).size !== options.length) throw new Error('RadioGroup 的选项 value 必须唯一。');
  }

  return (
    <fieldset {...props} ref={ref} id={groupId} role="radiogroup" disabled={disabled} form={form}
      className={['ui-radio-group', className].filter(Boolean).join(' ')} data-size={size} data-orientation={orientation}
      data-material={actualMaterial} data-requested-material={material}
      aria-labelledby={labelId} aria-describedby={descriptionIds} aria-required={required || undefined}
      aria-invalid={hasError ? true : ariaInvalid}>
      <legend id={labelId} className="ui-radio-group__legend">{label}{required && <span className="ui-radio-group__required" aria-hidden="true"> *</span>}</legend>
      {description && <p id={descriptionId} className="ui-radio-group__description">{description}</p>}
      <div className="ui-radio-group__options">
        {options.map((option, index) => {
          const optionId = `${groupId}-option-${index}`;
          const optionDescriptionId = `${optionId}-description`;
          const optionDescriptions = [option.description ? optionDescriptionId : '', hasError ? errorId : ''].filter(Boolean).join(' ') || undefined;
          return (
            <label key={option.value} className="ui-radio-group__option" htmlFor={optionId}>
              <span className="ui-radio-group__control">
                <input id={optionId} className="ui-radio-group__input" type="radio" name={name} value={option.value}
                  form={form} disabled={option.disabled} required={required}
                  checked={value === undefined ? undefined : value === option.value}
                  defaultChecked={value === undefined ? defaultValue === option.value : undefined}
                  aria-labelledby={`${optionId}-label`}
                  aria-invalid={hasError ? true : ariaInvalid} aria-describedby={optionDescriptions}
                  onChange={(event) => { if (event.currentTarget.checked) onValueChange?.(event.currentTarget.value); }} />
                <span className="ui-radio-group__box" aria-hidden="true">
                  {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
                  <span className="ui-radio-group__dot" />
                </span>
              </span>
              <span className="ui-radio-group__copy">
                <span id={`${optionId}-label`} className="ui-radio-group__text">{option.label}</span>
                {option.description && <span id={optionDescriptionId} className="ui-radio-group__option-description">{option.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {hasError && <p id={errorId} className="ui-radio-group__error">{error}</p>}
    </fieldset>
  );
});
