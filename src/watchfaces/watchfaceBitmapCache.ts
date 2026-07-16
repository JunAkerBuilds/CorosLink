interface BitmapEntry {
  promise: Promise<ImageBitmap>;
  bitmap?: ImageBitmap;
}

/** Bounded GPU-backed decode cache shared by Studio background compositions. */
export class WatchfaceBitmapCache {
  private readonly entries = new Map<string, BitmapEntry>();

  constructor(private readonly capacity = 48) {}

  async decode(key: string, dataUrl: string): Promise<ImageBitmap | null> {
    if (typeof createImageBitmap !== "function") return null;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }
    const entry: BitmapEntry = {
      promise: fetch(dataUrl)
        .then((response) => response.blob())
        .then((blob) => createImageBitmap(blob, {
          premultiplyAlpha: "premultiply",
          colorSpaceConversion: "default"
        }))
    };
    this.entries.set(key, entry);
    try {
      const bitmap = await entry.promise;
      entry.bitmap = bitmap;
      this.evict();
      return bitmap;
    } catch {
      this.entries.delete(key);
      return null;
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.bitmap?.close();
    this.entries.clear();
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.entries().next().value as
        | [string, BitmapEntry]
        | undefined;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      oldest[1].bitmap?.close();
    }
  }
}

export const watchfaceBitmapCache = new WatchfaceBitmapCache();
