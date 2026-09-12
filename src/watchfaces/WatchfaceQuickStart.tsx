import { Clock, ImagePlus, Palette, Square, Type } from "lucide-react";

interface WatchfaceQuickStartProps {
  onBackground: () => void;
  onPhoto: () => void;
  onTime: (() => void) | undefined;
  onText: () => void;
  onShape: () => void;
  photoDisabled: boolean;
}

export function WatchfaceQuickStart({
  onBackground,
  onPhoto,
  onTime,
  onText,
  onShape,
  photoDisabled
}: WatchfaceQuickStartProps) {
  return (
    <details className="wf-quick-start" open>
      <summary>Start here</summary>
      <div className="wf-quick-start-content">
        <p>Make this template your own. Pick something to change.</p>
        <div className="wf-quick-start-actions">
          <button type="button" onClick={onBackground}>
            <Palette size={16} aria-hidden="true" />
            <span>Background color</span>
          </button>
          <button type="button" onClick={onPhoto} disabled={photoDisabled}>
            <ImagePlus size={16} aria-hidden="true" />
            <span>Background photo</span>
          </button>
          {onTime ? (
            <button type="button" onClick={onTime}>
              <Clock size={16} aria-hidden="true" />
              <span>Style the time</span>
            </button>
          ) : null}
          <button type="button" onClick={onText}>
            <Type size={16} aria-hidden="true" />
            <span>Add your own text</span>
          </button>
          <button type="button" onClick={onShape}>
            <Square size={16} aria-hidden="true" />
            <span>Add a shape</span>
          </button>
        </div>
        <details className="wf-quick-start-tips">
          <summary>How editing works</summary>
          <ul>
            <li>Click an item on the face to change its settings. Drag it to move it.</li>
            <li>Use the arrow keys for small moves, or hold Shift for bigger moves.</li>
            <li>Use Undo to try a different idea. Save keeps an editable copy.</li>
            <li>Added text stays fixed. Style the existing time and data for values that update on your watch.</li>
            <li>When ready, choose Export → Preview export to review your face.</li>
          </ul>
        </details>
      </div>
    </details>
  );
}
