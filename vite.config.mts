import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const shim = (name: string) => path.resolve(import.meta.dirname, "desktop/shims", name);

// The screens: the web app's src, with the desktop's stand-ins for Next.js, compiled by the React Compiler.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "desktop/renderer"),
  publicDir: path.resolve(import.meta.dirname, "public"),
  base: "/",
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, "src") + "/" },
      { find: /^next\/link$/, replacement: shim("next-link.tsx") },
      { find: /^next\/navigation$/, replacement: shim("next-navigation.ts") },
      { find: /^next\/image$/, replacement: shim("next-image.tsx") },
      { find: /^next\/dynamic$/, replacement: shim("next-dynamic.tsx") },
      { find: /^next$/, replacement: shim("next.ts") },
    ],
  },
  server: { port: 5174, strictPort: true, hmr: { protocol: "ws", host: "localhost", port: 5174 }, fs: { allow: [import.meta.dirname] } },
  build: { outDir: path.resolve(import.meta.dirname, "dist/renderer"), emptyOutDir: true, target: "chrome140", sourcemap: true },
});
