// Resumable downloads of region map zips (up to ~15 GB). Bytes land in `<file>.part`, with `<file>.part.json` naming
// the URL and the validator (ETag, else Last-Modified) they came from. The next try asks for the rest with Range +
// If-Range: a 206 for exactly that range appends; a 200 means the server ignored the range or the file changed, and
// the download starts over from that same answer. Partials nobody resumed for 30 days are dropped.
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { t } from "@/lib/i18n";

export const PARTIAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface PartialMeta { url: string; validator: string; totalBytes: number }

export class DownloadProblem extends Error {
  constructor(message: string, readonly code = "download") { super(message); }
}

export interface DownloadOptions {
  url: string;
  /** The finished file; `.part` and `.part.json` sit beside it. */
  target: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Received so far (resumed bytes included) and the total, when known. */
  onProgress?: (receivedBytes: number, totalBytes: number | undefined) => void;
}

export const partPath = (target: string) => `${target}.part`;
const metaPath = (target: string) => `${target}.part.json`;

async function readPartial(target: string, url: string): Promise<{ bytes: number; meta: PartialMeta } | null> {
  try {
    const [info, text] = await Promise.all([stat(partPath(target)), readFile(metaPath(target), "utf8")]);
    const meta = JSON.parse(text) as Partial<PartialMeta>;
    if (meta.url !== url || typeof meta.validator !== "string" || !meta.validator || typeof meta.totalBytes !== "number") return null;
    if (info.size <= 0 || info.size >= meta.totalBytes) return null;
    return { bytes: info.size, meta: meta as PartialMeta };
  } catch {
    return null;
  }
}

export async function discardPartial(target: string): Promise<void> {
  await Promise.all([rm(partPath(target), { force: true }), rm(metaPath(target), { force: true })]).catch(() => undefined);
}

/** `bytes 100-199/2000` → start 100, total 2000. */
export function contentRange(header: string | null): { start: number; total: number } | null {
  const m = /^bytes\s+(\d+)-\d+\/(\d+)$/i.exec(header?.trim() ?? "");
  return m ? { start: Number(m[1]), total: Number(m[2]) } : null;
}

/** Downloads `url` to `target`, resuming a `.part` when the server still has the same file. Returns the final size. */
export async function download(options: DownloadOptions): Promise<number> {
  const doFetch = options.fetch ?? fetch;
  const { url, target, signal } = options;
  const partial = await readPartial(target, url);
  if (!partial) await discardPartial(target);
  let response = await doFetch(url, {
    signal,
    ...(partial ? { headers: { Range: `bytes=${partial.bytes}-`, "If-Range": partial.meta.validator } } : {}),
  });

  let from = 0;
  let total: number | undefined;
  if (partial && response.status === 206) {
    const range = contentRange(response.headers.get("content-range"));
    if (range && range.start === partial.bytes && range.total === partial.meta.totalBytes) {
      from = partial.bytes;
      total = range.total;
    } else {
      // A range we didn't ask for: drop what we have and fetch the whole file.
      await response.body?.cancel().catch(() => undefined);
      await discardPartial(target);
      response = await doFetch(url, { signal });
    }
  } else if (partial && response.status === 416) {
    await response.body?.cancel().catch(() => undefined);
    await discardPartial(target);
    response = await doFetch(url, { signal });
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new DownloadProblem(t("COROS's map server answered {status}. Try again later.", { status: response.status }), "server");
  }
  if (response.status === 206 && from === 0) {
    await response.body.cancel().catch(() => undefined);
    throw new DownloadProblem(t("COROS's map server sent part of the file only. Try again."), "server");
  }

  if (from === 0) {
    // A fresh start: no partial, or a 200 because the server ignored the range or the file changed.
    const length = Number(response.headers.get("content-length"));
    total = Number.isFinite(length) && length > 0 ? length : undefined;
    await discardPartial(target);
    const validator = response.headers.get("etag") ?? response.headers.get("last-modified");
    if (validator && total !== undefined) {
      await writeFile(metaPath(target), JSON.stringify({ url, validator, totalBytes: total } satisfies PartialMeta));
    }
  }

  let received = from;
  options.onProgress?.(received, total);
  const output = createWriteStream(partPath(target), { flags: from > 0 ? "a" : "w" });
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!output.write(value)) await once(output, "drain");
      received += value.length;
      options.onProgress?.(received, total);
    }
    output.end();
    await once(output, "finish");
  } catch {
    // Keep every byte that arrived: flush the file rather than throw its buffer away.
    await new Promise<void>((resolve) => { output.once("close", resolve); output.end(); });
    await reader.cancel().catch(() => undefined);
    // The partial stays for the next try.
    if (signal?.aborted) throw new DownloadProblem(t("Download cancelled."), "cancelled");
    throw new DownloadProblem(t("The download stopped. It will pick up where it left off."), "network");
  }
  const size = (await stat(partPath(target))).size;
  if (total !== undefined && size !== total) {
    throw new DownloadProblem(t("The download ended early. It will pick up where it left off."), "network");
  }
  await rename(partPath(target), target);
  await rm(metaPath(target), { force: true });
  return size;
}

/** Drops `.part` files (and their notes) untouched for 30 days, and notes left without a partial. Returns how many. */
export async function prunePartials(folder: string, now = Date.now()): Promise<number> {
  const names = await readdir(folder).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    const full = path.join(folder, name);
    if (name.endsWith(".part")) {
      const info = await stat(full).catch(() => null);
      if (info && now - info.mtimeMs > PARTIAL_MAX_AGE_MS) {
        await discardPartial(full.slice(0, -".part".length));
        removed++;
      }
    } else if (name.endsWith(".part.json") && !names.includes(name.slice(0, -".json".length))) {
      await rm(full, { force: true }).catch(() => undefined);
    }
  }
  return removed;
}
