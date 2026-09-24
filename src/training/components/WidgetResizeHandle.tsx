import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { nearestSizePreset, sizePresetHeight, sizePresetWidth, type WidgetSizePreset } from '../widgetSizing';

interface Props {
  title: string;
  preset: WidgetSizePreset;
  presets: WidgetSizePreset[];
  onPreview: (preset: WidgetSizePreset | null) => void;
  onCommit: (preset: WidgetSizePreset) => void;
}
/** Past a size limit the outline keeps moving with increasing resistance, like a rubber band. */
function rubberBand(value: number, min: number, max: number, give = 120) {
  const stretch = (excess: number) => (1 - 1 / (excess * 0.55 / give + 1)) * give;
  if (value < min) return min - stretch(min - value);
  if (value > max) return max + stretch(value - max);
  return value;
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  choice: WidgetSizePreset;
  ghost: HTMLElement | null;
  bounds: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };
  choices: { preset: WidgetSizePreset; width: number; height: number }[];
}

export function WidgetResizeHandle({ title, preset, presets, onPreview, onCommit }: Props) {
  const glassId = useId();
  const gesture = useRef<Gesture | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onPreview, onCommit });
  callbacks.current = { onPreview, onCommit };
  const [active, setActive] = useState(false);
  const frame = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  function flush() {
    const current = gesture.current;
    const point = pending.current;
    if (!current || !point) return;
    const width = current.width + point.x - current.x;
    const height = current.height + point.y - current.y;
    const { minWidth, maxWidth, minHeight, maxHeight } = current.bounds;
    // Size only the outline: custom properties on the card would restyle the whole widget every frame.
    if (current.ghost) {
      current.ghost.style.width = `${rubberBand(width, minWidth, maxWidth)}px`;
      current.ghost.style.height = `${rubberBand(height, minHeight, maxHeight)}px`;
    }
    const choice = nearestSizePreset(current.choices, width, height, current.choice.id);
    if (choice.id !== current.choice.id) {
      current.choice = choice;
      callbacks.current.onPreview(choice);
    }
  }
  function finish(commit: boolean) {
    cancelAnimationFrame(frame.current);
    if (commit) flush();
    const current = gesture.current;
    gesture.current = null;
    // Dropping the live size lets the outline settle onto the card's committed size.
    current?.ghost?.style.removeProperty('width');
    current?.ghost?.style.removeProperty('height');
    if (current && buttonRef.current?.hasPointerCapture(current.pointerId)) buttonRef.current.releasePointerCapture(current.pointerId);
    pending.current = null;
    setActive(false);
    if (current && commit) callbacks.current.onCommit(current.choice);
    callbacks.current.onPreview(null);
  }
  useEffect(() => {
    const cancel = () => { if (gesture.current) finish(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const move = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointerId !== event.pointerId) return;
      pending.current = { x: event.clientX, y: event.clientY };
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(flush);
    };
    const release = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointerId !== event.pointerId) return;
      pending.current = { x: event.clientX, y: event.clientY };
      finish(true);
    };
    const cancelPointer = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) finish(false);
    };
    // Listen above the card: snapping can move the corner away before pointerup is delivered.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', cancelPointer, true);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancelPointer, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, []);
  function start(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    const card = event.currentTarget.closest<HTMLElement>('[data-widget]');
    const grid = card?.parentElement;
    if (!card || !grid) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = card.getBoundingClientRect();
    const content = card.querySelector<HTMLElement>('.hub-widget-content')!.getBoundingClientRect();
    const chromeHeight = rect.height - content.height;
    const chromeWidth = rect.width - content.width;
    const narrow = grid.clientWidth <= 850;
    const choices = presets.filter(choice => !narrow || choice.columns === preset.columns || choice.contentWidth || preset.contentWidth && choice.columns === 3).map(choice => ({
        preset: choice,
        width: sizePresetWidth(choice, grid.clientWidth, chromeWidth),
        height: choice.aspectRatio || preset.aspectRatio
          ? sizePresetHeight(choice, sizePresetWidth(choice, grid.clientWidth, chromeWidth) - chromeWidth, grid.clientWidth) + chromeHeight
          : rect.height + choice.minHeight - preset.minHeight
      }));
    const ghost = card.querySelector<HTMLElement>(':scope > .hub-resize-ghost');
    const widths = choices.map(choice => choice.width);
    const heights = choices.map(choice => choice.height);
    gesture.current = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, choice: preset, ghost, choices,
      bounds: {
        minWidth: Math.min(rect.width, ...widths), maxWidth: Math.max(rect.width, ...widths, grid.getBoundingClientRect().right - rect.left),
        minHeight: Math.min(rect.height, ...heights), maxHeight: Math.max(rect.height, ...heights)
      }
    };
    if (ghost) { ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`; }
    setActive(true);
    callbacks.current.onPreview(preset);
  }
  return <button ref={buttonRef} type="button" className={`hub-widget-resize ${active ? 'is-active' : ''}`}
    aria-label={`Resize ${title}`} title="Drag to resize. Arrow keys adjust width and height. Escape cancels."
    onPointerDown={start}
    onPointerCancel={() => finish(false)} onLostPointerCapture={() => { if (gesture.current) finish(false); }}
    onKeyDown={event => {
      if (gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      let next: WidgetSizePreset | undefined;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const card = event.currentTarget.closest('[data-widget]')!;
        const contentWidth = card.querySelector('.hub-widget-content')!.getBoundingClientRect().width;
        const gridWidth = card.parentElement!.clientWidth;
        const heights = presets.filter(choice => choice.columns === preset.columns).sort((a, b) => sizePresetHeight(a, contentWidth, gridWidth) - sizePresetHeight(b, contentWidth, gridWidth));
        const index = heights.findIndex(choice => choice.id === preset.id);
        next = heights[index + (event.key === 'ArrowDown' ? 1 : -1)];
      }
      else {
        const widths = presets.filter(choice => choice.contentWidth || (preset.contentWidth ? !choice.expanded : choice.expanded === preset.expanded && choice.aspectRatio === preset.aspectRatio && choice.minHeight === preset.minHeight));
        const index = widths.findIndex(choice => choice.id === preset.id);
        next = widths[index + (event.key === 'ArrowRight' ? 1 : -1)];
      }
      if (next && next.id !== preset.id) onCommit(next);
    }}><svg className="hub-widget-resize-corner" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="white" stopOpacity=".85" />
          <stop offset=".4" stopColor="currentColor" stopOpacity=".95" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".55" />
        </linearGradient>
      </defs>
      <path className="hub-resize-glass-body" d="M6 25 H15 Q25 25 25 15 V6" stroke={`url(#${glassId})`} />
      <path className="hub-resize-glass-highlight" d="M6 22.5 H15 Q22.5 22.5 22.5 15 V6" />
    </svg></button>;
}
