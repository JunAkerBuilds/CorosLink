let webglConfirmed = false;

/**
 * Whether this window can create a WebGL context. Electron 44+ on macOS draws
 * only through Metal; on GPUs where Metal fails to start (older iMacs that
 * Electron 42 ran on OpenGL) there is no GPU process and every WebGL context
 * fails, so 3D views must check before three.js throws.
 *
 * Only success is cached: a failure while the GPU process restarts is retried
 * the next time a 3D view mounts.
 */
export function isWebGLAvailable(): boolean {
  if (webglConfirmed) return true;
  try {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    webglConfirmed = Boolean(context);
    // Free the probe's context now rather than counting against Chromium's limit until GC.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    return false;
  }
  return webglConfirmed;
}
