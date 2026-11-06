import { t, useLanguage } from "../i18n/watchfaces";
import {
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState
} from "react";

/** A numeric field that permits clearing/retyping without snapping to zero. */
export function EditableNumberInput({
  value,
  fallback = 0,
  onValueChange,
  onBlur,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  className,
  title,
  min,
  max,
  step,
  disabled,
  ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value: number;
  fallback?: number;
  onValueChange: (value: number) => void;
}) {
  useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
  const [scrubbing, setScrubbing] = useState(false);
  const scrubRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);
  useEffect(
    () => () => {
      document.body.classList.remove("wf-value-scrubbing");
    },
    []
  );
  const finishScrub = (event: ReactPointerEvent<HTMLInputElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    if (inputRef.current?.hasPointerCapture(event.pointerId)) {
      inputRef.current.releasePointerCapture(event.pointerId);
    }
    scrubRef.current = null;
    setScrubbing(false);
    document.body.classList.remove("wf-value-scrubbing");
  };
  return (
    <input
      {...props}
      ref={inputRef}
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={draft}
      className={`${className ?? ""} wf-scrubbable-number${
        scrubbing ? " is-scrubbing" : ""
      }`.trim()}
      title={title ?? t("Drag left or right to adjust. Click to type.")}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next !== "" && Number.isFinite(Number(next))) onValueChange(Number(next));
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (
          event.defaultPrevented ||
          disabled ||
          event.button !== 0
        ) {
          return;
        }
        scrubRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startValue: Number.isFinite(value) ? value : fallback,
          moved: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const scrub = scrubRef.current;
        if (!scrub || scrub.pointerId !== event.pointerId) return;
        const delta = event.clientX - scrub.startX;
        if (!scrub.moved && Math.abs(delta) < 3) return;
        scrub.moved = true;
        if (!scrubbing) {
          setScrubbing(true);
          document.body.classList.add("wf-value-scrubbing");
        }
        event.preventDefault();
        const numericStep = Math.abs(Number(step)) || 1;
        const multiplier = event.shiftKey ? 10 : 1;
        const stepCount = Math.round(delta / 4);
        const lower = min === undefined ? -Infinity : Number(min);
        const upper = max === undefined ? Infinity : Number(max);
        const precision = Math.min(
          8,
          Math.max(0, (String(numericStep).split(".")[1] ?? "").length)
        );
        const next = Math.min(
          Number.isFinite(upper) ? upper : Infinity,
          Math.max(
            Number.isFinite(lower) ? lower : -Infinity,
            scrub.startValue + stepCount * numericStep * multiplier
          )
        );
        const rounded = Number(next.toFixed(precision));
        setDraft(String(rounded));
        onValueChange(rounded);
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        finishScrub(event);
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        finishScrub(event);
      }}
      onDoubleClick={(event) => {
        onDoubleClick?.(event);
        if (!event.defaultPrevented) event.currentTarget.select();
      }}
      onBlur={(event) => {
        if (draft.trim() === "") {
          setDraft(String(fallback));
          onValueChange(fallback);
        } else {
          // Show what was kept: the parent may have clamped or rounded the typed value.
          setDraft(String(value));
        }
        onBlur?.(event);
      }}
    />
  );
}
