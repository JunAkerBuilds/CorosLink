import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  WandSparkles
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceArtwork
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

interface WatchfaceCreatorProps {
  api: CorosLinkApi;
  starterArchive: CorosWatchfaceArchive;
  disabled?: boolean;
  onCreated: (archive: CorosWatchfaceArchive) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function WatchfaceCreator({
  api,
  starterArchive,
  disabled = false,
  onCreated,
  onError,
  onNotice
}: WatchfaceCreatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [artwork, setArtwork] = useState<CorosWatchfaceArtwork | null>(null);
  const [backgroundColor, setBackgroundColor] = useState("#081116");
  const [accentColor, setAccentColor] = useState("#51e0b5");
  const [label, setLabel] = useState("TRAINING DAY");
  const [zoom, setZoom] = useState(1);
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [loadingArtwork, setLoadingArtwork] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = 800;
    canvas.height = 800;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let cancelled = false;
    const paint = (image?: HTMLImageElement) => {
      if (cancelled) {
        return;
      }
      context.clearRect(0, 0, 800, 800);
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, 800, 800);

      if (image) {
        const scale = Math.max(800 / image.naturalWidth, 800 / image.naturalHeight) * zoom;
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(image, (800 - width) / 2, (800 - height) / 2, width, height);
      }

      const shade = context.createLinearGradient(0, 0, 800, 800);
      shade.addColorStop(0, hexToRgba(backgroundColor, 0.3));
      shade.addColorStop(0.46, "rgba(0, 0, 0, 0.06)");
      shade.addColorStop(1, "rgba(0, 0, 0, 0.56)");
      context.fillStyle = shade;
      context.fillRect(0, 0, 800, 800);

      context.strokeStyle = hexToRgba(accentColor, 0.62);
      context.lineWidth = 4;
      context.beginPath();
      context.arc(124, 108, 34, -Math.PI / 2, Math.PI * 1.25);
      context.stroke();
      context.fillStyle = accentColor;
      context.fillRect(76, 180, 122, 5);
      context.font = "700 25px system-ui, sans-serif";
      context.letterSpacing = "3px";
      context.fillText(label.trim().toUpperCase().slice(0, 28) || "CUSTOM FACE", 76, 224);
      context.letterSpacing = "0px";

      // Keep the dynamic time/date/control area clear: COROS draws those from
      // the retained config.txt and number-sprite files on the actual watch.
      context.strokeStyle = "rgba(255, 255, 255, 0.14)";
      context.lineWidth = 1;
      context.setLineDash([8, 12]);
      context.strokeRect(492, 96, 244, 590);
      context.setLineDash([]);
      setBackgroundDataUrl(canvas.toDataURL("image/png"));
    };

    if (!artwork) {
      paint();
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => paint(image);
    image.onerror = () => paint();
    image.src = artwork.dataUrl;
    return () => {
      cancelled = true;
    };
  }, [accentColor, artwork, backgroundColor, label, zoom]);

  async function chooseArtwork() {
    setLoadingArtwork(true);
    try {
      const selected = await api.chooseCorosWatchfaceArtwork();
      if (!selected) {
        return;
      }
      setArtwork(selected);
      setZoom(1);
      onNotice("Artwork added to the canvas. Position it with the scale control.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setLoadingArtwork(false);
    }
  }

  async function createArchive() {
    if (!backgroundDataUrl) {
      onError("The canvas is still rendering. Try again in a moment.");
      return;
    }
    setCreating(true);
    try {
      const archive = await api.createCorosWatchfaceArchive({
        sourceArchiveId: starterArchive.archiveId,
        backgroundDataUrl
      });
      onCreated(archive);
      onNotice("Created a fresh upload-ready custom watchface archive.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  const previewStyle = {
    "--creator-background": backgroundDataUrl ? `url(${backgroundDataUrl})` : "none",
    "--creator-accent": accentColor
  } as CSSProperties;

  return (
    <section className="panel watchface-creator">
      <div className="watchfaces-panel-heading">
        <span className="watchfaces-panel-icon"><Palette size={20} /></span>
        <div>
          <p className="eyebrow">Step 4</p>
          <h2>Create the visual layer</h2>
        </div>
      </div>
      <p className="watchfaces-muted">
        Design the background and label here. The starter template keeps the
        live clock, date, battery, and activity fields on the watch.
      </p>

      <div className="watchface-creator-layout">
        <div className="watchface-creator-controls">
          <label className="field">
            Face label
            <input
              value={label}
              maxLength={28}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="TRAINING DAY"
            />
          </label>
          <div className="watchface-color-grid">
            <label className="field">
              Base color
              <span className="watchface-color-control">
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(event) => setBackgroundColor(event.target.value)}
                />
                <code>{backgroundColor}</code>
              </span>
            </label>
            <label className="field">
              Accent color
              <span className="watchface-color-control">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(event) => setAccentColor(event.target.value)}
                />
                <code>{accentColor}</code>
              </span>
            </label>
          </div>
          <div className="watchface-creator-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={disabled || loadingArtwork || creating}
              onClick={() => void chooseArtwork()}
            >
              {loadingArtwork ? <Loader2 className="spin" size={16} /> : <ImagePlus size={16} />}
              {artwork ? "Replace artwork" : "Add artwork"}
            </button>
            {artwork ? (
              <button
                className="secondary-button"
                type="button"
                disabled={disabled || creating}
                onClick={() => setArtwork(null)}
              >
                <Trash2 size={16} /> Remove
              </button>
            ) : null}
          </div>
          {artwork ? (
            <label className="field watchface-zoom-control">
              Artwork scale <span>{zoom.toFixed(2)}×</span>
              <input
                type="range"
                min="1"
                max="2.25"
                step="0.01"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
          ) : null}
          <button
            className="primary-button watchface-create-button"
            type="button"
            disabled={disabled || loadingArtwork || creating || !backgroundDataUrl}
            onClick={() => void createArchive()}
          >
            {creating ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
            Create upload archive
          </button>
          <p className="watchface-creator-note">
            <Sparkles size={15} aria-hidden="true" /> This creates a new local
            archive from template {starterArchive.sourceTemplateId}; it does not
            publish anything yet.
          </p>
        </div>

        <div className="watchface-creator-preview-shell">
          <div className="watchface-creator-preview" style={previewStyle}>
            <span className="watchface-preview-label">{label || "CUSTOM FACE"}</span>
            <span className="watchface-preview-day">THU&nbsp;&nbsp;10</span>
            <strong className="watchface-preview-time">10:09</strong>
            <span className="watchface-preview-metric">8,420 STEPS</span>
            <span className="watchface-preview-safe-zone" aria-hidden="true" />
          </div>
          <p>Preview — dynamic fields are shown as a guide and remain live on-watch.</p>
        </div>
      </div>
      <canvas ref={canvasRef} className="watchface-creator-canvas" aria-hidden="true" />
    </section>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Watchface creator failed.";
}
