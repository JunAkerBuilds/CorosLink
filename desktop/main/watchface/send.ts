// Send (docs/studio-port.md, phase 6): getting a built face to the watch, the COROS app, the iPhone or a folder.
//
// The page builds a face once ("prepare") and everything after works from that final archive, kept here for 15
// minutes (the 4 most recent), the way CorosLink kept prepared BINs: the compiled 1:1 preview and its pixel checks read
// the archive's own files, Save BIN compiles it, Send to iPhone serves it on the local network (phoneSend.ts), the
// COROS app gets it through the signed-in account (corosShare.ts), and folders take final ZIPs or the unpacked files.
// Folders are picked with the app's own dialog and known to the page only by an id and a name.
//
// Installing over Bluetooth goes through the watch paired in Local mode (watch/service.ts, CorosKit's install with its
// slot rules and read-back); without one, /watch says why and the install route refuses instead of pretending.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describeTemplate, templateAssets } from "../../watchface/archive/template";
import type { CorosWatchfaceTemplateDetails } from "../../watchface/types";
import type { WatchfaceTarget } from "../../watchface/watchfaceTargets";
import { readZip, unsafeZipPath } from "../../watchface/zipRead";

/** Prepared archives stay this long, at most this many (CorosLink: 4 most recent, 15 min). */
export const PREPARED_TTL_MS = 15 * 60_000;
export const MAX_PREPARED = 4;

export interface Prepared {
  id: string;
  projectId: string;
  name: string;
  watch: WatchfaceTarget;
  archive: Buffer;
  at: number;
}

/** What the page gets back from prepare: no bytes, just what it needs to draw and check the face. */
export interface PreparedSummary { id: string; name: string; watch: string; bytes: number; details: CorosWatchfaceTemplateDetails }

export class SendProblem extends Error {
  constructor(message: string, readonly code = "send", readonly status = 400) { super(message); }
}

export function safeFileName(name: string, fallback = "Watch face"): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f<>:"|?*\\/]+/g, "").replace(/^\.+/, "").trim().slice(0, 80);
  return clean || fallback;
}

export class PreparedFaces {
  private readonly items = new Map<string, Prepared>();
  constructor(private readonly now: () => number = Date.now) {}

  add(input: Omit<Prepared, "id" | "at">): Prepared {
    this.prune();
    const item: Prepared = { ...input, id: randomUUID(), at: this.now() };
    this.items.set(item.id, item);
    while (this.items.size > MAX_PREPARED) this.items.delete(this.items.keys().next().value!);
    return item;
  }

  get(id: string): Prepared {
    this.prune();
    const item = this.items.get(id);
    if (!item) throw new SendProblem("Build the face again: the prepared copy is gone.", "expired", 410);
    return item;
  }

  summary(item: Prepared): PreparedSummary {
    return { id: item.id, name: item.name, watch: item.watch.model, bytes: item.archive.length, details: describeTemplate(item.archive, item.id) };
  }

  assets(id: string, paths: unknown) {
    return templateAssets(this.get(id).archive, paths, true);
  }

  private prune(): void {
    const cutoff = this.now() - PREPARED_TTL_MS;
    for (const [id, item] of this.items) if (item.at < cutoff) this.items.delete(id);
  }
}

/** Folders the page picked with the app's dialog, by id; the page never sees or sends a path. */
export class PickedFolders {
  private readonly folders = new Map<string, string>();

  add(folder: string): { id: string; label: string } {
    const id = randomUUID();
    this.folders.set(id, folder);
    while (this.folders.size > 8) this.folders.delete(this.folders.keys().next().value!);
    return { id, label: path.basename(folder) || folder };
  }

  path(id: unknown): string {
    const folder = typeof id === "string" ? this.folders.get(id) : undefined;
    if (!folder) throw new SendProblem("Choose the folder again.", "folder");
    return folder;
  }
}

/** A name not taken in the folder: "Face.zip", "Face 2.zip", … */
export async function freeName(folder: string, name: string, ext: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(folder, `${name}${n > 1 ? ` ${n}` : ""}${ext}`);
    try { await fs.promises.access(candidate); } catch { return candidate; }
  }
  throw new SendProblem("That folder already has too many faces with this name.", "folder");
}

/** Writes a final ZIP into the folder. Returns the file name used. */
export async function saveZipTo(folder: string, name: string, archive: Buffer): Promise<string> {
  const target = await freeName(folder, safeFileName(name), ".zip");
  await fs.promises.writeFile(target, archive, { flag: "wx" });
  return path.basename(target);
}

/**
 * Development export: the archive's config files and images unpacked into a new folder named after the face, the
 * layout a COROS developer edits. Paths are checked as the compiler checks them.
 */
export async function saveUnpackedTo(folder: string, name: string, archive: Buffer): Promise<string> {
  const target = await freeName(folder, safeFileName(name), "");
  const entries = readZip(archive).filter((e) => !e.directory && !e.path.startsWith("__MACOSX/"));
  for (const entry of entries) if (unsafeZipPath(entry.path)) throw new SendProblem("The face has an unsafe file path.", "unsafe");
  await fs.promises.mkdir(target);
  for (const entry of entries) {
    const out = path.join(target, ...entry.path.split("/"));
    if (!out.startsWith(target + path.sep)) throw new SendProblem("The face has an unsafe file path.", "unsafe");
    await fs.promises.mkdir(path.dirname(out), { recursive: true });
    await fs.promises.writeFile(out, entry.read());
  }
  return path.basename(target);
}

/** The watch connection, as far as this app has one. */
export interface WatchConnection { connected: boolean; reason?: string; model?: string }
export const NO_WATCH: WatchConnection = { connected: false, reason: "Studio can't send faces to the watch over Bluetooth yet." };
