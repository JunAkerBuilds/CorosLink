// The Send dialog's work on the page: the compiled 1:1 preview with its pixel checks (CorosLink's
// WatchfaceExportPreview), what the checks say, the languages line and Convert / All watches through scratch
// projects. Builds and files are the main process's (desktop/main/watchface/send.ts).
import { t } from "@/lib/i18n";
import { renderCompiledWatchfacePreview, type CompiledWatchfaceCheck } from "../watchface/engine/compiledWatchfacePixels";
import { WATCH_LANGUAGE_NAMES } from "../watchface/engine/watchfaceLanguages";
import type { CorosWatchfaceDesignState, CorosWatchfaceTemplateDetails } from "../watchface/types";
import { watchfaceBinTarget, type WatchfaceTarget } from "../watchface/watchfaceTargets";
import { preparedAssets, type ConversionResult, type PreparedFace } from "./studio";

export interface CompiledLook { dataUrl: string; width: number; height: number; checks: Array<CompiledWatchfaceCheck & { mode: "current" | "aod" }> }

/**
 * The face as the watch will draw it: the prepared final archive's own layout for the watch, at its real size, with
 * sample readings. Current always; Always-on too when the face has one, so its checks are listed as well.
 */
export async function compiledLook(face: PreparedFace, watch: WatchfaceTarget): Promise<CompiledLook> {
  const layout = watchfaceBinTarget(watch).layout;
  const resolution = face.details.resolutions.find((r) => r.directory === layout);
  if (!resolution) throw new Error(t("The built face has no {watch} layout.", { watch: watch.label }));
  const cache = new Map<string, Awaited<ReturnType<typeof preparedAssets>>[number]>();
  const load = async (paths: string[]) => {
    const wanted = paths.filter((p) => !cache.has(p));
    for (let i = 0; i < wanted.length; i += 400) for (const a of await preparedAssets(face.id, wanted.slice(i, i + 400))) cache.set(a.path, a);
    return paths.map((p) => cache.get(p)).filter((a): a is NonNullable<typeof a> => !!a);
  };
  const current = await renderCompiledWatchfacePreview(face.details, resolution, "current", load);
  const checks: CompiledLook["checks"] = current.checks.map((c) => ({ ...c, mode: "current" as const }));
  if (Object.keys(resolution.aodConfig ?? {}).length) {
    const aod = await renderCompiledWatchfacePreview(face.details, resolution, "aod", load).catch(() => null);
    for (const c of aod?.checks ?? []) checks.push({ ...c, mode: "aod" });
  }
  return { dataUrl: current.dataUrl, width: current.width, height: current.height, checks };
}

/** A check in words: what it is, where, and the layer Show should pick. */
export function describeCheck(check: CompiledLook["checks"][number], label: (id: string) => string): { title: string; detail: string; layer?: string } {
  const where = check.mode === "aod" ? t("Always-on") : t("Current display");
  const [a, b] = check.layers.map(label);
  switch (check.kind) {
    case "edge": return { title: a ? t("{name} touches the dial edge", { name: a }) : t("Something touches the dial edge"), detail: `${where} · ${t("clipped")}`, layer: check.layers[0] };
    case "overlap": return b
      ? { title: t("{a} sits over {b}", { a: a!, b }), detail: `${where} · ${t("overlap")}`, layer: check.layers[1] }
      : { title: t("{name} overlaps itself", { name: a! }), detail: `${where} · ${t("overlap")}`, layer: check.layers[0] };
    case "missing": return { title: check.file ? t("{file} is missing", { file: check.file }) : t("An image is missing"), detail: `${where} · ${t("the template names it but doesn't have it")}` };
    default: return { title: check.file ? t("{file} didn't load", { file: check.file }) : t("An image didn't load"), detail: where };
  }
}

/** "English, 简体中文" for the languages the weekday is designed for. */
export function languagesLine(design: CorosWatchfaceDesignState): string {
  const langs = design.watchLanguages ?? "all";
  if (langs === "all") return t("All languages");
  if (langs === "english" || !Array.isArray(langs) || !langs.length) return t("English");
  return [t("English"), ...langs.filter((c) => c !== "en").map((c) => WATCH_LANGUAGE_NAMES[c] ?? c)].join(", ");
}

/** "Face (APEX 4)" → "Face": a converted face is named after its watch, and All watches shouldn't stack names. */
export function baseName(name: string, watches: readonly WatchfaceTarget[]): string {
  let base = name.trim();
  for (let hit = watches.find((w) => base.endsWith(` (${w.label})`)); hit; hit = watches.find((w) => base.endsWith(` (${w.label})`))) {
    base = base.slice(0, -(` (${hit.label})`.length)).trimEnd();
  }
  return base || name.trim() || "Watch face";
}

// ───── Convert ─────

/**
 * A face with no 800 px master to carry the design on (recovered from a BIN, or made in the COROS app): Convert rebuilds
 * it for the other watch with the edits applied, and All watches builds it for each watch directly.
 */
export function nativeLayout(details: Pick<CorosWatchfaceTemplateDetails, "resolutions">): boolean {
  // A recovered face has only the layout it was decoded from, never the 800 px master.
  return !details.resolutions.some((r) => r.directory === "watchface_800x800");
}

/** What converting to `target` keeps, said before converting (CorosLink's conversion dialog). */
export function convertDetail(target: WatchfaceTarget, rebuilt: boolean): string {
  const how = rebuilt ? t("Rebuilt from this face's own layout with your edits applied; it opens as a new face to keep editing.")
    : t("From the 800 px master, so nothing is scaled twice; layout, fonts, artwork and data stay editable.");
  const screen = target.display === "mip" ? t("MIP shows Current all the time; colours and fine detail can look different.")
    : t("Always-on stays separate; a face without one gets a copy of Current.");
  const size = target.model === "apex-4" ? t("{size} × {size}, 42 and 46 mm.", { size: target.previewSize }) : `${target.previewSize} × ${target.previewSize}.`;
  return `${how} ${size} ${screen} ${t("This face stays as it is.")}`;
}

/** What the new face needs looking at, said after converting. */
export function convertedNote(target: WatchfaceTarget, result: ConversionResult): string | null {
  const notes = [
    result.generatedAod ? t("Its Always-on layout is a copy of Current: review it before sending.") : "",
    target.display === "mip" && !result.rebuilt ? t("The Always-on design is kept for AMOLED watches.") : "",
    result.noCorosTemplate ? t("COROS couldn't be reached, so it can't be shared through the COROS app; it installs from here.") : "",
  ].filter(Boolean);
  return notes.length ? notes.join(" ") : null;
}
