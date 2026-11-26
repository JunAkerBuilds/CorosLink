// Converting a Studio project to another watch: a new starter for the destination, built from the project's starter
// (its 800 px master) and the design's raw layout edits. Rewritten from CorosLink's corosWatchfaceService.ts
// (conversionCarrier, convertCorosWatchfaceArchive) for this app: no Electron in here (the data folder is passed in),
// and the destination's template list and downloads are handed in, so this works with Studio's catalog signed out.
//
// The carrier, one of COROS's editable templates for the destination watch, gives the new starter its template ID and
// per-size watchface IDs; COROS compiles only the slots that template declares, so the one covering most of the face's
// keys is picked. It is kept in <folder>/carriers for offline use. With none at all a local carrier (template ID 0)
// is used: the face installs over Bluetooth but has no COROS template to publish.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createStoreZip } from "../../watchface/zipStore";
import { validateConfigTextReplacements } from "../../watchface/archive/config";
import {
  MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_FILES, openTemplate, validateArchiveInventory,
} from "../../watchface/archive/template";
import {
  configKeysOf, convertWatchfaceEntries, declaredConfigKeys, isLocalTemplateId, localConversionCarrier, type WatchfaceConversionEntry,
} from "../../watchface/archive/conversion";
import type { WatchfaceTarget } from "../../watchface/watchfaceTargets";
import { t } from "@/lib/i18n";

export { isLocalTemplateId };

/** How many of the destination's templates are tried for a carrier. */
const MAX_CARRIER_SCAN = 8;

/** The destination watch's editable templates: Studio's catalog list and download. */
export interface CarrierTemplates {
  templates(target: WatchfaceTarget): Promise<Array<{ id: string; name: string }>>;
  download(target: WatchfaceTarget, id: string): Promise<Buffer>;
}

export interface ConvertOptions {
  /** The design's raw layout edits, by config path in the source starter. */
  configTextEdits?: Record<string, string>;
  /** False leaves an AMOLED destination with no always-on layout when the source has none. */
  generateAod?: boolean;
}

export interface ConvertedStarter {
  /** The new starter (a stored ZIP) for the destination watch. */
  starter: Buffer;
  /** The carrier's o_template_id as decimal text; "0" for a local carrier (see isLocalTemplateId). */
  sourceTemplateId: string;
  appliedRawConfigEditCount: number;
  /** True when an AMOLED destination got an always-on layout copied from Current, to be reviewed. */
  generatedAod: boolean;
  /** How much the design's always-on sizes grow because its AOD now sits on the 800 master. */
  aodDesignScale: number;
}

interface CarrierMeta { scanned: boolean; keys: string[] }

/** The files of an archive, checked the way a template is. */
function entriesOf(bytes: Buffer, label: string): WatchfaceConversionEntry[] {
  if (bytes.length <= 0 || bytes.length > MAX_ARCHIVE_BYTES) throw new Error(label === "conversion template" ? t("The conversion template must be between 1 byte and 100 MB.") : t("The watch-face archive must be between 1 byte and 100 MB."));
  const { files } = openTemplate(bytes);
  validateArchiveInventory(files, MAX_ARCHIVE_FILES, MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_ENTRY_BYTES, 7, label);
  return files.map(entry => ({ name: entry.path, data: entry.read() }));
}

const hasEverySize = (entries: WatchfaceConversionEntry[], target: WatchfaceTarget) =>
  target.sizes.every(size => entries.some(entry => entry.name === `watchface_${size}x${size}/config.txt`));

/** info.json's o_template_id as written, without parsing the number (it can exceed 2^53). */
function templateIdOf(entries: WatchfaceConversionEntry[]): string {
  const info = entries.find(entry => entry.name === "info.json")?.data.toString("utf8") ?? "";
  const id = info.match(/"o_template_id"\s*:\s*"?(\d+)"?/)?.[1];
  if (!id) throw new Error(t("The destination has no template identity."));
  return id;
}

export class WatchfaceConverter {
  private readonly carriers: string;

  /** `folder` is Studio's data folder; carriers are kept in its carriers/ folder. */
  constructor(folder: string, private readonly catalog?: CarrierTemplates) {
    this.carriers = path.join(folder, "carriers");
  }

