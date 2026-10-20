import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fetchCepFile, fetchCepIndex, parseCepFile, watchHour, type CepFile, type CepIndexEntry, type CepSpec } from "./corosWatchCep";

/**
 * Keeps the newest COROS satellite file of each kind (corosWatchCep.ts) on
 * disk for watch syncs, in `satellite-data`. It asks COROS for a newer one
 * when the copy is older than its refresh time (6 hours; 1 hour for
 * the 4-hour RTO) or has run out. The files are public orbit data; nothing
 * about the user is sent to fetch them.
 *
 * Each kind is two files, `cep-<type>.bin` (as COROS serves it) and
 * `cep-<type>.json` (when it was fetched, its type, size, MD5 and start),
 * written to a temp file, fsynced and renamed into place, data first. On load
 * the pair is checked again (type, size, MD5, start, and the whole format
 * check of parseCepFile); a pair that doesn't match is deleted, never sent.
 */

let directory: string | undefined;
const cached = new Map<number, { fetchedAt: number; file: CepFile }>();
const inFlight = new Map<number, Promise<CepFile>>();
/** One list serves the files a sync asks for together (LTO and RTO, or both ELPO files). */
let index: { at: number; entries: Promise<CepIndexEntry[]> } | undefined;
const INDEX_REUSE_MS = 60_000;

interface CepMeta { fetchedAt: number; serverType: number; startSeconds: number; bytes: number; md5: string }

/** Where the cache lives; copies in memory are dropped, so the next use reads (and checks) the files there. */
export function configureCepCache(userDataPath: string): void {
  directory = path.join(userDataPath, "satellite-data");
  cached.clear();
  index = undefined;
}

const names = (spec: CepSpec) => ({ data: `cep-${spec.serverType}.bin`, meta: `cep-${spec.serverType}.json` });

function discard(spec: CepSpec): void {
  if (!directory) return;
  for (const name of Object.values(names(spec))) {
    try { fs.rmSync(path.join(directory, name), { force: true }); } catch { /* the check on load still refuses it */ }
  }
}

function loadFromDisk(spec: CepSpec, now: number): { fetchedAt: number; file: CepFile } | undefined {
  if (!directory) return undefined;
  let meta: Partial<CepMeta>;
  let bytes: Buffer;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(directory, names(spec).meta), "utf8")) as Partial<CepMeta>;
    bytes = fs.readFileSync(path.join(directory, names(spec).data));
  } catch {
    // Missing, or a description that isn't JSON: whatever is there is never used.
    discard(spec);
    return undefined;
  }
  let file: CepFile | undefined;
  try {
    if (meta && typeof meta === "object" && meta.serverType === spec.serverType && meta.bytes === bytes.length &&
        typeof meta.fetchedAt === "number" && Number.isFinite(meta.fetchedAt) &&
        meta.md5 === crypto.createHash("md5").update(bytes).digest("hex")) {
      file = parseCepFile(bytes, spec);
      if (file.startSeconds !== meta.startSeconds) file = undefined;
    }
  } catch {
    file = undefined;
  }
  if (!file) {
    discard(spec);
    return undefined;
  }
  // A fetch time in the future (the clock was ahead) would keep the copy "fresh" for good; treat it as due for a refresh.
  return { fetchedAt: meta.fetchedAt! > now ? 0 : meta.fetchedAt!, file };
}

/** temp file + fsync + rename, so a file is never left half written under its name. */
function writeAtomic(destination: string, bytes: Buffer | string): void {
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(handle, bytes);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* nothing more to clean */ }
    throw error;
  }
}

function saveToDisk(spec: CepSpec, entry: { fetchedAt: number; file: CepFile }): void {
  if (!directory) return;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const { data, startSeconds } = entry.file;
    const meta: CepMeta = { fetchedAt: entry.fetchedAt, serverType: spec.serverType, startSeconds, bytes: data.length, md5: crypto.createHash("md5").update(data).digest("hex") };
    writeAtomic(path.join(directory, names(spec).data), data);
    writeAtomic(path.join(directory, names(spec).meta), JSON.stringify(meta));
  } catch {
    // The memory copy still serves this session; a half-replaced pair fails its check on the next load.
  }
}

function serverIndex(fetchImpl: typeof fetch): Promise<CepIndexEntry[]> {
  if (!index || Date.now() - index.at > INDEX_REUSE_MS) {
    const entries = fetchCepIndex(fetchImpl);
    index = { at: Date.now(), entries };
    entries.catch(() => { if (index?.entries === entries) index = undefined; });
  }
  return index.entries;
}

/** The newest file of a kind: the cached copy while recent and still valid, else a fresh download (or, offline, a copy that hasn't run out). */
export function cepSatelliteData(spec: CepSpec, fetchImpl: typeof fetch = fetch): Promise<CepFile> {
  const key = spec.serverType;
  const now = Date.now();
  const valid = (entry?: { file: CepFile }) => Boolean(entry && entry.file.startHour + entry.file.hours > watchHour(now));
  if (!cached.has(key)) {
    const loaded = loadFromDisk(spec, now);
    if (loaded) cached.set(key, loaded);
  }
  const copy = cached.get(key);
  if (copy && now - copy.fetchedAt < spec.refreshMs && valid(copy)) return Promise.resolve(copy.file);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = serverIndex(fetchImpl)
      .then(entries => fetchCepFile(spec, fetchImpl, entries))
      .then(file => {
        const entry = { fetchedAt: Date.now(), file };
        cached.set(key, entry);
        saveToDisk(spec, entry);
        return file;
      })
      .catch(error => {
        const fallback = cached.get(key);
        if (fallback && valid(fallback)) return fallback.file;
        throw error;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}
