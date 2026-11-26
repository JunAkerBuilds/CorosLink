// The Face tab's project sections, under the face's own: the template's config files to edit by hand (per screen size,
// Current and Always-on, with Reset) and the identity the built archive carries. CorosLink's Project tab.
import { useState } from "react";
import { Segmented, Select } from "@/components/ui";
import type { CorosWatchfaceTemplateDetails } from "../../watchface/types";
import type { Design } from "../studioFace";
import {
  archiveOverrideProblem, configEdited, configFilesOf, configTextOf, editedDirectories, setArchiveOverride, setConfigText, templateWatchfaceId,
  type ArchiveOverride,
} from "../studioProject";
import { Fold } from "../pages/StudioInspector";
import { Icon } from "./StudioIcon";
import "./studioParity.css";

type EditRoot = (fn: (design: Design) => Design) => void;

export interface ProjectFoldsProps {
  /** The whole design: config files and identity are the face's, not one display's. */
  design: Design;
  editRoot: EditRoot;
  details: CorosWatchfaceTemplateDetails;
  baselines: Record<string, string>;
  /** The display being edited picks the file shown first. */
  mode: "current" | "aod";
  sourceTemplateId?: string;
}

export function ProjectFolds({ design, editRoot, details, baselines, mode, sourceTemplateId }: ProjectFoldsProps) {
  const sizes = configFilesOf(details, baselines).filter((s) => s.current || s.aod);
  const [directory, setDirectory] = useState(sizes[0]?.directory ?? "");
  // The file shown follows the display being edited until another is picked for it.
  const [picked, setPicked] = useState<{ mode: string; which: "current" | "aod" } | null>(null);
  const which = picked?.mode === mode ? picked.which : mode;
  const setWhich = (w: "current" | "aod") => setPicked({ mode, which: w });
  const size = sizes.find((s) => s.directory === directory) ?? sizes[0];
  const path = size ? (which === "aod" ? size.aod : size.current) ?? size.current ?? size.aod : undefined;
  const edited = editedDirectories(design, baselines);
  const fileEdited = path ? configEdited(design, baselines, path) : false;
  const ids = design.archiveOverrides ?? {};
  const set = (field: ArchiveOverride) => (v: string) => editRoot((x) => setArchiveOverride(x, field, v));
  return <>
    {size ? (
      <Fold title="Config files" open={false} note={edited.size ? "Edited" : undefined}>
        <>
          {sizes.length > 1 ? (
            <label className="st-select st-select-wide"><span>Screen</span>
              <Select aria-label="Screen size" value={size.directory} onChange={(e) => setDirectory(e.target.value)}>
                {sizes.map((s) => <option key={s.directory} value={s.directory}>{s.label}{edited.has(s.directory) ? " · edited" : ""}</option>)}
              </Select><Icon name="chevD" size={14} /></label>
          ) : null}
          {size.current && size.aod ? (
            <Segmented small label="Config file" value={which} onChange={setWhich}
              options={[{ value: "current", label: "Current" }, { value: "aod", label: "Always-on" }]} />
          ) : null}
          {path ? <>
            <ConfigText key={path} text={configTextOf(design, baselines, path)} label={path} onCommit={(t) => editRoot((x) => setConfigText(x, baselines, path, t))} />
            <div className="st-cfg-foot">
              <code>{path}</code>
              <button type="button" className="chip st-chip-btn" disabled={!fileEdited} onClick={() => editRoot((x) => setConfigText(x, baselines, path, baselines[path] ?? ""))}>
                <Icon name="refresh" size={15} />Reset file</button>
            </div>
          </> : null}
          <span className="st-note">Layer edits still apply on top when the face is built.</span>
        </>
      </Fold>
    ) : null}
    <Fold title="Archive identity" open={false} note={Object.keys(ids).length ? "Changed" : undefined}>
      <>
        <IdField label="Template ID" hint="o_template_id" value={ids.templateId ?? ""} placeholder={sourceTemplateId} problem={(v) => archiveOverrideProblem("templateId", v)} onCommit={set("templateId")} numeric />
        <IdField label="Watch-face ID" hint="[watchface_id], Current and Always-on" value={ids.watchfaceId ?? ""} placeholder={templateWatchfaceId(details)} problem={(v) => archiveOverrideProblem("watchfaceId", v)} onCommit={set("watchfaceId")} />
        <IdField label="Template name" hint="m_name; the project keeps its name" value={ids.templateName ?? ""} placeholder="Template's" problem={(v) => archiveOverrideProblem("templateName", v)} onCommit={set("templateName")} />
      </>
    </Fold>
  </>;
}

/** A raw config file, kept as typed and written to the design when left (one undo step per edit). */
function ConfigText({ text, label, onCommit }: { text: string; label: string; onCommit: (t: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft !== text) onCommit(draft); setDraft(null); };
  return (
    <textarea className="field st-cfg-text" spellCheck={false} rows={16} aria-label={label} value={draft ?? text}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "s" && (e.metaKey || e.ctrlKey)) commit(); }} />
  );
}

function IdField({ label, hint, value, placeholder, problem, onCommit, numeric }: {
  label: string; hint: string; value: string; placeholder?: string; problem: (v: string) => string | null; onCommit: (v: string) => void; numeric?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const wrong = problem(shown);
  const commit = () => { if (draft !== null && !wrong) onCommit(draft); if (!wrong) setDraft(null); };
  return (
    <label className="st-cfg-id"><span>{label}</span>
      <input className="field" type="text" inputMode={numeric ? "numeric" : "text"} spellCheck={false} maxLength={64} value={shown} placeholder={placeholder}
        aria-label={label} aria-invalid={wrong ? true : undefined} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }} />
      <small>{wrong ?? hint}</small>
    </label>
  );
}
