import type { CorosLinkApi } from "./coroslink-api";

let report: ((kind: "error" | "unhandledrejection", value: unknown) => void) | null = null;

export function installRendererDiagnostics(api: CorosLinkApi | undefined): void {
  if (!api?.reportRendererError) return;
  report = (kind, value) => {
    // Use a small, explicit shape; never serialize arbitrary rejected objects.
    try {
      const error = value instanceof Error ? value : null;
      api.reportRendererError({
        kind,
        name: error?.name ?? "Error",
        message: (error?.message ?? (typeof value === "string" ? value : "Unknown renderer error")).slice(0, 32_000),
        stack: error?.stack?.slice(0, 32_000)
      });
    } catch { /* Reporting must not cause another unhandled error. */ }
  };
  window.addEventListener("error", (event) => report?.("error", event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => report?.("unhandledrejection", event.reason));
}

/** A render error an error boundary caught: React keeps it off window "error", so log it here. */
export function reportCaughtRenderError(error: unknown): void {
  report?.("error", error);
}
