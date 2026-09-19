import { normalizeConversionPath } from "./watchfaceArchiveConversion";

export type WatchfacePackageEntry = { name: string; data: Buffer };

export type StandardizedWatchfacePackage = {
  entries: WatchfacePackageEntry[];
  /** Entry names dropped because the website validator would reject them. */
  removed: string[];
  /** True when the package must be rebuilt; false means the source bytes already conform. */
  changed: boolean;
};

// These mirror the CorosLink website's DAT validator (validateCorosDatStructure
// and datInfoSchema). A distributable package holds info.json, the customize
// preview, and resolution trees of json/png/txt assets. Official editable
// templates also ship cached firmware builds, thumbnail caches and PDF digit
// sources, which the website tolerates. Everything else (editor recovery
// blobs, Finder metadata, stray files) is rejected on upload.
const RESOLUTION_ROOT = "watchface_[1-9][0-9]{1,3}x[1-9][0-9]{1,3}";
const WATCHFACE_ASSET = new RegExp(`^(${RESOLUTION_ROOT})/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\\.(?:json|png|txt)$`, "u");
const WATCHFACE_DIRECTORY = new RegExp(`^(${RESOLUTION_ROOT})/(?:[A-Za-z0-9._-]+/)*$`, "u");
const TEMPLATE_COMPANION = new RegExp(
  `^${RESOLUTION_ROOT}/(?:watchface(?:_ota)?\\.bin|(?:[A-Za-z0-9._-]+/)*[Tt][Hh][Uu][Mm][Bb][Ss]\\.[Dd][Bb]|(?:[A-Za-z0-9._-]+/)*PDF/[A-Za-z0-9._-]+\\.pdf)$`,
  "u"
);
const PREVIEW_NAME = "watchface_customize.png";

export function isDistributableWatchfaceEntry(name: string): boolean {
  return name === "info.json" || name === PREVIEW_NAME || WATCHFACE_ASSET.test(name) || TEMPLATE_COMPANION.test(name);
}

function rootSize(root: string): number {
  return Number(root.match(/^watchface_(\d+)x/)?.[1] ?? 0);
}

/**
 * Patches info.json as raw text so `o_template_id` (which exceeds
 * Number.MAX_SAFE_INTEGER on official faces) is never JSON round-tripped.
 */
function standardizeInfo(rawInfo: string, roots: Set<string>, fallbackName: string | undefined): string {
  let info = rawInfo;
  if (!/"m_preview"\s*:/.test(info)) {
    info = info.replace(/^(\s*\{)/, `$1"m_preview":${JSON.stringify(PREVIEW_NAME)},`);
  } else {
    info = info.replace(/"m_preview"\s*:\s*"(?:\\.|[^"\\])*"/, () => `"m_preview":${JSON.stringify(PREVIEW_NAME)}`);
  }
  const currentApp = info.match(/"m_app"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
  if (roots.size && (!currentApp || !roots.has(currentApp))) {
    // Studio authors at 800px; otherwise point at the largest layout present.
    const preferred = roots.has("watchface_800x800")
      ? "watchface_800x800"
      : [...roots].sort((left, right) => rootSize(right) - rootSize(left))[0]!;
    info = currentApp === undefined
      ? info.replace(/^(\s*\{)/, `$1"m_app":${JSON.stringify(preferred)},`)
      : info.replace(/"m_app"\s*:\s*"(?:\\.|[^"\\])*"/, () => `"m_app":${JSON.stringify(preferred)}`);
  }
  if (fallbackName && !/"m_name"\s*:/.test(info)) {
    info = info.replace(/^(\s*\{)/, `$1"m_name":${JSON.stringify(fallbackName)},`);
  }
  return info;
}

/**
 * Reduces a watch-face archive to what the CorosLink website accepts. Recovery
 * blobs and other non-standard entries are dropped, resolution separators are
 * normalized, and info.json gains the DIY fields official templates carry.
 * The desktop's own readers need none of the removed entries: native-resolution
 * export keys off `coroslinkRecovery` in info.json and the resolution tree.
 */
export function standardizeWatchfacePackage(
  files: WatchfacePackageEntry[],
  directories: string[] = [],
  fallbackName?: string
): StandardizedWatchfacePackage {
  const removed: string[] = [];
  let renamed = false;
  const kept: WatchfacePackageEntry[] = [];
  for (const file of files) {
    const name = normalizeConversionPath(file.name);
    if (name !== file.name) renamed = true;
    if (!isDistributableWatchfaceEntry(name)) {
      removed.push(file.name);
      continue;
    }
    kept.push({ name, data: file.data });
  }

  const roots = new Set<string>();
  for (const entry of kept) {
    const match = WATCHFACE_ASSET.exec(entry.name);
    if (match) roots.add(match[1]!);
  }

  let infoChanged = false;
  const entries = kept.map((entry) => {
    if (entry.name !== "info.json") return entry;
    const rawInfo = entry.data.toString("utf8");
    const info = standardizeInfo(rawInfo, roots, fallbackName);
    if (info === rawInfo) return entry;
    infoChanged = true;
    return { name: entry.name, data: Buffer.from(info, "utf8") };
  });

  // createStoreZip writes no directory records, so a rebuild sheds any that
  // the website would reject (unknown roots, Finder folders, loose paths).
  const directoriesConform = directories.every((name) => {
    const match = WATCHFACE_DIRECTORY.exec(normalizeConversionPath(name));
    return Boolean(match && roots.has(match[1]!));
  });

  return {
    entries,
    removed,
    changed: removed.length > 0 || renamed || infoChanged || !directoriesConform
  };
}
