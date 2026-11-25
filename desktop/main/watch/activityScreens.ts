// Developer → Activity screens (CorosLink's corosActivityScreenService.ts, rewritten): a PACE Pro activity's data pages
// over the Local mode watch link. Developer mode only, and experimental. Safety rules carried over:
// - every write is preceded by a backup of what the watch has, and a journal naming the backup to restore, both on
//   disk before the first byte goes out; the journal clears only once the read-back matches what was sent;
// - while a journal is left (an interrupted write) nothing else is written but that restore;
// - a new layout needs the unchanged pages synced and read back first (the baseline), and the experimental field
//   counts need that baseline confirmed on the watch by the person;
// - what was read is trusted only on the same connection, the same watch and firmware, and for 15 minutes.
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildLayout, decodePages, decodeSports, digest, EXPERIMENTAL_COUNTS, isExperimentalPage, PRESET_COUNTS, requireAck, sportOf, supportedCounts,
  type Page, type Sport,
} from "./activityScreensProtocol";

export interface Device { key: string; name: string; model: string; firmware: string }
export interface ScreensDocument {
  id: string; device: Device; sport: Sport; readAt: number; digest: string; pages: Page[];
  baseline: "unverified" | "read-back-verified" | "watch-confirmed";
}
export interface Backup { id: string; createdAt: number; device: Device; sport: Sport; pageCount: number; digest: string; reason: "manual" | "before-sync" | "before-restore" }
export interface Preview { id: string; sourceId: string; pageIndex: number; fieldCount: number; experimental: boolean; page: Page }
export interface WriteResult { document: ScreensDocument; backup: Backup; verified: true }

export interface ActivityScreensDeps {
  enabled(): boolean;
  /** The connected watch and the session it's on; device is null while none is connected. */
  link(): { device: Device | null; session: string };
  exchange(op: "read" | "write", payload: Buffer): Promise<Buffer>;
  folder: string;
  now?: () => number;
}

interface Held { document: ScreensDocument; payload: Buffer; session: string }
interface Proof { digest: string; confirmed: boolean; session: string }
interface BackupFile { version: 1; backup: Backup; payloadHex: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FRESH_MS = 15 * 60_000;
const isPacePro = (model: string) => /^pace[ -]?pro$/i.test(model.trim());

export class ActivityScreens {
  private readonly documents = new Map<string, Held>();
  private readonly previews = new Map<string, { preview: Preview; payload: Buffer }>();
  private readonly proofs = new Map<string, Proof>();
  private readonly now: () => number;

  constructor(private readonly deps: ActivityScreensDeps) { this.now = deps.now ?? Date.now; }

  private device(): Device {
    if (!this.deps.enabled()) throw new Error("Activity screens are in developer mode only.");
    const device = this.deps.link().device;
    if (!device || !isPacePro(device.model) || !device.key || !device.firmware) throw new Error("Connect a PACE Pro in Local mode first.");
    return device;
  }

  private proofKey = (device: Device, sportId: number) => JSON.stringify([device.key, device.firmware, sportId]);

  /** An exchange that fails if the link changed under it. */
  private async exchange(op: "read" | "write", payload: Buffer, session: string): Promise<Buffer> {
    if (this.deps.link().session !== session) throw new Error("The watch connection changed. Read its pages again.");
    const answer = await this.deps.exchange(op, payload);
    if (this.deps.link().session !== session) throw new Error("The watch connection changed during the sync.");
    return answer;
  }

  private remember(payload: Buffer, device: Device, session: string): ScreensDocument {
    const sportId = payload[0], key = this.proofKey(device, sportId), sum = digest(payload);
    const proof = this.proofs.get(key);
    if (proof && (proof.digest !== sum || proof.session !== session)) this.proofs.delete(key);
    const valid = this.proofs.get(key);
    const document: ScreensDocument = {
      id: randomUUID(), device: { ...device }, sport: sportOf(sportId), readAt: this.now(), digest: sum, pages: decodePages(payload, sportId),
      baseline: valid ? (valid.confirmed ? "watch-confirmed" : "read-back-verified") : "unverified",
    };
    if (this.documents.size >= 30) this.documents.delete(this.documents.keys().next().value!);
    this.documents.set(document.id, { document, payload: Buffer.from(payload), session });
    return document;
  }

