/** CorosLink's own watch face compiler (`watchfaceCompiler/`), which runs on every platform. */
export interface CorosWatchfaceCompilerStatus {
  available: boolean;
  busy: boolean;
  phase: "idle" | "starting" | "compiling" | "validating" | "ready" | "failed";
  detail: string;
}
