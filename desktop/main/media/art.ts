// Cover art for the Media page. The page may show images only from the app itself (its CSP), so playlist, song,
// podcast and LibriVox covers come through here: fetched by the main process from the services' own image hosts only, kept on
// disk (media/art) so each is downloaded once, and served from clink://app/api/desktop/media/art.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const HOSTS = [/^i\.scdn\.co$/, /^mosaic\.scdn\.co$/, /^[\w-]+\.spotifycdn\.com$/, /^[\w-]+\.mzstatic\.com$/, /^i\d?\.ytimg\.com$/, /^yt\d\.ggpht\.com$/, /^lh\d\.googleusercontent\.com$/, /^archive\.org$/];
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = /^image\/(jpeg|png|webp|gif)$/;

/** Whether the app fetches covers from this address: https on one of the services' image hosts. */
export function artAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.port && HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

/** The address the page uses for a cover, or null when it has none (or it's from somewhere else). */
export const artPath = (raw: string | null | undefined): string | null => (raw && artAllowed(raw) ? `/api/desktop/media/art?u=${encodeURIComponent(raw)}` : null);

export class Art {
  private readonly folder: string;
  private readonly inFlight = new Map<string, Promise<{ type: string; body: Buffer } | null>>();

  constructor(data: string, private readonly get: typeof fetch = fetch) {
    this.folder = path.join(data, "media", "art");
  }

  private async load(raw: string): Promise<{ type: string; body: Buffer } | null> {
    const key = createHash("sha1").update(raw).digest("hex");
    const file = path.join(this.folder, key);
    try {
      const saved = await readFile(file);
      const type = saved.subarray(0, 32).toString("latin1").split("\n")[0];
      return { type, body: saved.subarray(type.length + 1) };
    } catch { /* not saved yet */ }
    const answer = await this.get(raw, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    const type = (answer.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!answer.ok || !TYPES.test(type)) return null;
    const body = Buffer.from(await answer.arrayBuffer());
    if (body.length > MAX_BYTES) return null;
    await mkdir(this.folder, { recursive: true });
    await writeFile(file, Buffer.concat([Buffer.from(`${type}\n`, "latin1"), body]));
    return { type, body };
  }

  async answer(raw: string): Promise<Response> {
    if (!artAllowed(raw)) return new Response("Not a cover", { status: 404 });
    let pending = this.inFlight.get(raw);
    if (!pending) {
      pending = this.load(raw).catch(() => null).finally(() => this.inFlight.delete(raw));
      this.inFlight.set(raw, pending);
    }
    const art = await pending;
    if (!art) return new Response("No cover", { status: 404 });
    return new Response(new Uint8Array(art.body), { headers: { "Content-Type": art.type, "Cache-Control": "private, max-age=604800" } });
  }
}
