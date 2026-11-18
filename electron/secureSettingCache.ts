import { safeStorage } from "electron";
import { getSetting, setSetting } from "./database";

/**
 * A JSON value kept encrypted with safeStorage in one setting, for code that
 * reads and writes it synchronously (the calendar clients). Electron's
 * safeStorage only encrypts asynchronously now, so the value is decrypted once
 * by load() at startup and served from memory; write() updates memory at once
 * and saves the newest value in the background, in order.
 */
export class SecureSettingCache<T> {
  private loaded = false;
  private available = false;
  private value: T | undefined;
  private loadError: Error | undefined;
  private saving: Promise<void> = Promise.resolve();
  private revision = 0;

  constructor(
    private readonly key: string,
    private readonly options: {
      /** Thrown by read() when the saved value can't be decrypted. */
      unreadableMessage: string;
      onSaveError: (error: unknown) => void;
    }
  ) {}

  /** Decrypts the saved value. Safe to call again; it only runs once. */
  async load(): Promise<void> {
    if (this.loaded) return;
    const revision = this.revision;
    const available = await safeStorage.isAsyncEncryptionAvailable();
    const stored = getSetting(this.key);
    let value: T | undefined;
    let loadError: Error | undefined;
    let shouldReEncrypt = false;
    if (stored && available) {
      try {
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(stored, "base64"));
        value = JSON.parse(decrypted.result) as T;
        shouldReEncrypt = decrypted.shouldReEncrypt;
      } catch {
        loadError = new Error(this.options.unreadableMessage);
      }
    } else if (stored) {
      loadError = new Error(this.options.unreadableMessage);
    }
    if (this.loaded) return;
    this.loaded = true;
    this.available = available;
    // A write while this decrypted is newer than what was read.
    if (revision !== this.revision) return;
    this.value = value;
    this.loadError = loadError;
    if (value !== undefined && shouldReEncrypt) this.write(value);
  }

  /** Whether OS secure storage was available when load() ran. */
  secureStorageAvailable(): boolean {
    return this.available;
  }

  /** The saved value; undefined when nothing is saved. Throws if it couldn't be decrypted. */
  read(): T | undefined {
    if (this.loadError) throw this.loadError;
    if (!this.loaded && getSetting(this.key)) {
      throw new Error("Saved credentials are still being unlocked. Try again in a moment.");
    }
    return this.value;
  }

  write(value: T): void {
    const revision = ++this.revision;
    this.value = value;
    this.loadError = undefined;
    const save = this.saving.then(async () => {
      // A newer write saves its own value; this one is already out of date.
      if (revision !== this.revision) return;
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
      if (revision !== this.revision) return;
      setSetting(this.key, encrypted.toString("base64"));
    });
    this.saving = save.catch((error) => this.options.onSaveError(error));
  }

  /** Resolves once every write so far is saved (or has failed and been reported). */
  flush(): Promise<void> {
    return this.saving;
  }
}
