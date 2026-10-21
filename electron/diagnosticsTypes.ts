export interface DiagnosticsSnapshot {
  report: string;
  /** Errors in the report's time range. */
  entryCount: number;
  /** Every error the log keeps, whatever the range. */
  totalCount: number;
  persistent: boolean;
}

export interface RendererDiagnosticError {
  kind: "error" | "unhandledrejection";
  name: string;
  message: string;
  stack?: string;
}
