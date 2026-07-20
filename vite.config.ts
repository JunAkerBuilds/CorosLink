import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
