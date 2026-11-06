import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { GlassDecoration } from '../../glass/GlassDecoration';
import { resolveGlassMaterial, useGlassEnvironment } from '../../glass/glass-engine';
import type { GlassIntensity, GlassMaterial } from '../../glass/glass-engine';
import '../tag.css';
import './badge.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export type BadgeSize = 'sm' | 'md' | 'lg';
export interface BadgeProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'dangerouslySetInnerHTML'> {
  children: string | number;
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: LucideIcon;
  material?: GlassMaterial;
  intensity?: GlassIntensity;
}

export const Badge = /* @__PURE__ */ forwardRef<HTMLSpanElement, BadgeProps>(function Badge({
  children, tone = 'neutral', size = 'md', icon: Icon, material = 'solid', intensity = 'subtle', className, ...props
}, ref) {
  const actualMaterial = resolveGlassMaterial(material, useGlassEnvironment());
  if (import.meta.env.DEV && (typeof children === 'string' ? !children.trim() : !Number.isFinite(children))) {
    throw new Error('Badge 必须提供非空文字或有限数字。');
  }
  return <span {...props} ref={ref} className={['ui-tag ui-badge', className].filter(Boolean).join(' ')}
    data-tone={tone} data-size={size} data-material={actualMaterial} data-requested-material={material}>
    {actualMaterial !== 'solid' && <GlassDecoration material={actualMaterial} intensity={intensity} />}
    <span className="ui-tag__content">{Icon && <Icon className="ui-tag__icon" aria-hidden="true" focusable="false" />}<span className="ui-tag__label">{children}</span></span>
  </span>;
});
