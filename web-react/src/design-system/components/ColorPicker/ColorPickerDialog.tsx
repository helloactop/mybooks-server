import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { GlassDialog } from '../GlassDialog/GlassDialog';
import { Button } from '../Button/Button';
import { TextField } from '../TextField/TextField';
import './color-picker-dialog.css';

interface Hsv { h: number; s: number; v: number; }

export interface ColorPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onConfirm: (value: string) => void;
  resetValue?: string;
  title?: string;
}

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

function normalizeHex(value: string): string | null {
  const match = HEX_PATTERN.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

function hexToHsv(value: string): Hsv {
  const hex = normalizeHex(value) ?? '#000000';
  const number = Number.parseInt(hex.slice(1), 16);
  const r = ((number >> 16) & 255) / 255;
  const g = ((number >> 8) & 255) / 255;
  const b = (number & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, s)) / 100;
  const brightness = Math.max(0, Math.min(100, v)) / 100;
  const chroma = brightness * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = brightness - chroma;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return '#' + rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('');
}

function ColorSlider({ label, value, max, color, onChange }: {
  label: string;
  value: number;
  max: number;
  color: string;
  onChange: (value: number) => void;
}) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return <label className="color-picker-dialog__slider">
    <span className="color-picker-dialog__slider-head"><span>{label}</span><span className="color-picker-dialog__slider-value">{Math.round(value)}</span></span>
    <input type="range" min={0} max={max} step={1} value={value} aria-label={label}
      style={{ '--color-slider-value': `${percent}%`, '--color-slider-thumb': color } as CSSProperties}
      onChange={(event) => onChange(Number(event.currentTarget.value))} />
  </label>;
}

export function ColorPickerDialog({ open, onOpenChange, value, onConfirm, resetValue, title = '设置主题色' }: ColorPickerDialogProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(normalizeHex(value) ?? '#000000'));
  const [hexText, setHexText] = useState(() => (normalizeHex(value) ?? '#000000').toUpperCase());
  const [error, setError] = useState('');
  const color = hsvToHex(hsv);

  useEffect(() => {
    if (!open) return;
    const hex = normalizeHex(value) ?? '#000000';
    setHsv(hexToHsv(hex));
    setHexText(hex.toUpperCase());
    setError('');
  }, [open, value]);

  const update = (next: Hsv) => {
    setHsv(next);
    setHexText(hsvToHex(next).toUpperCase());
    setError('');
  };
  const updateHex = (text: string) => {
    setHexText(text);
    const hex = normalizeHex(text);
    if (hex) { setHsv(hexToHsv(hex)); setError(''); }
  };
  const restore = () => {
    const target = normalizeHex(resetValue ?? '') ?? normalizeHex(value) ?? '#000000';
    update(hexToHsv(target));
  };
  const confirm = () => {
    const hex = normalizeHex(hexText);
    if (!hex) { setError('请输入 #RRGGBB 格式的颜色值'); return; }
    onConfirm(hex);
    onOpenChange(false);
  };

  return <GlassDialog open={open} onOpenChange={onOpenChange} title={title} closeLabel="关闭颜色选择" size="md"
    footer={<>
      <Button variant="ghost" material="solid" size="sm" onClick={restore} disabled={!resetValue}>恢复默认</Button>
      <Button variant="secondary" material="solid" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
      <Button material="solid" size="sm" onClick={confirm}>确定</Button>
    </>}>
    <div className="color-picker-dialog">
      <div className="color-picker-dialog__preview-wrap">
        <span className="color-picker-dialog__preview" style={{ '--color-picker-preview': color } as CSSProperties} aria-hidden="true" />
      </div>
      <div className="color-picker-dialog__sliders">
        <ColorSlider label="色相" value={hsv.h} max={360} color={color} onChange={(h) => update({ ...hsv, h })} />
        <ColorSlider label="饱和度" value={hsv.s} max={100} color={color} onChange={(s) => update({ ...hsv, s })} />
        <ColorSlider label="明度" value={hsv.v} max={100} color={color} onChange={(v) => update({ ...hsv, v })} />
      </div>
      <TextField label="颜色值 (#RRGGBB)" value={hexText} error={error || undefined} maxLength={7} autoComplete="off" spellCheck={false}
        material="solid" onChange={(event) => updateHex(event.currentTarget.value)}
        onBlur={() => {
          const hex = normalizeHex(hexText);
          if (!hex) setError('请输入 #RRGGBB 格式的颜色值');
          else { setHexText(hex.toUpperCase()); setError(''); }
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); confirm(); } }} />
    </div>
  </GlassDialog>;
}
