// The face's project settings that live outside its layers: the template's raw config files edited by hand, and the
// identity the built archive carries (template ID, watch-face ID, manifest name). CorosLink's Project tab, as pure
// edits on the design so they undo, save and travel with the project.
import { t } from "@/lib/i18n";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import type { Design } from "./studioFace";

export interface ConfigFiles {
  directory: string;
  label: string;
  current?: string;
  aod?: string;
}

/** Every screen size the template has, with the config.txt and AODconfig.txt it ships (by archive path). */
export function configFilesOf(details: CorosWatchfaceTemplateDetails, baselines: Record<string, string>): ConfigFiles[] {
  return details.resolutions.map((r) => {
    const current = `${r.directory}/config.txt`, aod = `${r.directory}/AODconfig.txt`;
    return {
      directory: r.directory,
      label: `${r.width} × ${r.height}`,
      ...(current in baselines ? { current } : {}),
      ...(aod in baselines ? { aod } : {}),
    };
  });
}

/** Whether a file's text differs from the template's. */
export const configEdited = (design: Design, baselines: Record<string, string>, path: string) =>
  Object.prototype.hasOwnProperty.call(design.configTextEdits ?? {}, path) && design.configTextEdits![path] !== baselines[path];

/** The file as the face has it: the hand edit, else the template's. */
export const configTextOf = (design: Design, baselines: Record<string, string>, path: string) =>
  design.configTextEdits?.[path] ?? baselines[path] ?? "";

/** Sets a file's text; text equal to the template's drops the edit, so Reset is setting it back. */
export function setConfigText(design: Design, baselines: Record<string, string>, path: string, text: string): Design {
  const edits = { ...design.configTextEdits };
  if (text === baselines[path]) {
    if (!(path in edits)) return design;
    delete edits[path];
  } else {
    if (edits[path] === text) return design;
    edits[path] = text;
  }
  return { ...design, configTextEdits: Object.keys(edits).length ? edits : undefined };
}

/** Screen-size directories with at least one edited file. */
export function editedDirectories(design: Design, baselines: Record<string, string>): Set<string> {
  return new Set(Object.keys(design.configTextEdits ?? {}).filter((p) => configEdited(design, baselines, p)).map((p) => p.split("/")[0]!));
}

export type ArchiveOverride = "templateId" | "watchfaceId" | "templateName";

/** What's wrong with an override as typed, or null when the build takes it (archive/build.ts checks it again). */
export function archiveOverrideProblem(field: ArchiveOverride, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (field === "templateId") return /^\d{1,20}$/.test(v) && !/^0+$/.test(v) ? null : t("1–20 digits, not all zero.");
  if (field === "watchfaceId") {
    if (/^0x[0-9a-f]{1,8}$/i.test(v)) return null;
    return /^(?:0|[1-9]\d{0,9})$/.test(v) && Number(v) <= 0xffffffff ? null : t("A 32-bit number, decimal or 0x hex.");
  }
  return v.length <= 64 ? null : t("64 characters at most.");
}

/** Sets one override; blank removes it, and the field goes when none is left. */
export function setArchiveOverride(design: Design, field: ArchiveOverride, value: string): Design {
  const v = value.trim();
  const next = { ...design.archiveOverrides };
  if (v) next[field] = v; else delete next[field];
  if ((design.archiveOverrides?.[field] ?? "") === v) return design;
  return { ...design, archiveOverrides: Object.keys(next).length ? next : undefined };
}

/** The template's `[watchface_id]`, the always-on file's first (CorosLink's placeholder). */
export function templateWatchfaceId(details: CorosWatchfaceTemplateDetails): string | undefined {
  return details.resolutions.find((r) => r.aodConfig?.watchface_id)?.aodConfig.watchface_id
    ?? details.resolutions.find((r) => r.config.watchface_id)?.config.watchface_id;
}
