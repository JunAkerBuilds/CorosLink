// The cookies the app's server code sets (the sealed local session, COROS and intervals.icu sessions).
// On the desktop they never reach the page: they live here, in the main process, and on disk encrypted.
import { readFile, rename, writeFile } from "node:fs/promises";
import type { Sealer } from "./secrets";

interface Cookie { value: string; path: string; expires: number | null }

export class CookieJar {
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string, private readonly sealer: Sealer, private readonly cookies: Map<string, Cookie>) {}

  /** The saved jar, or an empty one when there is none or it can't be decrypted on this computer. */
  static async open(file: string, sealer: Sealer): Promise<CookieJar> {
    try {
      const { text, stale } = await sealer.decrypt(await readFile(file));
      const jar = new CookieJar(file, sealer, new Map(Object.entries(JSON.parse(text) as Record<string, Cookie>)));
      if (stale) { jar.dirty = true; jar.save(); }
      return jar;
    } catch {
      return new CookieJar(file, sealer, new Map());
    }
  }

  private live(name: string): Cookie | undefined {
    const cookie = this.cookies.get(name);
    if (cookie && cookie.expires !== null && cookie.expires <= Date.now()) {
      this.cookies.delete(name);
      this.dirty = true;
      return undefined;
    }
    return cookie;
  }

  /** A cookie the request at `path` would carry: its own path has to be a prefix, as in a browser. */
  get(name: string, path: string): string | undefined {
    const cookie = this.live(name);
    return cookie && path.startsWith(cookie.path) ? cookie.value : undefined;
  }

  all(path: string): { name: string; value: string }[] {
    return [...this.cookies.keys()].flatMap((name) => {
      const value = this.get(name, path);
      return value === undefined ? [] : [{ name, value }];
    });
  }

  set(name: string, value: string, options: { path?: string; maxAge?: number; expires?: Date } = {}): void {
    const expires = options.maxAge !== undefined ? Date.now() + options.maxAge * 1000 : options.expires ? options.expires.getTime() : null;
    if (value === "" || (expires !== null && expires <= Date.now())) this.cookies.delete(name);
    else this.cookies.set(name, { value, path: options.path ?? "/", expires });
    this.dirty = true;
  }

  delete(name: string): void {
    if (this.cookies.delete(name)) this.dirty = true;
  }

  /** Writes the jar when something changed, one write at a time, through a temporary file. */
  save(): Promise<void> {
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const snapshot = JSON.stringify(Object.fromEntries(this.cookies));
    this.writing = this.writing.then(async () => {
      const temp = `${this.file}.tmp`;
      await writeFile(temp, await this.sealer.encrypt(snapshot), { mode: 0o600 });
      await rename(temp, this.file);
    }).catch((error: unknown) => console.error("Couldn't save the session:", error));
    return this.writing;
  }
}
