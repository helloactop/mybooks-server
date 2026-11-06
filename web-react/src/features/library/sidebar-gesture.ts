export function sidebarDragIntent(x: number, y: number): 'pending' | 'horizontal' | 'vertical' {
  if (Math.abs(y) > 8 && Math.abs(y) > Math.abs(x)) return 'vertical';
  if (x < -8 && -x > Math.abs(y) * 1.2) return 'horizontal';
  return 'pending';
}

export function shouldDismissSidebar(offset: number, width: number, velocity: number): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;
  const distance = Math.max(0, -offset);
  return distance >= width * 0.25 || distance > 24 && velocity < -0.5;
}