  /** A new starter for `target` from a project's starter. The source is never changed. */
  async convert(source: Buffer, target: WatchfaceTarget, options: ConvertOptions = {}): Promise<ConvertedStarter> {
    const sourceEntries = entriesOf(source, "watch-face archive");
    if (!sourceEntries.some(entry => entry.name === "watchface_800x800/config.txt")) {
      throw new Error(t("This face has no 800 px master, so it can't be converted yet."));
    }
    const edits = Object.fromEntries(validateConfigTextReplacements(
      Object.entries(options.configTextEdits ?? {}).map(([path, text]) => ({ path, text }))));
    const carrier = await this.carrier(target, configKeysOf(sourceEntries));
    const converted = convertWatchfaceEntries(sourceEntries, carrier, target, edits, options.generateAod !== false);
    validateArchiveInventory(converted.entries.map(entry => ({ path: entry.name, size: entry.data.length })),
      MAX_ARCHIVE_FILES, MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_ENTRY_BYTES, 7, "converted watch-face archive");
    const starter = createStoreZip(converted.entries);
    if (starter.length > MAX_ARCHIVE_BYTES) throw new Error(t("The converted archive exceeds 100 MB."));
    return {
      starter, sourceTemplateId: templateIdOf(carrier), appliedRawConfigEditCount: converted.appliedRawConfigEditCount,
      generatedAod: converted.generatedAod, aodDesignScale: converted.aodDesignScale,
    };
  }

  /**
   * The carrier for building a face from its own layout for `target` (a face recovered from a BIN, or with no 800 px
   * master): picked for the keys the face's layouts use, as for a conversion.
   */
  async nativeCarrier(source: Buffer, target: WatchfaceTarget): Promise<WatchfaceConversionEntry[]> {
    return this.carrier(target, configKeysOf(entriesOf(source, "watch-face archive")));
  }

  /**
   * The destination's carrier, picked for the keys this face uses (`wanted`). A cached carrier is used as it is when
   * it was chosen from a scan or already declares every wanted key; otherwise the catalog is scanned again. When the
   * scan fails the cache still converts, and with no cache a local carrier does.
   */
  async carrier(target: WatchfaceTarget, wanted: Set<string> = new Set()): Promise<WatchfaceConversionEntry[]> {
    const zipPath = path.join(this.carriers, `${target.model}.zip`);
    const metaPath = path.join(this.carriers, `${target.model}.carrier.json`);
    let cached: WatchfaceConversionEntry[] | undefined;
    try {
      const entries = entriesOf(await fs.promises.readFile(zipPath), "conversion template");
      if (hasEverySize(entries, target)) cached = entries;
    } catch { /* Fetched on first use. */ }
    if (cached) {
      let meta: CarrierMeta | undefined;
      try { meta = JSON.parse(await fs.promises.readFile(metaPath, "utf8")) as CarrierMeta; } catch { /* Written before scans were recorded. */ }
      const keys = new Set(Array.isArray(meta?.keys) ? meta.keys : declaredConfigKeys(cached));
      // A scanned carrier is already the best the catalog offered.
      if (meta?.scanned === true || [...wanted].every(key => keys.has(key))) return cached;
    }
    try {
      return await this.scan(target, wanted, zipPath, metaPath);
    } catch {
      return cached ?? localConversionCarrier(target);
    }
  }

  private async scan(target: WatchfaceTarget, wanted: Set<string>, zipPath: string, metaPath: string): Promise<WatchfaceConversionEntry[]> {
    if (!this.catalog) throw new Error(t("No template catalog."));
    const rank = (name: string) => /^(BOLD|SIMPLE)$/i.test(name.trim()) ? 0 : 1;
    const ranked = [...await this.catalog.templates(target)].sort((a, b) => rank(a.name) - rank(b.name) || a.id.localeCompare(b.id));
    let best: { bytes: Buffer; entries: WatchfaceConversionEntry[]; keys: Set<string>; covered: number } | undefined;
    for (const template of ranked.slice(0, MAX_CARRIER_SCAN)) {
      const bytes = await this.catalog.download(target, template.id);
      let entries: WatchfaceConversionEntry[];
      try { entries = entriesOf(bytes, "conversion template"); templateIdOf(entries); } catch { continue; }
      if (!hasEverySize(entries, target)) continue;
      const keys = declaredConfigKeys(entries);
      const covered = [...wanted].filter(key => keys.has(key)).length;
      if (!best || covered > best.covered) best = { bytes, entries, keys, covered };
      if (best.covered === wanted.size) break;
    }
    if (!best) throw new Error(t("COROS did not provide a complete {watch} conversion template.", { watch: target.label }));
    await fs.promises.mkdir(this.carriers, { recursive: true });
    const temp = `${zipPath}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temp, best.bytes);
      await fs.promises.rename(temp, zipPath);
      await fs.promises.writeFile(metaPath, JSON.stringify({ scanned: true, keys: [...best.keys] } satisfies CarrierMeta));
    } catch {
      // Not kept for offline use this time; the conversion itself still goes ahead.
      await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    }
    return best.entries;
  }
}
