import type { CSSProperties } from "react";
import { t, useLanguage } from "../i18n/watchfaces";
import { useWatchfaceStudioSimple } from "./watchfaceStudioMode";
import { WatchfaceColorInput } from "./WatchfaceColorInput";
import type { WatchfaceFaceColor } from "./watchfaceFaceColors";
import {
  ChevronRight,
  Clock,
  Compass,
  ImagePlus,
  MousePointerClick,
  Palette,
  Square,
  Type,
  Watch
} from "lucide-react";

interface WatchfaceQuickStartProps {
  /** The face shows nothing but its background, as after Start blank. */
  blank?: boolean;
  onBackground: () => void;
  onPhoto: () => void;
  onTime: (() => void) | undefined;
  /** Set while the template time is off the face; replaces Style the time. */
  onAddTime?: () => void;
  /** What Add the time brings back, when not digits (analog hands). */
  addTimeHint?: string;
  onText: () => void;
  onShape: () => void;
  photoDisabled: boolean;
  /** Replays the Studio walkthrough. */
  onTour?: () => void;
  /** Colors set on this face's parts; picking a new one recolors them all. */
  faceColors?: WatchfaceFaceColor[];
  onRecolor?: (from: string, to: string) => void;
}

const SHORTCUTS: Array<{ keys: string[]; action: string }> = [
  { keys: ["Drag"], action: "Move with smart guides" },
  { keys: ["⇧", "Drag"], action: "Lock to one axis" },
  { keys: ["⌥", "Drag"], action: "Move without snapping" },
  { keys: ["←", "→"], action: "Nudge 1 px, with ⇧ 10 px" },
  { keys: ["⌘", "Z"], action: "Undo" },
  { keys: ["Esc"], action: "Clear the selection" }
];

/** Empty-selection welcome screen of the Properties pane. */
export function WatchfaceQuickStart({
  blank = false,
  onBackground,
  onPhoto,
  onTime,
  onAddTime,
  addTimeHint = "Hours and minutes that update live",
  onText,
  onShape,
  photoDisabled,
  onTour,
  faceColors = [],
  onRecolor
}: WatchfaceQuickStartProps) {
  useLanguage();
  const simple = useWatchfaceStudioSimple();
  type QuickAction = {
    label: string;
    hint: string;
    icon: typeof Clock;
    onClick: () => void;
    disabled?: boolean;
  };
  const timeAction: QuickAction | null = onAddTime
    ? { label: t("Add the time"), hint: addTimeHint, icon: Clock, onClick: onAddTime }
    : onTime
      ? { label: t("Style the time"), hint: "Font, color, and size", icon: Clock, onClick: onTime }
      : null;
  const actions: QuickAction[] = [
    // A blank face needs the time before anything else.
    ...(blank && timeAction ? [timeAction] : []),
    { label: t("Background color"), hint: "The fill behind everything", icon: Palette, onClick: onBackground },
    { label: t("Background photo"), hint: "Use your own image", icon: ImagePlus, onClick: onPhoto, disabled: photoDisabled },
    ...(!blank && timeAction ? [timeAction] : []),
    { label: t("Add text"), hint: "A fixed label on the face", icon: Type, onClick: onText },
    { label: t("Add a shape"), hint: t("Rectangles for panels and accents"), icon: Square, onClick: onShape }
  ];

  return (
    <section className="wf-welcome" aria-labelledby="wf-welcome-title">
      <div className="wf-welcome-hero wf-face-panel-head">
        <span className="wf-welcome-mark" aria-hidden="true">
          <Watch size={18} strokeWidth={1.75} />
        </span>
        {blank ? (
          <>
            <h2 id="wf-welcome-title">{t("Start from scratch")}</h2>
            <p>{t("Add the time first, then the date, data and artwork from the Add column.")}</p>
          </>
        ) : (
          <>
            <h2 id="wf-welcome-title">{t("This face")}</h2>
            <p>{t("Changes here apply to the whole face. Click a part on the face to edit just that part.")}</p>
          </>
        )}
        {onTour ? (
          <button type="button" className="wf-welcome-tour" onClick={onTour}>
            <Compass size={14} aria-hidden="true" />{t("Take the 1-minute tour")}
          </button>
        ) : null}
      </div>

      {faceColors.length > 0 && onRecolor ? (
        <div className="wf-welcome-section wf-face-colors">
          <h3>{t("Face colors")}<span>{faceColors.length}</span></h3>
          <div className="wf-face-color-swatches">
            {faceColors.map(({ color, uses }, index) => (
              <label
                key={index}
                className="wf-face-color"
                style={{ "--wf-face-color": color } as CSSProperties}
                title={uses === 1 ? t("{{value1}} · 1 part", { value1: color }) : t("{{value1}} · {{value2}} parts", { value1: color, value2: uses })}
              >
                <span className="sr-only">{uses === 1 ? t("Recolor the part using {{value1}}", { value1: color }) : t("Recolor the {{value2}} parts using {{value1}}", { value1: color, value2: uses })}</span>
                <WatchfaceColorInput value={color} onValueChange={(next) => onRecolor(color, next)} />
              </label>
            ))}
          </div>
          <p className="wf-face-colors-hint">{t("Pick one to recolor every part that uses it.")}</p>
        </div>
      ) : null}

      <div className="wf-welcome-section">
        <h3>{t("Quick edits")}</h3>
        <div className="wf-welcome-actions">
          {actions.map(({ label, hint, icon: Icon, onClick, disabled }) => (
            <button key={label} type="button" onClick={onClick} disabled={disabled}>
              <span className="wf-welcome-action-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="wf-welcome-action-text">
                <strong>{t(label)}</strong>
                <small>{t(hint)}</small>
              </span>
              <ChevronRight size={14} className="wf-welcome-action-arrow" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <details className="wf-welcome-section wf-welcome-shortcuts-disclosure">
        <summary><h3>{t("Shortcuts")}</h3></summary>
        <dl className="wf-welcome-shortcuts">
          {SHORTCUTS.map(({ keys, action }) => (
            <div key={action}>
              <dt>
                {keys.map((key) => (
                  <kbd key={key}>{t(key)}</kbd>
                ))}
              </dt>
              <dd>{t(action)}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="wf-welcome-footnote">
        <MousePointerClick size={13} aria-hidden="true" />
        <span>{simple
          ? t("Added text stays fixed on the watch. Style the existing time and data layers for values that update live.")
          : t("Added text stays fixed on the watch. Style the existing time and data layers for values that update live. Template-wide settings are on the Project tab.")}</span>
      </p>
    </section>
  );
}
