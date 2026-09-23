import { fileURLToPath } from "node:url";
import { createServer } from "vite";

/** Load renderer modules with the same asset-glob/TypeScript transform as the app. */
export async function loadWatchfaceTestModules(paths) {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "error"
  });
  try {
    return await Promise.all(paths.map((path) => vite.ssrLoadModule(path)));
  } finally {
    await vite.close();
  }
}
