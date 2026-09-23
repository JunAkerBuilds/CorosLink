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
  onBackground: () => void;
  onPhoto: () => void;
  onTime: (() => void) | undefined;
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
  onBackground,
  onPhoto,
  onTime,
  onText,
  onShape,
  photoDisabled
}: WatchfaceQuickStartProps) {
  const actions = [
    { label: "Background color", hint: "The fill behind everything", icon: Palette, onClick: onBackground },
    { label: "Background photo", hint: "Use your own image", icon: ImagePlus, onClick: onPhoto, disabled: photoDisabled },
    ...(onTime
      ? [{ label: "Style the time", hint: "Font, color, and size", icon: Clock, onClick: onTime }]
      : []),
    { label: "Add text", hint: "A fixed label on the face", icon: Type, onClick: onText },
    { label: "Add a shape", hint: "Rectangles for panels and accents", icon: Square, onClick: onShape }
  ];

  return (
    <section className="wf-welcome" aria-labelledby="wf-welcome-title">
      <div className="wf-welcome-hero">
        <span className="wf-welcome-mark" aria-hidden="true">
          <Watch size={22} strokeWidth={1.75} />
        </span>
        <h2 id="wf-welcome-title">Make this face yours</h2>
        <p>
          Start with a quick edit below, or click anything on the face to
          change it.
        </p>
      </div>

      <div className="wf-welcome-section">
        <h3>Quick edits</h3>
        <div className="wf-welcome-actions">
          {actions.map(({ label, hint, icon: Icon, onClick, disabled }) => (
            <button key={label} type="button" onClick={onClick} disabled={disabled}>
              <span className="wf-welcome-action-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="wf-welcome-action-text">
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <ChevronRight size={14} className="wf-welcome-action-arrow" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="wf-welcome-section">
        <h3>Shortcuts</h3>
        <dl className="wf-welcome-shortcuts">
          {SHORTCUTS.map(({ keys, action }) => (
            <div key={action}>
              <dt>
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="wf-welcome-footnote">
        <MousePointerClick size={13} aria-hidden="true" />
        <span>
          Added text stays fixed on the watch. Style the existing time and data
          layers for values that update live. Template-wide settings are on the
          Project tab.
        </span>
      </p>
    </section>
  );
}
