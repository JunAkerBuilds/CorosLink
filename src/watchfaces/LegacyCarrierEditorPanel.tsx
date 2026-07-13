import { useState } from "react";
import { Download, FileCheck2, FileCog, Loader2, Move, ShieldCheck } from "lucide-react";
import type {
  CorosLegacy614aCarrierPatchInput,
  CorosLegacy614aCarrierSelection
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

type EditorValues = Record<keyof CorosLegacy614aCarrierPatchInput["temperatureRect"] | "weatherX" | "weatherY", string>;

const SLENDER_VALUES: EditorValues = {
  weatherX: "292",
  weatherY: "72",
  x0: "266",
  y0: "152",
  x1: "404",
  y1: "212"
};

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    style: "unit",
    unit: "megabyte",
    unitDisplay: "narrow"
  }).format(bytes / 1_000_000);
}

function toPatch(values: EditorValues): CorosLegacy614aCarrierPatchInput {
  const value = (key: keyof EditorValues, label: string): number => {
    const parsed = Number(values[key]);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 415) {
      throw new Error(`${label} must be a whole 416px-canvas coordinate (0–415).`);
    }
    return parsed;
  };
  return {
    weatherPosition: {
      x: value("weatherX", "Weather x"),
      y: value("weatherY", "Weather y")
    },
    temperatureRect: {
      x0: value("x0", "Temperature left"),
      y0: value("y0", "Temperature top"),
      x1: value("x1", "Temperature right"),
      y1: value("y1", "Temperature bottom")
    }
  };
}

function sourceValues(selection: CorosLegacy614aCarrierSelection): EditorValues {
  const { weatherPosition, temperatureRect } = selection.inspection;
  return {
    weatherX: String(weatherPosition.x),
    weatherY: String(weatherPosition.y),
    x0: String(temperatureRect.x0),
    y0: String(temperatureRect.y0),
    x1: String(temperatureRect.x1),
    y1: String(temperatureRect.y1)
  };
}

interface LegacyCarrierEditorPanelProps {
  api: CorosLinkApi;
}

/**
 * A deliberately small editor for the first hardware-testable 614A carrier.
 * This stays separate from the archive studio because the phone compiler's
 * 614R output cannot retain the legacy live-weather machinery.
 */
export function LegacyCarrierEditorPanel({ api }: LegacyCarrierEditorPanelProps) {
  const [selection, setSelection] = useState<CorosLegacy614aCarrierSelection | null>(null);
  const [values, setValues] = useState<EditorValues>(SLENDER_VALUES);
  const [busy, setBusy] = useState<"choose" | "export" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const update = (key: keyof EditorValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  async function handleChoose() {
    setBusy("choose");
    setMessage(null);
    try {
      const next = await api.chooseLegacy614aCarrier();
      if (!next) return;
      setSelection(next);
      setValues(sourceValues(next));
      setMessage("Reference authenticated. Its ID, metadata, live resources, and AOD data are now locked.");
    } catch (caught) {
      setSelection(null);
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    if (!selection) return;
    setBusy("export");
    setMessage(null);
    try {
      const result = await api.exportLegacy614aCarrier(selection.selectionId, toPatch(values));
      if (!result.saved) {
        setMessage("Export cancelled. The original carrier was not modified.");
        return;
      }
      setMessage(`Exported a guarded 614A carrier with public ID ${result.watchFaceId}. Install it through the official COROS Android app.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  const inspection = selection?.inspection;
  const disabled = busy !== null;

  return (
    <section className="watchface-hub-section legacy-carrier-editor" aria-labelledby="legacy-carrier-editor-title">
      <div className="watchface-hub-section-heading">
        <div>
          <span className="watchface-raw-installer-kicker">Hardware-tested route · PACE Pro</span>
          <h2 id="legacy-carrier-editor-title">Legacy carrier editor</h2>
          <p>
            Build from the original MULTIDATA ELEV 614A carrier. Weather and temperature stay live;
            this editor only changes their mapped normal-display geometry.
          </p>
        </div>
        <div className="watchface-raw-installer-actions">
          <button className="secondary-button" type="button" disabled={disabled} onClick={() => void handleChoose()}>
            {busy === "choose" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <FileCheck2 size={16} aria-hidden="true" />}
            {inspection ? "Choose another reference" : "Choose MULTIDATA carrier"}
          </button>
          <button className="primary-button" type="button" disabled={!selection || disabled} onClick={() => void handleExport()}>
            {busy === "export" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
            {busy === "export" ? "Exporting" : "Export guarded BIN"}
          </button>
        </div>
      </div>

      {inspection ? (
        <div className="legacy-carrier-reference">
          <FileCog size={17} aria-hidden="true" />
          <div>
            <strong>{inspection.fileName}</strong>
            <span>{inspection.profileName} · {formatBytes(inspection.sizeBytes)} · 614A</span>
          </div>
          <span className="legacy-carrier-lock"><ShieldCheck size={15} aria-hidden="true" /> ID {inspection.watchFaceId} locked</span>
        </div>
      ) : (
        <p className="watchface-raw-installer-file is-empty">
          The exact public MULTIDATA ELEV reference is required; copied, edited, or lookalike BINs are rejected.
        </p>
      )}

      <div className="legacy-carrier-layout">
        <div className="legacy-carrier-layout-heading">
          <div>
            <Move size={16} aria-hidden="true" />
            <strong>Live data placement</strong>
          </div>
          <button className="text-button" type="button" disabled={disabled} onClick={() => setValues(SLENDER_VALUES)}>
            Apply SLENDER layout
          </button>
        </div>
        <div className="legacy-carrier-coordinate-grid">
          <label className="field">Weather x<input inputMode="numeric" value={values.weatherX} onChange={(event) => update("weatherX", event.target.value)} /></label>
          <label className="field">Weather y<input inputMode="numeric" value={values.weatherY} onChange={(event) => update("weatherY", event.target.value)} /></label>
          <label className="field">Temperature left<input inputMode="numeric" value={values.x0} onChange={(event) => update("x0", event.target.value)} /></label>
          <label className="field">Temperature top<input inputMode="numeric" value={values.y0} onChange={(event) => update("y0", event.target.value)} /></label>
          <label className="field">Temperature right<input inputMode="numeric" value={values.x1} onChange={(event) => update("x1", event.target.value)} /></label>
          <label className="field">Temperature bottom<input inputMode="numeric" value={values.y1} onChange={(event) => update("y1", event.target.value)} /></label>
        </div>
        <p className="watchface-studio-summary">
          416px canvas. The current safe map does not edit carrier identity, bitmap dimensions, static layout, or AOD records.
        </p>
      </div>
      {message ? <p className="watchface-raw-installer-message">{message}</p> : null}
    </section>
  );
}