  private held(id: unknown): Held {
    const held = typeof id === "string" ? this.documents.get(id) : undefined;
    const device = this.device();
    if (!held || held.session !== this.deps.link().session || held.document.device.key !== device.key || held.document.device.firmware !== device.firmware
      || this.now() - held.document.readAt > FRESH_MS) throw new Error("Read the watch's pages again before going on.");
    return held;
  }

  private async readPayload(sportId: number, session: string): Promise<Buffer> {
    sportOf(sportId);
    const payload = await this.exchange("read", Buffer.from([sportId]), session);
    decodePages(payload, sportId);
    return payload;
  }

  private async unchanged(held: Held): Promise<Buffer> {
    const payload = await this.readPayload(held.document.sport.id, held.session);
    if (!payload.equals(held.payload)) throw new Error("The pages on the watch changed. Read them again before syncing.");
    return payload;
  }

  async sports(): Promise<Sport[]> {
    this.device();
    return decodeSports(await this.exchange("read", Buffer.from([255]), this.deps.link().session));
  }

  async read(sportId: number): Promise<ScreensDocument> {
    const device = this.device(), session = this.deps.link().session;
    return this.remember(await this.readPayload(sportId, session), device, session);
  }

  // ── Backups and the journal ──

  private async dir(): Promise<string> {
    await mkdir(this.deps.folder, { recursive: true, mode: 0o700 });
    return this.deps.folder;
  }

  private backupFile(dir: string, id: string): string {
    if (!UUID.test(id)) throw new Error("Pick a saved backup.");
    return path.join(dir, `${id}.json`);
  }

  /** Written once, flushed to disk, never overwritten. */
  private async durable(file: string, text: string): Promise<void> {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  }

  private async saveBackup(payload: Buffer, device: Device, reason: Backup["reason"]): Promise<Backup> {
    const sportId = payload[0], pages = decodePages(payload, sportId);
    if (!pages.length) throw new Error("Empty pages can't be backed up for a sync: writing them would reset the activity.");
    const backup: Backup = { id: randomUUID(), createdAt: this.now(), device: { ...device }, sport: sportOf(sportId), pageCount: pages.length, digest: digest(payload), reason };
    const stored: BackupFile = { version: 1, backup, payloadHex: payload.toString("hex") };
    await this.durable(this.backupFile(await this.dir(), backup.id), `${JSON.stringify(stored, null, 2)}\n`);
    return backup;
  }

  private async loadBackup(id: string): Promise<BackupFile> {
    if (!this.deps.enabled()) throw new Error("Activity screens are in developer mode only.");
    const file = this.backupFile(await this.dir(), id);
    if ((await stat(file)).size > 32_768) throw new Error("That backup is too large.");
    const value = JSON.parse(await readFile(file, "utf8")) as BackupFile;
    const b = value?.backup;
    if (value?.version !== 1 || b?.id !== id || !b.device?.key || !isPacePro(b.device.model ?? "") || !Number.isFinite(b.createdAt)
      || !["manual", "before-sync", "before-restore"].includes(b.reason) || typeof value.payloadHex !== "string" || !/^([0-9a-f]{2})+$/.test(value.payloadHex)) {
      throw new Error("That backup is damaged.");
    }
    const payload = Buffer.from(value.payloadHex, "hex");
    if (decodePages(payload, b.sport.id).length !== b.pageCount || !b.pageCount || digest(payload) !== b.digest) throw new Error("That backup failed its check.");
    return value;
  }

  async backups(): Promise<Backup[]> {
    const names = await readdir(await this.dir());
    const found: Backup[] = [];
    for (const name of names.filter((n) => n.endsWith(".json") && UUID.test(n.slice(0, -5)))) {
      // A damaged backup is never offered for a restore.
      try { found.push((await this.loadBackup(name.slice(0, -5))).backup); } catch { /* skipped */ }
    }
    return found.sort((a, b) => b.createdAt - a.createdAt);
  }

  private async journal(backupId: string): Promise<void> {
    const dir = await this.dir(), temp = path.join(dir, `pending-${randomUUID()}.tmp`);
    await this.durable(temp, `${JSON.stringify({ version: 1, backupId })}\n`);
    await rename(temp, path.join(dir, "pending-restore.json"));
  }

  private async clearJournal(): Promise<void> { await rm(path.join(await this.dir(), "pending-restore.json"), { force: true }); }

