export interface DiagnosticsSnapshot {
  report: string;
  entryCount: number;
  persistent: boolean;
}

export interface RendererDiagnosticError {
  kind: "error" | "unhandledrejection";
  name: string;
  message: string;
  stack?: string;
}
