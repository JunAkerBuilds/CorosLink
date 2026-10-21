/** Shared between the main process and the renderer (type-only imports). */

export type DataMode = "connected" | "local_only";

export type NetworkAttemptChannel = "fetch" | "http" | "electron";

/** A blocked upload to COROS. Only "METHOD host/path" is kept; never queries, headers or bodies. */
export interface NetworkAttempt {
  at: number;
  channel: NetworkAttemptChannel;
  destination: string;
  initiator?: string;
}

export interface PersistedDataMode {
  version: 1;
  mode: DataMode;
  changedAt: string;
  /** Set when the file was unreadable and Local-Only Mode was assumed (fail closed). */
  recovered?: boolean;
}

export type DataModePhase =
  /** Connected Mode: existing behaviour. */
  | "connected"
  /** Uploads to COROS are already blocked; the mode is being saved. */
  | "activating"
  /** Local-Only Mode is saved and enforced. */
  | "active"
  /** Enforced, but saving the mode or removing saved credentials failed (failedServices). */
  | "degraded"
  /** Connected Mode is saved; CorosLink restarts to lift the process-wide guards. */
  | "restart-required";

export interface DataModeServiceFailure {
  id: string;
  label: string;
  error: string;
}

export interface DataModeStatus {
  mode: DataMode;
  phase: DataModePhase;
  /** Whether the process-wide network guards currently refuse uploads to COROS. */
  enforcing: boolean;
  changedAt?: string;
  recovered?: boolean;
  failedServices: DataModeServiceFailure[];
  blockedAttempts: number;
}

export interface LocalOnlyActivationOptions {
  /** Keep the saved watch key so the watch can still authenticate offline (default true). */
  retainWatchKey?: boolean;
  /** Remove saved COROS cloud tokens and credentials from this computer (default false). */
  forgetCloudSession?: boolean;
}

export interface NetworkAccessReport {
  generatedAt: number;
  status: DataModeStatus;
  attempts: NetworkAttempt[];
}

/** Error messages for features that would send data to COROS start with this prefix. */
export const LOCAL_ONLY_ERROR_PREFIX = "Local-Only Mode:";
