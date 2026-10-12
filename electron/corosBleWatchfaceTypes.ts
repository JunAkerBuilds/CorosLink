export interface CorosDirectWatchfacePreview {
  id: string;
  name: string;
  bytes: number;
  faceId: number;
  /** The watches this BIN fits (same-screen watches share one), from its screen header. */
  models?: Array<import("./watchModels").WatchModelId>;
  source?: "compiled";
  /** How a CorosLink compile produced this BIN. */
  compile?: {
    durationMs: number;
    /** Problems the watch would show too, such as images the compiler could not load. */
    warnings?: string[];
  };
}

export interface CorosDirectWatchfaceInventory {
  id: string;
  checkedAt: number;
  slots: Array<{ slot: number; faceId: number | null }>;
  prepared?: CorosDirectWatchfacePreview;
}

export interface CorosDirectWatchfaceTarget {
  inventoryId: string;
  slot: number;
  replaceExisting: boolean;
}

export interface CorosDirectWatchfaceStatus {
  phase: "idle" | "preparing" | "transferring" | "verifying" | "complete" | "failed" | "cancelled";
  name?: string;
  sentBytes: number;
  totalBytes: number;
  watchSlot?: number;
  verification?: "inventory-id" | "transfer-acknowledged";
  error?: string;
}
