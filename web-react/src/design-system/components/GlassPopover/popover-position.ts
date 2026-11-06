export type GlassPopoverSide = 'top' | 'bottom';
export type GlassPopoverAlign = 'start' | 'center' | 'end';

export interface PopoverPositionInput {
  anchor: { left: number; right: number; top: number; bottom: number };
  width: number;
  height: number;
  viewport: { left: number; top: number; width: number; height: number };
  side: GlassPopoverSide;
  align: GlassPopoverAlign;
  gap: number;
  padding: number;
  rtl: boolean;
}

export function getPopoverPosition({ anchor, width, height, viewport, side, align, gap, padding, rtl }: PopoverPositionInput) {
  const left = viewport.left + padding;
  const right = viewport.left + viewport.width - padding;
  const top = viewport.top + padding;
  const bottom = viewport.top + viewport.height - padding;
  const maxWidth = Math.max(0, right - left);
  const actualWidth = Math.min(width, maxWidth);
  const below = Math.max(0, bottom - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - top);
  const preferredSpace = side === 'bottom' ? below : above;
  const otherSpace = side === 'bottom' ? above : below;
  const resolvedSide = height > preferredSpace && otherSpace > preferredSpace ? (side === 'bottom' ? 'top' : 'bottom') : side;
  const maxHeight = resolvedSide === 'bottom' ? below : above;
  const actualHeight = Math.min(height, maxHeight);
  let x: number;
  if (align === 'center') x = (anchor.left + anchor.right - actualWidth) / 2;
  else if ((align === 'start') !== rtl) x = anchor.left;
  else x = anchor.right - actualWidth;
  x = Math.max(left, Math.min(x, right - actualWidth));
  const idealY = resolvedSide === 'bottom' ? anchor.bottom + gap : anchor.top - gap - actualHeight;
  const y = Math.max(top, Math.min(idealY, bottom - actualHeight));
  return { x, y, maxWidth, maxHeight, side: resolvedSide };
}
