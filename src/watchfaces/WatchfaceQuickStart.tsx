import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import {
  ChevronRight,
  Clock,
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
  photoDisabled
}: WatchfaceQuickStartProps) {
  useLanguage();
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
      <div className="wf-welcome-hero">
        <span className="wf-welcome-mark" aria-hidden="true">
          <Watch size={22} strokeWidth={1.75} />
        </span>
        {blank ? (
          <>
            <h2 id="wf-welcome-title">{t("Start from scratch")}</h2>
            <p>{t("Add the time first, then the date, data and artwork from Add in the Layers panel.")}</p>
          </>
        ) : (
          <>
            <h2 id="wf-welcome-title">{t("Make this face yours")}</h2>
            <p>{t("Start with a quick edit below, or click anything on the face to change it.")}</p>
          </>
        )}
      </div>

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

      <div className="wf-welcome-section">
        <h3>{t("Shortcuts")}</h3>
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
      </div>

      <p className="wf-welcome-footnote">
        <MousePointerClick size={13} aria-hidden="true" />
        <span>{t("Added text stays fixed on the watch. Style the existing time and data layers for values that update live. Template-wide settings are on the Project tab.")}</span>
      </p>
    </section>
  );
}
