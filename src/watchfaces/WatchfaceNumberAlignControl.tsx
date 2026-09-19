import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { useId } from "react";

export type WatchfaceNumberAlign = "left" | "center" | "right";

const OPTIONS: ReadonlyArray<{
  value: WatchfaceNumberAlign;
  label: string;
  Icon: typeof AlignLeft;
}> = [
  { value: "left", label: "Align numbers left", Icon: AlignLeft },
  { value: "center", label: "Center numbers", Icon: AlignCenter },
  { value: "right", label: "Align numbers right", Icon: AlignRight }
];

interface WatchfaceNumberAlignControlProps {
  label?: string;
  /** Undefined keeps whatever alignment the template bakes into its rect. */
  value: WatchfaceNumberAlign | undefined;
  onChange: (align: WatchfaceNumberAlign | undefined) => void;
  /** Offers an "Auto" segment that hands alignment back to the template. */
  allowTemplateDefault?: boolean;
  disabled?: boolean;
}

/** Segmented left/center/right picker for sprite-number alignment. */
export function WatchfaceNumberAlignControl({
  label = "Number alignment",
  value,
  onChange,
  allowTemplateDefault = false,
  disabled = false
}: WatchfaceNumberAlignControlProps) {
  const labelId = useId();
  return (
    <div className="field wf-number-align-field">
      <span id={labelId}>{label}</span>
      <div className="wf-number-align" role="group" aria-labelledby={labelId}>
        {allowTemplateDefault ? (
          <button
            type="button"
            className="wf-number-align-auto"
            aria-pressed={value === undefined}
            disabled={disabled}
            title="Keep the template's own alignment"
            onClick={() => onChange(undefined)}
          >
            Auto
          </button>
        ) : null}
        {OPTIONS.map(({ value: option, label: optionLabel, Icon }) => {
          const pressed = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={pressed}
              aria-label={optionLabel}
              title={optionLabel}
              disabled={disabled}
              onClick={() =>
                onChange(pressed && allowTemplateDefault ? undefined : option)
              }
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
