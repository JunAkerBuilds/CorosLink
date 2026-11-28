"use client";
import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { moveKey } from "@/lib/dashboard";
import { t } from "@/lib/i18n";

/**
 * The Dashboard's grid. Customise puts it in edit mode: the widgets jiggle, a widget picked up follows the
 * pointer while the others glide out of its way, and on letting go it springs into its place. Space picks a
 * focused widget up and the arrow keys move it; Delete hides it.
 */
export interface BoardItem<K extends string> { key: K; label: string; span: string; node: ReactNode }

/** What the page calls just before it changes which widgets are shown, so the rest glide to their new places. */
export interface BoardHandle { prepare(): void }

/** A soft spring: overshoots a hair and settles. */
const SPRING = "cubic-bezier(0.3, 1.32, 0.45, 1)";
const SETTLE_MS = 480;
const LIFT = "scale(1.035)";
/** How far the pointer goes before a press becomes a drag. */
const SLOP = 4;
/** The least time between two swaps, so a card never flickers between two places. */
const SWAP_GAP_MS = 90;
/** Within this many pixels of the scroller's top or bottom the page scrolls itself, up to 18 px a frame. */
const EDGE = 72;

interface Drag<K> {
  key: K; id: number;
  x: number; y: number; startX: number; startY: number;
  /** Where in the card it was taken, from its top left. */
  grabX: number; grabY: number;
  live: boolean;
  order: K[];
  /** The card it last swapped with, left alone until the pointer leaves it. */
  guard: K | null; at: number;
  scroller: HTMLElement; vy: number; raf: number;
}

const stillMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollerOf(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function Board<K extends string>({ items, editing, onReorder, onHide, ref }: {
  items: BoardItem<K>[];
  editing: boolean;
  /** The shown widgets in their new order. */
  onReorder: (shown: K[]) => void;
  onHide: (key: K) => void;
  ref?: Ref<BoardHandle>;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<K, HTMLDivElement>());
  const flips = useRef(new Map<K, Animation>());
  const before = useRef<Map<K, DOMRect> | null>(null);
  const drag = useRef<Drag<K> | null>(null);
  const [preview, setPreview] = useState<K[] | null>(null);
  const [lifted, setLifted] = useState<K | null>(null);
  const [grabbedKey, setGrabbed] = useState<K | null>(null);
  const [said, setSaid] = useState("");
  const hint = useId();

  const byKey = new Map(items.map((i) => [i.key, i]));
  const order = (preview ?? items.map((i) => i.key)).filter((k) => byKey.has(k));
  const grabbed = editing ? grabbedKey : null;

  /** Where every card is now, so the next layout can start each one from there. */
  const snapshot = () => {
    const m = new Map<K, DOMRect>();
    slots.current.forEach((el, k) => m.set(k, el.getBoundingClientRect()));
    before.current = m;
  };
  useImperativeHandle(ref, () => ({ prepare: snapshot }));

  /** The dragged card under the pointer, and the drop well where it will land. */
  const place = () => {
    const d = drag.current, board = boardRef.current;
    if (!d?.live || !board) return;
    const el = slots.current.get(d.key);
    if (!el) return;
    const b = board.getBoundingClientRect();
    el.style.transform = `translate(${d.x - d.grabX - b.left - el.offsetLeft}px, ${d.y - d.grabY - b.top - el.offsetTop}px) ${LIFT}`;
    const well = dropRef.current;
    if (!well) return;
    well.style.width = `${el.offsetWidth}px`;
    well.style.height = `${el.offsetHeight}px`;
    well.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
    if (!well.dataset.ready) { void well.offsetWidth; well.dataset.ready = "1"; }
  };

  /** Swaps the dragged card onto the card under the pointer, measured where cards sit, not where they are gliding. */
  const hit = () => {
    const d = drag.current, board = boardRef.current;
    if (!d?.live || !board) return;
    const b = board.getBoundingClientRect();
    let over: K | null = null;
    for (const [k, el] of slots.current) {
      if (k === d.key) continue;
      const left = b.left + el.offsetLeft, top = b.top + el.offsetTop;
      if (d.x >= left && d.x < left + el.offsetWidth && d.y >= top && d.y < top + el.offsetHeight) over = k;
    }
    if (over !== d.guard) d.guard = null;
    if (over == null || over === d.guard || performance.now() - d.at < SWAP_GAP_MS) return;
    d.guard = over;
    d.at = performance.now();
    snapshot();
    d.order = moveKey(d.order, d.key, over);
    setPreview(d.order);
  };

  const autoscroll = () => {
    const d = drag.current;
    if (!d) return;
    const s = d.scroller;
    const r = s === document.scrollingElement ? { top: 0, bottom: innerHeight } : s.getBoundingClientRect();
    const push = d.y < r.top + EDGE ? d.y - (r.top + EDGE) : d.y > r.bottom - EDGE ? d.y - (r.bottom - EDGE) : 0;
    d.vy = (Math.max(-EDGE, Math.min(EDGE, push)) / EDGE) * 18;
    if (!d.vy || d.raf) return;
    const tick = () => {
      const now = drag.current;
      if (!now?.live || !now.vy) { if (now) now.raf = 0; return; }
      now.scroller.scrollTop += now.vy;
      place();
      hit();
      now.raf = requestAnimationFrame(tick);
    };
    d.raf = requestAnimationFrame(tick);
  };

  // Every card from where it was to where it is now (FLIP), and the dragged one kept under the pointer.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (was) {
      const still = stillMotion();
      slots.current.forEach((el, k) => {
        if (drag.current?.live && k === drag.current.key) return;
        flips.current.get(k)?.cancel();
        if (still) return;
        const from = was.get(k);
        if (!from) {
          // Brought back: it pops in where it lands, instead of the page's slower rise-in.
          el.firstElementChild?.getAnimations().forEach((a) => a.cancel());
          flips.current.set(k, el.animate([{ transform: "scale(0.86)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: SPRING }));
          return;
        }
        const now = el.getBoundingClientRect();
        const dx = from.left - now.left, dy = from.top - now.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        flips.current.set(k, el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SETTLE_MS, easing: SPRING }));
      });
    }
    place();
  });

  const down = (k: K, e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing || e.button !== 0 || drag.current) return;
    const el = e.currentTarget;
    flips.current.get(k)?.cancel();
    const r = el.getBoundingClientRect();
    drag.current = {
      key: k, id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
      grabX: e.clientX - r.left, grabY: e.clientY - r.top, live: false, order: [...order], guard: null, at: 0,
      scroller: scrollerOf(boardRef.current), vy: 0, raf: 0,
    };
    el.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.live) {
      if (Math.hypot(d.x - d.startX, d.y - d.startY) < SLOP) return;
      d.live = true;
      setLifted(d.key);
      setGrabbed(null);
    }
    place();
    hit();
    autoscroll();
  };

  const end = (e: React.PointerEvent<HTMLDivElement>, keep: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    if (!d.live) return;
    const el = slots.current.get(d.key);
    if (el) {
      const from = el.style.transform;
      el.style.transform = "";
      if (!stillMotion()) flips.current.set(d.key, el.animate([{ transform: from }, { transform: "none" }], { duration: SETTLE_MS, easing: SPRING }));
    }
    const well = dropRef.current;
    if (well) delete well.dataset.ready;
    setLifted(null);
    if (keep) onReorder(d.order);
    else snapshot();
    setPreview(null);
  };

  const hide = (k: K) => {
    const at = order.indexOf(k);
    const next = order[at + 1] ?? order[at - 1];
    const el = slots.current.get(k);
    const go = () => {
      snapshot();
      onHide(k);
      if (next && el?.contains(document.activeElement)) requestAnimationFrame(() => slots.current.get(next)?.focus());
    };
    if (!el || stillMotion()) return go();
    el.animate([{ transform: "none", opacity: 1 }, { transform: "scale(0.86)", opacity: 0 }], { duration: 170, easing: "ease-in", fill: "forwards" })
      .finished.then(go, go);
  };

  const key = (k: K, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editing || e.target !== e.currentTarget) return;
    const name = byKey.get(k)?.label ?? "";
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const on = grabbed !== k;
      setGrabbed(on ? k : null);
      setSaid(on ? t("{name} picked up. Arrow keys move it, Space puts it down.", { name }) : t("{name} put down.", { name }));
      return;
    }
    if (e.key === "Escape" && grabbed === k) {
      e.preventDefault();
      e.stopPropagation();
      setGrabbed(null);
      setSaid(t("{name} put down.", { name }));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      hide(k);
      return;
    }
    const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[e.key];
    if (step == null || grabbed !== k) return;
    e.preventDefault();
    const at = order.indexOf(k);
    const target = order[at + step];
    if (!target) return;
    snapshot();
    onReorder(moveKey(order, k, target));
    setSaid(t("{name}, {n} of {total}", { name, n: at + step + 1, total: order.length }));
  };

  return (
    <>
      <div ref={boardRef} className="db-board" data-editing={editing || undefined} data-dragging={lifted != null || undefined}
        role={editing ? "list" : undefined} aria-label={editing ? t("Widgets") : undefined}>
        {order.map((k) => {
          const it = byKey.get(k)!;
          return (
            <div key={k} className={`db-slot ${it.span}`}
              ref={(el) => { if (el) slots.current.set(k, el); else slots.current.delete(k); }}
              data-lifted={lifted === k || undefined} data-grabbed={grabbed === k || undefined}
              role={editing ? "listitem" : undefined} tabIndex={editing ? 0 : undefined}
              aria-label={editing ? it.label : undefined} aria-describedby={editing ? hint : undefined}
              onPointerDown={(e) => down(k, e)} onPointerMove={move}
              onPointerUp={(e) => end(e, true)} onPointerCancel={(e) => end(e, false)}
              onKeyDown={(e) => key(k, e)}>
              <div className="db-slot-body" inert={editing}>{it.node}</div>
              {editing ? (
                <button type="button" className="db-remove" aria-label={t("Hide {name}", { name: it.label })} title={t("Hide")}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => hide(k)}>
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                </button>
              ) : null}
            </div>
          );
        })}
        {lifted != null ? <div ref={dropRef} aria-hidden="true" className="db-well" /> : null}
      </div>
      <p id={hint} hidden>{t("Drag to move, or press Space, then the arrow keys. Delete hides it.")}</p>
      <p className="sr-only" aria-live="polite">{said}</p>
    </>
  );
}
