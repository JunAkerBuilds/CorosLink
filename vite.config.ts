import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * pdf.js loads character maps, standard fonts and image decoders by URL at
 * runtime (Coach reads attached PDFs with it). Serve them under /pdfjs/ in dev
 * and copy them next to index.html in builds.
 */
function pdfjsAssets(): Plugin {
  const root = path.resolve("node_modules/pdfjs-dist");
  const folders = ["cmaps", "standard_fonts", "wasm"];
  // The wasm folder also carries a JavaScript sandbox pdf.js uses for PDF
  // scripts; Coach never runs those.
  const include = (file: string) => !file.startsWith("quickjs") && !file.startsWith("LICENSE");
  return {
    name: "coroslink-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (request, response, next) => {
        const [folder, file, ...rest] = (request.url ?? "").split("?")[0].split("/").filter(Boolean);
        const target = folder && file && !rest.length && folders.includes(folder) && include(file)
          ? path.join(root, folder, path.basename(file))
          : "";
        if (!target || !existsSync(target) || !statSync(target).isFile()) return next();
        if (target.endsWith(".wasm")) response.setHeader("Content-Type", "application/wasm");
        createReadStream(target).pipe(response);
      });
    },
    generateBundle() {
      for (const folder of folders) {
        for (const file of readdirSync(path.join(root, folder)).filter(include)) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${folder}/${file}`,
            source: readFileSync(path.join(root, folder, file))
          });
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Electron preparation and TypeScript builds write hundreds of generated
    // files while the renderer is running. Watching those outputs can trigger
    // a reload during dependency optimization, leaving the browser with stale
    // hashed React URLs and Vite's "Outdated Optimize Dep" 504 response.
    watch: {
      ignored: ["**/bin/**", "**/dist/**", "**/dist-electron/**"]
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "three-vendor",
              test: /node_modules[\\/]three[\\/]/,
              priority: 20,
              maxSize: 450 * 1024,
            },
            {
              name: "map-vendor",
              test: /node_modules[\\/]leaflet[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
