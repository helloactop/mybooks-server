import { memo, useId } from 'react';
import { GLASS_PRESETS } from './glass-engine';
import type { GlassIntensity, GlassMaterial } from './glass-engine';
import standardMap from './maps/rdev-standard.jpg';
import './glass-decoration.css';

interface GlassDecorationProps {
  material: Exclude<GlassMaterial, 'solid'>;
  intensity?: GlassIntensity;
}

/**
 * 原生控件的纯装饰层，HTML 部分只使用 span，保留 button 的合法内容模型。
 * 标准位移图及 RGB 折射滤镜改编自 liquid-glass-react 1.1.1。
 * Copyright 2025 MAX ROVENSKY, MIT；许可随 third-party-notices.txt 分发。
 */
export const GlassDecoration = /* @__PURE__ */ memo(function GlassDecoration({ material, intensity = 'regular' }: GlassDecorationProps) {
  const id = useId();
  const { displacementScale, aberrationIntensity } = GLASS_PRESETS[intensity];
  const displacement = -displacementScale;
  return (
    <span className="ui-glass-decoration" data-material={material} aria-hidden="true">
      {material === 'liquid' && (
        <svg className="ui-glass-decoration__definitions" aria-hidden="true" focusable="false">
          <defs>
            <filter id={id} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
              <feImage href={standardMap} x="0" y="0" width="100%" height="100%" result="map" preserveAspectRatio="xMidYMid slice" />
              {intensity !== 'strong' ? (
                <feDisplacementMap in="SourceGraphic" in2="map" scale={displacement} xChannelSelector="R" yChannelSelector="B" />
              ) : <>
              <feDisplacementMap in="SourceGraphic" in2="map" scale={displacement} xChannelSelector="R" yChannelSelector="B" result="red" />
              <feColorMatrix in="red" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale={displacement * (1 + aberrationIntensity * 0.05)} xChannelSelector="R" yChannelSelector="B" result="green" />
              <feColorMatrix in="green" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale={displacement * (1 + aberrationIntensity * 0.1)} xChannelSelector="R" yChannelSelector="B" result="blue" />
              <feColorMatrix in="blue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
              <feBlend in="g" in2="b" mode="screen" result="gb" />
              <feBlend in="r" in2="gb" mode="screen" />
              </>}
            </filter>
          </defs>
        </svg>
      )}
      <span className="ui-glass-decoration__warp" style={material === 'liquid' ? { filter: `url("#${id}")` } : undefined} />
      <span className="ui-glass-decoration__tint" />
      <span className="ui-glass-decoration__edge" />
    </span>
  );
});
