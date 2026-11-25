"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
import { parseGoal } from "@/lib/watch";

/**
 * A whole-number setting. What is typed is kept as typed; every valid value is saved straight away,
 * and anything else (empty, zero, too large) is left unsaved and put back when the field loses focus.
 */
export function NumberField({ id, value, max, onCommit }: { id: string; value: number; max: number; onCommit: (next: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const invalid = typed !== null && parseGoal(typed, max) === null;
  return (
    <Field
      id={id} type="number" inputMode="numeric" min={1} max={max} step={1} className="wa-num"
      aria-invalid={invalid || undefined}
      value={typed ?? String(value)}
      onChange={(e) => {
        setTyped(e.target.value);
        const n = parseGoal(e.target.value, max);
        if (n !== null) onCommit(n);
      }}
      onBlur={() => setTyped(null)}
    />
  );
}
