import { useLayoutEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, RefObject } from 'react';
import { shouldDismissSidebar, sidebarDragIntent } from './sidebar-gesture';

interface Drag { id: number; x: number; y: number; width: number; dragging: boolean; offset: number; lastX: number; time: number; velocity: number; }

export function useSidebarSwipe(dialogRef: RefObject<HTMLDialogElement | null>, open: boolean, onClose: () => void) {
  const gesture = useRef<Drag | null>(null);
  const frame = useRef(0);
  const returning = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const cancelFrame = () => { cancelAnimationFrame(frame.current); frame.current = 0; };
  const restore = (offset: number) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.style.setProperty('--sidebar-release-x', `${offset}px`);
    dialog.removeAttribute('data-dragging');
    dialog.setAttribute('data-returning', 'true');
    if (returning.current !== null) clearTimeout(returning.current);
    const raw = getComputedStyle(dialog).getPropertyValue('--ui-duration-exit').trim();
    const duration = parseFloat(raw) * (raw.endsWith('ms') ? 1 : 1000);
    returning.current = setTimeout(() => dialog.style.removeProperty('--sidebar-release-x'), Number.isFinite(duration) ? duration : 160);
  };
  const end = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    cancelFrame();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.dragging) return;
    suppressClick.current = true;
    const velocity = event.timeStamp - current.time > 80 ? 0 : current.velocity;
    if (!cancelled && shouldDismissSidebar(current.offset, current.width, velocity)) {
      dialogRef.current?.style.setProperty('--sidebar-release-x', `${current.offset}px`);
      latest.current();
    } else restore(current.offset);
  };
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open && dialog) {
      if (gesture.current?.dragging) dialog.style.setProperty('--sidebar-release-x', `${gesture.current.offset}px`);
      else if (dialog.hasAttribute('data-returning')) {
        const transform = getComputedStyle(dialog).transform;
        dialog.style.setProperty('--sidebar-release-x', `${transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41}px`);
      }
    }
    gesture.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    if (returning.current !== null) clearTimeout(returning.current);
    dialog?.removeAttribute('data-dragging');
    dialog?.removeAttribute('data-returning');
    if (open) {
      dialog?.style.removeProperty('--sidebar-release-x');
      dialog?.style.setProperty('--sidebar-drag-x', '0px');
    }
  }, [open, dialogRef]);
  useLayoutEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (returning.current !== null) clearTimeout(returning.current);
  }, []);
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      suppressClick.current = false;
      if (!open || !event.isPrimary || event.button !== 0 ||
        event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: dialogRef.current?.getBoundingClientRect().width ?? 0,
        dragging: false, offset: 0, lastX: event.clientX, time: event.timeStamp, velocity: 0 };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const current = gesture.current;
      const dialog = dialogRef.current;
      if (!current || !dialog || current.id !== event.pointerId) return;
      const x = event.clientX - current.x;
      const y = event.clientY - current.y;
      if (!current.dragging) {
        const intent = sidebarDragIntent(x, y);
        if (intent === 'vertical') { gesture.current = null; return; }
        if (intent !== 'horizontal') return;
        current.dragging = true;
        if (returning.current !== null) clearTimeout(returning.current);
        event.currentTarget.setPointerCapture(event.pointerId);
        dialog.style.setProperty('--sidebar-drag-x', `${Math.max(-current.width, Math.min(0, x))}px`);
        dialog.setAttribute('data-dragging', 'true');
        dialog.removeAttribute('data-returning');
      }
      event.preventDefault();
      const elapsed = event.timeStamp - current.time;
      if (elapsed > 0) current.velocity = (event.clientX - current.lastX) / elapsed;
      current.time = event.timeStamp; current.lastX = event.clientX;
      current.offset = Math.max(-current.width, Math.min(0, x));
      if (!frame.current) frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (gesture.current?.dragging) dialog.style.setProperty('--sidebar-drag-x', `${gesture.current.offset}px`);
      });
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => end(event),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => end(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => end(event, true),
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    },
  };
}
