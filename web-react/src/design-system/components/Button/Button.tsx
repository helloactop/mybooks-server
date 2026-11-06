import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'dangerouslySetInnerHTML'> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 可选的加载文案；其所需空间始终预留，切换状态时按钮不跳宽。 */
  loadingLabel?: string;
  startIcon?: LucideIcon;
  endIcon?: LucideIcon;
  fullWidth?: boolean;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
}

export const Button = /* @__PURE__ */ forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  startIcon: StartIcon,
  endIcon: EndIcon,
  fullWidth = false,
  material = 'liquid',
  intensity = 'regular',
  disabled = false,
  type = 'button',
  className,
  'aria-busy': ariaBusy,
  ...props
}, ref) {
  const hasLoadingLabel = !!loadingLabel;
  const resolvedMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || ariaBusy}
      className={['ui-button', className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-loading={loading}
      data-full-width={fullWidth}
      data-material={resolvedMaterial}
      data-requested-material={material}
    >
      {resolvedMaterial !== 'solid' && <GlassDecoration material={resolvedMaterial} intensity={intensity} />}
      <span className="ui-button__content" aria-hidden={loading && hasLoadingLabel ? true : undefined}>
        {StartIcon && <StartIcon className="ui-button__icon" aria-hidden="true" focusable="false" />}
        <span className="ui-button__label">{children}</span>
        {EndIcon && <EndIcon className="ui-button__icon" aria-hidden="true" focusable="false" />}
      </span>
      <span className="ui-button__loading" aria-hidden={!loading || !hasLoadingLabel}>
        <LoaderCircle className="ui-button__icon ui-button__spinner" aria-hidden="true" focusable="false" />
        {hasLoadingLabel && <span className="ui-button__label">{loadingLabel}</span>}
      </span>
    </button>
  );
});
