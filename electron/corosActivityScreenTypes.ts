export interface CorosActivityScreenSport { id: number; name: string }
export interface CorosActivityScreenDevice { key: string; name: string; model: "pace-pro"; firmware: string }
export interface CorosActivityScreenField { metricId: number; height: number }
export interface CorosActivityScreenPage {
  index: number;
  rawHex: string;
  kind: "grid" | "special" | "unknown";
  rows: number;
  columns: number[];
  fields: CorosActivityScreenField[];
  baseMetricId: number;
  fieldCount: number | null;
}
export interface CorosActivityScreenDocument {
  id: string;
  device: CorosActivityScreenDevice;
  sport: CorosActivityScreenSport;
  readAt: number;
  digest: string;
  recordBytes: 44;
  pages: CorosActivityScreenPage[];
  baseline: "unverified" | "read-back-verified" | "watch-confirmed";
}
export interface CorosActivityScreenBackup {
  id: string;
  createdAt: number;
  device: CorosActivityScreenDevice;
  sport: CorosActivityScreenSport;
  pageCount: number;
  digest: string;
  reason: "manual" | "before-sync" | "before-restore";
}
export interface CorosActivityScreenPreview {
  id: string;
  sourceId: string;
  pageIndex: number;
  fieldCount: number;
  experimental: boolean;
  page: CorosActivityScreenPage;
}
export interface CorosActivityScreenResult {
  document: CorosActivityScreenDocument;
  backup: CorosActivityScreenBackup;
  verified: true;
}
export interface CorosActivityScreenStatus {
  enabled: boolean;
  pendingRestore: CorosActivityScreenBackup | null;
  /** Codec capabilities, not verified watch rendering; optional for compatibility with an older development main process. */
  supportedFieldCounts?: number[];
}
