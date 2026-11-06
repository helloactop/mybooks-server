import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import LiquidGlass from 'liquid-glass-react';
import { GLASS_PRESETS, resolveGlassMaterial, useGlassEnvironment, useGlassSize } from './glass-engine';
import type { GlassIntensity, GlassMaterial } from './glass-engine';
import './glass-fallback.css';

export interface GlassSurfaceProps extends Omit<ComponentPropsWithoutRef<'div'>, 'dangerouslySetInnerHTML'> {
  material?: GlassMaterial;
  intensity?: GlassIntensity;
  tone?: 'neutral' | 'accent';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  elevation?: 'none' | 'sm' | 'md' | 'lg';
  /** 控制装饰高光跟随指针；减少动态效果或触控环境下自动关闭。 */
  motion?: boolean;
}

const stationaryPointer = { x: 0, y: 0 };

/** 非交互材质容器。按钮、菜单等语义由内部组件负责。 */
export const GlassSurface = /* @__PURE__ */ forwardRef<HTMLDivElement, GlassSurfaceProps>(function GlassSurface({
  material = 'liquid',
  intensity = 'regular',
  tone = 'neutral',
  padding = 'md',
  elevation = 'md',
  motion = true,
  className,
  children,
  ...props
}, forwardedRef) {
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => root.current!, []);
  const environment = useGlassEnvironment();
  const resolved = resolveGlassMaterial(material, environment);
  const size = useGlassSize(root, resolved === 'liquid');
  const trackPointer = motion && !environment.reducedMotion && environment.finePointer;

  return (
    <div
      {...props}
      ref={root}
      className={['ui-glass-surface', className].filter(Boolean).join(' ')}
      data-material={resolved}
      data-requested-material={material}
      data-intensity={intensity}
      data-tone={tone}
      data-padding={padding}
      data-elevation={elevation}
    >
      <div className="ui-glass-surface__effect" aria-hidden="true">
        {resolved === 'liquid' && size && size.width > 0 && size.height > 0 && (
          <LiquidGlass
            key={`${size.width}:${size.height}:${size.revision}`}
            {...GLASS_PRESETS[intensity]}
            className="ui-glass-surface__liquid"
            padding="0"
            cornerRadius={0}
            elasticity={0}
            mode="standard"
            mouseContainer={root}
            globalMousePos={trackPointer ? undefined : stationaryPointer}
            mouseOffset={trackPointer ? undefined : stationaryPointer}
            style={{ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' }}
          >
            <span />
          </LiquidGlass>
        )}
      </div>
      <div className="ui-glass-surface__content">{children}</div>
    </div>
  );
});
