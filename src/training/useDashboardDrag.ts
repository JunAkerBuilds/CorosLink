import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { dashboardDropTarget, type DashboardDropTarget } from './dashboardDrop';
import type { WidgetId } from './dashboardLayout';

export function useDashboardDrag(gridRef: RefObject<HTMLDivElement | null>, onMove: (id: WidgetId, target: DashboardDropTarget) => void) {
  const [dragged, setDragged] = useState<WidgetId | null>(null);
  const [target, setTarget] = useState<DashboardDropTarget | null>(null);
  const [height, setHeight] = useState(0);
  const point = useRef<{ x: number; y: number } | null>(null);
  const active = useRef<WidgetId | null>(null);
  const gesture = useRef<{ id: WidgetId; pointerId: number; x: number; y: number; element: HTMLElement } | null>(null);
  const commit = useRef(onMove);
  commit.current = onMove;
  function locate(x: number, y: number) {
    const grid = gridRef.current;
    if (!grid || !active.current) return null;
    const bounds = grid.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right) return null;
    return dashboardDropTarget(Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-widget]')).map(card => {
      const rect = card.getBoundingClientRect();
      return { id: card.dataset.widget!, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }), active.current, x, y);
  }
  function preview(x: number, y: number) {
    const next = locate(x, y);
    setTarget(previous => previous?.index === next?.index && previous?.startRow === next?.startRow && previous?.atBottom === next?.atBottom && previous?.anchor === next?.anchor ? previous : next);
    return next;
  }
  function cancel() {
    const current = gesture.current;
    gesture.current = null;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    active.current = null; point.current = null; setDragged(null); setTarget(null);
  }
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!active.current && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
      event.preventDefault();
      if (!active.current) { active.current = current.id; setDragged(current.id); }
      point.current = { x: event.clientX, y: event.clientY };
      preview(event.clientX, event.clientY);
    };
    const release = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointerId !== event.pointerId) return;
      const next = active.current && locate(event.clientX, event.clientY);
      if (next && active.current) commit.current(active.current, next);
      cancel();
    };
    const abort = (event: globalThis.PointerEvent) => { if (gesture.current?.pointerId === event.pointerId) cancel(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('lostpointercapture', abort);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('lostpointercapture', abort);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
    };
  }, [gridRef]);
  useEffect(() => {
    if (!dragged) return;
    let scroller = gridRef.current?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const scrollElement = scroller ?? document.scrollingElement;
    if (!scrollElement) return;
    let frame = 0;
    let previousTime = 0;
    const tick = (time: number) => {
      const current = point.current;
      if (current && active.current) {
        const bounds = scrollElement.getBoundingClientRect();
        const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom);
        if (current.x >= bounds.left && current.x <= bounds.right && current.y >= top && current.y <= bottom) {
          const speed = current.y > bottom - 64 ? (current.y - bottom + 64) / 64 : current.y < top + 64 ? (current.y - top - 64) / 64 : 0;
          const before = scrollElement.scrollTop;
          scrollElement.scrollTop += speed * Math.min(32, previousTime ? time - previousTime : 16) * .8;
          if (before !== scrollElement.scrollTop) preview(current.x, current.y);
        }
      }
      previousTime = time;
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener('blur', cancel);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('blur', cancel);
    };
  }, [dragged, gridRef]);
  return {
    dragged, target, height, cancel,
    pointerStart(event: PointerEvent<HTMLDivElement>, id: WidgetId) {
      if (event.button !== 0 || !event.isPrimary || gesture.current || (event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, element: event.currentTarget };
      setHeight(event.currentTarget.getBoundingClientRect().height);
    },
  };
}
