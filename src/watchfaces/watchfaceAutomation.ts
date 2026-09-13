import type {
  CorosWatchfaceArchive,
  CorosWatchfaceDesignState,
  CorosWatchfaceProject,
  WatchModelId
} from "../../electron/types";

export interface WatchfaceAutomationRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface WatchfaceAutomationErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class WatchfaceAutomationError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "WatchfaceAutomationError";
    this.code = code;
    this.details = details;
  }
}

export interface WatchfaceAutomationEditorStatus {
  sessionId: string;
  revision: number;
  dirty: boolean;
  busy: boolean;
}

export interface WatchfaceAutomationEditorController {
  status(): WatchfaceAutomationEditorStatus;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface WatchfaceAutomationOpenParams {
  project?: CorosWatchfaceProject;
  archive?: CorosWatchfaceArchive;
  name?: string;
  firmwareType?: string;
  watchModel?: WatchModelId;
  discardChanges?: boolean;
  saveChanges?: boolean;
}

export interface WatchfaceAutomationConversionInput {
  design: CorosWatchfaceDesignState;
  name: string;
  sourceDirty: boolean;
  targetArchive: CorosWatchfaceArchive;
  firmwareType?: string;
  watchModel?: WatchModelId;
}

let editorController: WatchfaceAutomationEditorController | null = null;

export function registerWatchfaceAutomationEditor(
  controller: WatchfaceAutomationEditorController
): () => void {
  editorController = controller;
  return () => {
    if (editorController === controller) editorController = null;
  };
}

export function getWatchfaceAutomationEditor():
  | WatchfaceAutomationEditorController
  | null {
  return editorController;
}

/** Prevent a queued request from reaching an editor that is being replaced. */
export function clearWatchfaceAutomationEditor(): void {
  editorController = null;
}

export function toWatchfaceAutomationError(
  caught: unknown
): WatchfaceAutomationErrorPayload {
  if (caught instanceof WatchfaceAutomationError) {
    return {
      code: caught.code,
      message: caught.message,
      ...(caught.details === undefined ? {} : { details: caught.details })
    };
  }
  if (
    caught instanceof Error &&
    "diagnostics" in caught &&
    Array.isArray((caught as { diagnostics?: unknown }).diagnostics)
  ) {
    return {
      code: "INVALID_COMMANDS",
      message: caught.message,
      details: (caught as { diagnostics: unknown }).diagnostics
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: caught instanceof Error ? caught.message : "Watch-face automation failed."
  };
}

export function requireAutomationString(
  value: unknown,
  field: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WatchfaceAutomationError(
      "INVALID_PARAMS",
      `${field} must be a non-empty string.`
    );
  }
  return value;
}

export function requireAutomationNumber(
  value: unknown,
  field: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WatchfaceAutomationError(
      "INVALID_PARAMS",
      `${field} must be a finite number.`
    );
  }
  return value;
}
