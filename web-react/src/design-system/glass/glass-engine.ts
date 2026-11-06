import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

export type GlassMaterial = 'liquid' | 'frosted' | 'solid';
export type GlassIntensity = 'subtle' | 'regular' | 'strong';

export const GLASS_PRESETS = {
  subtle: { displacementScale: 16, aberrationIntensity: 0.25 },
  regular: { displacementScale: 28, aberrationIntensity: 0.5 },
  strong: { displacementScale: 42, aberrationIntensity: 0.8 },
} as const;

const queries = [
  '(prefers-reduced-motion: reduce)',
  '(prefers-reduced-transparency: reduce)',
  '(forced-colors: active)',
  '(hover: hover) and (pointer: fine)',
] as const;

export interface GlassEnvironment {
  backdrop: boolean;
  refraction: boolean;
  reducedMotion: boolean;
  reducedTransparency: boolean;
  forcedColors: boolean;
  finePointer: boolean;
}

interface BrowserGlassStore {
  media: MediaQueryList[];
  value: number;
  listeners: Set<() => void>;
  read: () => number;
  changed: () => void;
}
let browserStore: BrowserGlassStore | undefined;

function getBrowserStore() {
  if (typeof window === 'undefined') return undefined;
  if (browserStore) return browserStore;
  const supports = window.CSS?.supports.bind(window.CSS);
  const backdrop = !!supports && (supports('backdrop-filter', 'blur(1px)') || supports('-webkit-backdrop-filter', 'blur(1px)'));
  // 上游仅在 Chromium 完整支持折射；iOS 上的浏览器仍使用 WebKit。
  const ua = window.navigator.userAgent;
  const chromium = /(?:Chrome|Chromium|Edg|OPR|SamsungBrowser)\//.test(ua) && !/iPhone|iPad|iPod/.test(ua);
  const capabilities = (backdrop ? 1 : 0) | (backdrop && chromium ? 2 : 0);
  const media = queries.map((query) => window.matchMedia(query));
  const read = () => media.reduce((value, query, index) => query.matches ? value | (1 << (index + 2)) : value, capabilities);
  const store: BrowserGlassStore = { media, value: read(), listeners: new Set(), read, changed: () => {} };
  store.changed = () => {
    const next = read();
    if (next === store.value) return;
    store.value = next;
    store.listeners.forEach((listener) => listener());
  };
  browserStore = store;
  return store;
}

function snapshot() { return getBrowserStore()?.value ?? 0; }

function subscribe(listener: () => void) {
  const store = getBrowserStore();
  if (!store) return () => {};
  if (!store.listeners.size) {
    store.value = store.read();
    store.media.forEach((query) => query.addEventListener('change', store.changed));
  }
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
    if (!store.listeners.size) store.media.forEach((query) => query.removeEventListener('change', store.changed));
  };
}

export function useGlassEnvironment(): GlassEnvironment {
  const value = useSyncExternalStore(subscribe, snapshot, () => 0);
  return {
    backdrop: !!(value & 1),
    refraction: !!(value & 2),
    reducedMotion: !!(value & 4),
    reducedTransparency: !!(value & 8),
    forcedColors: !!(value & 16),
    finePointer: !!(value & 32),
  };
}

export function resolveGlassMaterial(requested: GlassMaterial, environment: GlassEnvironment): GlassMaterial {
  if (requested === 'solid' || environment.forcedColors || environment.reducedTransparency || !environment.backdrop) return 'solid';
  return requested === 'liquid' && environment.refraction ? 'liquid' : 'frosted';
}

// 保留隐藏前的有效尺寸；同尺寸重开不重建滤镜。隐藏期间 window resize 会使上游缓存归零，需在重开时刷新。
export function useGlassSize(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [size, setSize] = useState<{ width: number; height: number; revision: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let frame = 0;
    let hiddenResize = false;
    const measure = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (width <= 0 || height <= 0) return;
      const refresh = hiddenResize;
      hiddenResize = false;
      setSize((previous) => previous?.width === width && previous.height === height && !refresh ? previous :
        { width, height, revision: (previous?.revision ?? 0) + (refresh ? 1 : 0) });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    const resized = () => {
      if (element.offsetWidth <= 0 || element.offsetHeight <= 0) hiddenResize = true;
      schedule();
    };
    window.addEventListener('resize', resized);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resized);
      cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
  return enabled ? size : null;
}