  async status(): Promise<{ enabled: boolean; pendingRestore: Backup | null; supportedFieldCounts: number[] }> {
    if (!this.deps.enabled()) return { enabled: false, pendingRestore: null, supportedFieldCounts: [] };
    const file = path.join(await this.dir(), "pending-restore.json");
    let text: string;
    try {
      if ((await stat(file)).size > 1024) throw new Error("The interrupted-sync journal is damaged.");
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, pendingRestore: null, supportedFieldCounts: supportedCounts() };
      throw error;
    }
    const journal = JSON.parse(text) as { version?: unknown; backupId?: unknown };
    if (journal?.version !== 1 || typeof journal.backupId !== "string" || !UUID.test(journal.backupId)) throw new Error("The interrupted-sync journal is damaged.");
    // A journal whose backup is gone blocks writes; it never reads as a finished sync.
    return { enabled: true, pendingRestore: (await this.loadBackup(journal.backupId)).backup, supportedFieldCounts: supportedCounts() };
  }

  async exportBackup(id: string): Promise<string> { return `${JSON.stringify(await this.loadBackup(id), null, 2)}\n`; }

  async backup(snapshotId: string): Promise<Backup> {
    const held = this.held(snapshotId);
    return this.saveBackup(await this.unchanged(held), this.device(), "manual");
  }

  // ── Writes ──

  private async write(payload: Buffer, before: Buffer, device: Device, session: string, reason: Backup["reason"], restoring?: string): Promise<WriteResult> {
    const sportId = payload[0];
    if (!decodePages(payload, sportId).length) throw new Error("Sending empty pages would reset the activity. Use a backup with pages in it.");
    const pending = (await this.status()).pendingRestore;
    if (pending && pending.id !== restoring) throw new Error("Restore the interrupted sync's backup before another write.");
    const backup = await this.saveBackup(before, device, reason);
    const recovery = restoring ?? backup.id;
    // Backup and journal are on disk before the first byte goes to the watch, even for the unchanged baseline.
    await this.journal(recovery);
    try {
      requireAck(await this.exchange("write", payload, session));
      const back = await this.readPayload(sportId, session);
      if (!back.equals(payload)) throw new Error("The pages read back differ from the ones sent.");
      await this.clearJournal();
      return { document: this.remember(back, device, session), backup, verified: true };
    } catch (error) {
      this.proofs.delete(this.proofKey(device, sportId));
      throw new Error(`${error instanceof Error ? error.message : "The sync failed."} The pages from before are saved in backup ${recovery}: restore it before another write.`);
    }
  }

  /** Syncs the pages back unchanged and reads them back: the baseline a new layout is tried against. */
  async syncBaseline(snapshotId: string): Promise<WriteResult> {
    const held = this.held(snapshotId);
    if (held.document.pages.some(isExperimentalPage)) throw new Error("These pages still hold an experimental layout. Restore the standard backup before syncing a baseline.");
    const before = await this.unchanged(held), device = this.device();
    const result = await this.write(held.payload, before, device, held.session, "before-sync");
    if (result.document.pages.some((p) => p.kind === "grid" && (PRESET_COUNTS as readonly number[]).includes(p.fieldCount ?? 0))) {
      this.proofs.set(this.proofKey(device, result.document.sport.id), { digest: result.document.digest, confirmed: false, session: held.session });
      result.document.baseline = "read-back-verified";
    }
    return result;
  }

  /** The person checked the pages on the watch and they match. */
  async confirmBaseline(snapshotId: string): Promise<ScreensDocument> {
    const held = this.held(snapshotId), device = this.device();
    if (held.document.pages.some(isExperimentalPage)) throw new Error("Restore the standard backup before confirming a baseline.");
    const proof = this.proofs.get(this.proofKey(device, held.document.sport.id));
    if (!proof || proof.session !== held.session || proof.digest !== held.document.digest) throw new Error("Sync the unchanged pages and let them read back before confirming.");
    await this.unchanged(held);
    proof.confirmed = true;
    return this.remember(held.payload, device, held.session);
  }

