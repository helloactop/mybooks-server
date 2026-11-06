export interface ThemePreset { name: string; value: string; }

export const DEFAULT_THEME_COLOR = '#7ab5d6';
export const THEME_PRESETS: readonly ThemePreset[] = [
  { name: '淡蓝', value: DEFAULT_THEME_COLOR },
  { name: '青绿', value: '#83c5b1' },
  { name: '丁香紫', value: '#b1a2dd' },
  { name: '杏橙', value: '#e9b382' },
  { name: '玫瑰粉', value: '#e9a3b5' },
];

const STORAGE_KEY = 'mybooks.admin.themeColor';
const DARK_TEXT: Rgb = [21, 48, 67];
const WHITE: Rgb = [255, 255, 255];
const DEFAULT_TOKENS: readonly (readonly [string, string])[] = [
  ['--ui-color-accent-rgb', '122 181 214'],
  ['--ui-color-accent', '#7ab5d6'],
  ['--ui-color-accent-hover', '#6eabce'],
  ['--ui-color-accent-active', '#63a0c3'],
  ['--ui-color-accent-soft', 'rgb(122 181 214 / 16%)'],
  ['--ui-color-on-accent', '#153043'],
  ['--ui-color-link', '#28658a'],
];

type Rgb = readonly [number, number, number];

export function normalizeThemeColor(value: string | null | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_THEME_COLOR;
}

export function readThemeColor(): string {
  try { return normalizeThemeColor(localStorage.getItem(STORAGE_KEY)); } catch { return DEFAULT_THEME_COLOR; }
}

export function storeThemeColor(value: string): void {
  try { localStorage.setItem(STORAGE_KEY, normalizeThemeColor(value)); } catch { /* 存储可禁用。 */ }
}

export function themeTextColor(value: string): string {
  const color = toRgb(normalizeThemeColor(value));
  return contrast(color, WHITE) >= contrast(color, DARK_TEXT) ? '#ffffff' : '#153043';
}

export function applyThemeColor(value: string): string {
  const color = normalizeThemeColor(value);
  const root = document.documentElement.style;
  if (color === DEFAULT_THEME_COLOR) {
    for (const [name, token] of DEFAULT_TOKENS) root.setProperty(name, token);
    return color;
  }
  const colorRgb = toRgb(color);
  root.setProperty('--ui-color-accent-rgb', colorRgb.join(' '));
  root.setProperty('--ui-color-accent', color);
  root.setProperty('--ui-color-accent-hover', toHex(mix(colorRgb, [0, 0, 0], 0.1)));
  root.setProperty('--ui-color-accent-active', toHex(mix(colorRgb, [0, 0, 0], 0.22)));
  root.setProperty('--ui-color-accent-soft', `rgb(${colorRgb.join(' ')} / 16%)`);
  root.setProperty('--ui-color-on-accent', themeTextColor(color));
  root.setProperty('--ui-color-link', linkColor(colorRgb));
  return color;
}

export function initThemeColor(): void {
  applyThemeColor(readThemeColor());
}

function toRgb(value: string): Rgb {
  const number = Number.parseInt(value.slice(1), 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function toHex(color: Rgb): string {
  return '#' + color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('');
}

function mix(from: Rgb, to: Rgb, weight: number): Rgb {
  return [from[0] + (to[0] - from[0]) * weight, from[1] + (to[1] - from[1]) * weight, from[2] + (to[2] - from[2]) * weight];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}

function contrast(first: Rgb, second: Rgb): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

function linkColor(color: Rgb): string {
  for (let weight = 0.55; weight <= 1.0001; weight += 0.05) {
    const candidate = mix(color, DARK_TEXT, weight);
    if (contrast(candidate, WHITE) >= 4.5) return toHex(candidate);
  }
  return '#153043';
}
