import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The on-disk half of local data: original files (FIT imports, raw watch
 * sync payloads) under one root, addressed by paths relative to it so a
 * backup can be restored on another computer.
 *
 * Every write goes to a temp file in the destination directory, is fsynced,
 * then renamed into place, so a crash or full disk never leaves a truncated
 * file under its final name, and an existing file is never overwritten.
 */

const LOCAL_ARCHIVE_DIRECTORY = "local-archive";
/** Generous ceiling for one activity file; COROS multi-day recordings stay well below it. */
export const MAX_ARCHIVE_FILE_BYTES = 128 * 1024 * 1024;

export class LocalArchive {
  constructor(readonly root: string) {}

  static forUserData(userDataPath: string): LocalArchive {
    return new LocalArchive(path.join(userDataPath, LOCAL_ARCHIVE_DIRECTORY));
  }

  /** Resolves a stored relative path, refusing anything that escapes the root. */
  resolve(relativePath: string): string {
    if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
      throw new Error("Invalid local archive path.");
    }
    const resolved = path.resolve(this.root, relativePath);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid local archive path.");
    return resolved;
  }

  relative(absolutePath: string): string {
    return path.relative(this.root, absolutePath).split(path.sep).join("/");
  }

  /** Content-addressed location: raw/<kind>/<sha[0..2]>/<sha>.<ext>. */
  contentPath(kind: "fit" | "watch-sync", sha256: string, extension: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256) || !/^[a-z0-9]{1,8}$/.test(extension)) throw new Error("Invalid archive key.");
    return `${kind}/${sha256.slice(0, 2)}/${sha256}.${extension}`;
  }

  /**
   * Stores bytes at a content-addressed path. Idempotent: if the file is
   * already present with the same hash it is kept as is.
   */
  async storeContent(kind: "fit" | "watch-sync", bytes: Uint8Array, extension: string): Promise<{ relativePath: string; sha256: string; sizeBytes: number }> {
    if (bytes.byteLength > MAX_ARCHIVE_FILE_BYTES) throw new Error("The file is too large to archive.");
    const sha256 = sha256Hex(bytes);
    const relativePath = this.contentPath(kind, sha256, extension);
    const destination = this.resolve(relativePath);
    if (fs.existsSync(destination) && (await sha256File(destination)) === sha256) {
      return { relativePath, sha256, sizeBytes: bytes.byteLength };
    }
    await writeFileAtomic(destination, bytes);
    return { relativePath, sha256, sizeBytes: bytes.byteLength };
  }

  /** Moves a fully written and verified temp file into its content-addressed place. */
  async adoptFile(kind: "fit" | "watch-sync", temporaryPath: string, sha256: string, extension: string): Promise<string> {
    const relativePath = this.contentPath(kind, sha256, extension);
    const destination = this.resolve(relativePath);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (fs.existsSync(destination) && (await sha256File(destination)) === sha256) {
      await fs.promises.rm(temporaryPath, { force: true });
      return relativePath;
    }
    await fs.promises.rename(temporaryPath, destination);
    await fsyncDirectory(path.dirname(destination));
    return relativePath;
  }

  /** Scratch space for in-progress transfers, inside the archive so renames stay on one volume. */
  partialDirectory(): string {
    return path.join(this.root, "partial");
  }

  async usageBytes(): Promise<number> {
    let total = 0;
    const walk = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[];
      try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) total += (await fs.promises.stat(full)).size;
      }
    };
    await walk(this.root);
    return total;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.promises.open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Windows cannot fsync directories; rename is still atomic there.
  }
}

/** temp + fsync + rename + directory fsync. Private permissions: these files hold health data. */
export async function writeFileAtomic(destination: string, bytes: Uint8Array | string): Promise<void> {
  const directory = path.dirname(destination);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = await fs.promises.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
  await fsyncDirectory(directory);
}