  preview(snapshotId: string, pageIndex: number, fieldCount: number): Preview {
    const held = this.held(snapshotId), experimental = (EXPERIMENTAL_COUNTS as readonly number[]).includes(fieldCount);
    const proof = this.proofs.get(this.proofKey(this.device(), held.document.sport.id));
    if (experimental && (!proof?.confirmed || proof.session !== held.session || proof.digest !== held.document.digest)) throw new Error("Confirm the standard pages on the watch before trying experimental layouts.");
    if (fieldCount === 9 && held.document.pages.some(isExperimentalPage)) throw new Error("Restore the standard backup, sync it and confirm it before trying nine fields.");
    const payload = buildLayout(held.payload, held.document.sport.id, pageIndex, fieldCount);
    const preview: Preview = { id: randomUUID(), sourceId: snapshotId, pageIndex, fieldCount, experimental, page: decodePages(payload, held.document.sport.id)[pageIndex] };
    if (this.previews.size >= 30) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.id, { preview, payload });
    return preview;
  }

  async apply(previewId: string): Promise<WriteResult> {
    const prepared = this.previews.get(previewId);
    if (!prepared) throw new Error("Preview the layout again before syncing it.");
    const held = this.held(prepared.preview.sourceId), device = this.device(), key = this.proofKey(device, held.document.sport.id);
    const proof = this.proofs.get(key);
    if (!proof || proof.session !== held.session || proof.digest !== held.document.digest || (prepared.preview.experimental && !proof.confirmed)) {
      throw new Error("Sync the unchanged pages first, so there's a baseline to come back to.");
    }
    const before = await this.unchanged(held), confirmed = proof.confirmed;
    const result = await this.write(prepared.payload, before, device, held.session, "before-sync");
    this.proofs.set(key, { digest: result.document.digest, confirmed, session: held.session });
    result.document.baseline = confirmed ? "watch-confirmed" : "read-back-verified";
    this.previews.delete(previewId);
    return result;
  }

  async restore(backupId: string): Promise<WriteResult> {
    const stored = await this.loadBackup(backupId), device = this.device(), session = this.deps.link().session;
    if (stored.backup.device.key !== device.key || stored.backup.device.firmware !== device.firmware) throw new Error("Connect the PACE Pro this backup came from, on the same firmware, to restore it.");
    const before = await this.readPayload(stored.backup.sport.id, session);
    const result = await this.write(Buffer.from(stored.payloadHex, "hex"), before, device, session, "before-restore", backupId);
    this.proofs.delete(this.proofKey(device, stored.backup.sport.id));
    result.document.baseline = "unverified";
    return result;
  }

  /** /api/desktop/developer/activity-screens[/…]. */
  async answer(request: Request): Promise<Response> {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const route = new URL(request.url).pathname.slice("/api/desktop/developer/activity-screens".length) || "/";
    const get = request.method === "GET";
    if (!get && request.headers.get("x-clink-hub") !== "1") return reply({ error: "forbidden", message: "Not from this app." }, 403);
    if (!this.deps.enabled()) return reply({ error: "off", message: "Turn on developer mode." }, 403);
    const body = get ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    const id = (k: string) => String(body[k] ?? "");
    try {
      if (get && route === "/") {
        const { device } = this.deps.link();
        return reply({ ...(await this.status()), device, ready: !!device && isPacePro(device.model) && !!device.firmware, backups: await this.backups() });
      }
      const m = /^\/backups\/([0-9a-f-]{36})\/export$/.exec(route);
      if (get && m) return new Response(await this.exportBackup(m[1]), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="activity-pages-${m[1].slice(0, 8)}.json"` } });
      if (!get) {
        switch (route) {
          case "/sports": return reply({ sports: await this.sports() });
          case "/read": return reply({ document: await this.read(Number(body.sportId)) });
          case "/backup": return reply({ backup: await this.backup(id("snapshotId")) });
          case "/baseline": return reply(await this.syncBaseline(id("snapshotId")));
          case "/confirm": return reply({ document: await this.confirmBaseline(id("snapshotId")) });
          case "/preview": return reply({ preview: this.preview(id("snapshotId"), Number(body.pageIndex), Number(body.fieldCount)) });
          case "/apply": return reply(await this.apply(id("previewId")));
          case "/restore": return reply(await this.restore(id("backupId")));
        }
      }
    } catch (error) {
      return reply({ error: "failed", message: error instanceof Error ? error.message : "That didn't work." }, 400);
    }
    return reply({ error: "notFound" }, 404);
  }
}
