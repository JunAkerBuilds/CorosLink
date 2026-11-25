"use client";
// Our own drop-down: the same pill and glass menu on macOS, Windows, Linux and the web, where <select> opens the
// system's menu. `Select` keeps the <select> API (option/optgroup children, onChange with e.target.value), so pages
// written for a native select work unchanged; `Dropdown` takes a plain list.
import {
  Children, forwardRef, isValidElement, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ChangeEvent, type ComponentProps, type CSSProperties, type KeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Item { value: string; label: string; disabled?: boolean; group?: string }

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

interface MenuProps {
  items: Item[];
  value: string;
  onPick: (value: string) => void;
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  title?: string;
}

const Menu = forwardRef<HTMLButtonElement, MenuProps>(function Menu({ items, value, onPick, label, labelledBy, disabled, className, style, id, title }, ref) {
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  useImperativeHandle(ref, () => button.current as HTMLButtonElement);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; minWidth: number; up: boolean } | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const chosen = items.findIndex((o) => o.value === value);
  const shown = items[chosen]?.label ?? "";
  const groups = new Set(items.map((o) => o.group).filter(Boolean)).size;
  const usable = (k: number) => !!items[k] && !items[k].disabled;
  const step = (from: number, by: 1 | -1) => {
    for (let k = from + by; k >= 0 && k < items.length; k += by) if (usable(k)) return k;
    return from;
  };

  const show = () => {
    if (disabled) return;
    setActive(usable(chosen) ? chosen : step(-1, 1));
    setOpen(true);
  };
  const hide = (focus = true) => { setOpen(false); if (focus) button.current?.focus(); };
  const pick = (k: number) => {
    if (!usable(k)) return;
    hide();
    if (items[k].value !== value) onPick(items[k].value);
  };

  // On <body> so cards with overflow or their own stacking don't cut it off; under the button, or above near the bottom.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const tall = Math.min(332, items.length * 34 + groups * 28 + 14);
    const up = r.bottom + 6 + tall > window.innerHeight && r.top - 6 - tall > 0;
    setPlace({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8)), top: up ? r.top - 6 : r.bottom + 6, minWidth: r.width, up });
  }, [open, items.length, groups]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) hide(false);
    };
    const moved = (e: Event) => { if (!menu.current?.contains(e.target as Node)) hide(false); };
    const left = () => hide(false);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", left);
    window.addEventListener("blur", left);
    menu.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", left);
      window.removeEventListener("blur", left);
    };
  }, [open]);

  useEffect(() => { if (open) menu.current?.querySelector(`[data-k="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [open, active]);

  // Typing jumps to a choice starting with the letters, as a native select does; one letter again moves to the next.
  const jump = (key: string, from: number, now: number) => {
    const text = (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase();
    typed.current = { text, at: now };
    const start = text.length === 1 ? from + 1 : Math.max(0, from);
    for (let i = 0; i < items.length; i++) {
      const k = (start + i) % items.length;
      if (usable(k) && items[k].label.toLowerCase().startsWith(text)) return k;
    }
    return -1;
  };
  const isLetter = (e: KeyboardEvent) => e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey;

  const onButtonKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
    else if (isLetter(e)) {
      const k = jump(e.key, chosen, e.timeStamp);
      if (k >= 0 && items[k].value !== value) onPick(items[k].value);
    }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => step(a, -1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(step(-1, 1)); }
    else if (e.key === "End") { e.preventDefault(); setActive(step(items.length, -1)); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); hide(); }
    else if (isLetter(e)) { const k = jump(e.key, active, e.timeStamp); if (k >= 0) setActive(k); }
  };

  const check = <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  const rows: ReactNode[] = [];
  items.forEach((o, k) => {
    if (o.group && o.group !== items[k - 1]?.group) rows.push(<li key={`g${k}`} role="presentation" className="dd-group">{o.group}</li>);
    rows.push(
      <li key={k} id={`${listId}-${k}`} data-k={k} role="option" aria-selected={k === chosen} aria-disabled={o.disabled || undefined}
        data-active={k === active && !o.disabled ? "" : undefined}
        onMouseEnter={() => { if (!o.disabled) setActive(k); }} onClick={() => pick(k)}>
        <span>{o.label}</span>{check}
      </li>,
    );
  });

  return (
    <>
      <button ref={button} type="button" id={id} title={title} style={style} className={cx("select", "dd", className)}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={label ? `${label}: ${shown}` : undefined} aria-labelledby={labelledBy}
        disabled={disabled} onClick={() => (open ? hide() : show())} onKeyDown={onButtonKey}>
        <span>{shown}</span>
      </button>
      {open && place ? createPortal(
        // The glass and its rim sit on the outer box so they stay put while a long list scrolls inside.
        <div className="dd-menu" data-up={place.up || undefined} style={{ left: place.left, top: place.top, minWidth: place.minWidth }}>
          <ul ref={menu} id={listId} role="listbox" aria-label={label} tabIndex={-1} className="dd-list"
            aria-activedescendant={usable(active) ? `${listId}-${active}` : undefined} onKeyDown={onMenuKey}>
            {rows}
          </ul>
        </div>,
        document.body,
      ) : null}
    </>
  );
});

export interface DropdownOption<T extends string | number> { value: T; label: string; disabled?: boolean }

/** A drop-down over a plain list of choices. */
export function Dropdown<T extends string | number>({ label, value, options, onChange, disabled, small, className }: {
  /** Read out for the button and the menu. */
  label: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  small?: boolean;
  className?: string;
}) {
  const items = options.map((o) => ({ value: String(o.value), label: o.label, disabled: o.disabled }));
  return (
    <Menu items={items} value={String(value)} label={label} disabled={disabled} className={cx(small && "dd-small", className)}
      onPick={(v) => { const o = options.find((x) => String(x.value) === v); if (o) onChange(o.value); }} />
  );
}

/** The text of an option's children, as a native select shows it. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

type ChildProps = { children?: ReactNode; value?: string | number | readonly string[]; label?: string; disabled?: boolean };

/** Reads <option> and <optgroup> children (through fragments and arrays) into a list. */
function itemsOf(children: ReactNode, group?: string, out: Item[] = []): Item[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<ChildProps>(child)) return;
    const { props } = child;
    if (child.type === "option") {
      const label = textOf(props.children);
      out.push({ value: props.value !== undefined ? String(props.value) : label, label, disabled: props.disabled, group });
    } else if (child.type === "optgroup") {
      itemsOf(props.children, props.label, out);
    } else {
      itemsOf(props.children, group, out);
    }
  });
  return out;
}

type SelectProps = Omit<ComponentProps<"select">, "onChange" | "ref"> & {
  field?: boolean;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
};

/** Drop-in for <select>: the same props and children, drawn as our own menu. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { className, field, children, value, defaultValue, onChange, disabled, style, id, title, "aria-label": ariaLabel, "aria-labelledby": labelledBy },
  ref,
) {
  const items = itemsOf(children);
  const [own, setOwn] = useState(() => String(defaultValue ?? items[0]?.value ?? ""));
  const current = value !== undefined ? String(value) : own;
  const pick = (next: string) => {
    if (value === undefined) setOwn(next);
    // Pages read e.target.value, as from a native select.
    const target = { value: next } as HTMLSelectElement;
    onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
  };
  return (
    <Menu ref={ref} items={items} value={current} onPick={pick} label={ariaLabel} labelledBy={labelledBy}
      disabled={disabled} style={style} id={id} title={title} className={cx(field && "select-field", className)} />
  );
});
