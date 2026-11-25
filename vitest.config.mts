import path from "node:path";
import { defineConfig } from "vitest/config";

const shim = (name: string) => path.resolve(import.meta.dirname, "desktop/shims", name);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, "src") + "/" },
      { find: /^next\/server$/, replacement: shim("next-server.ts") },
      { find: /^next\/headers$/, replacement: shim("next-headers.ts") },
      { find: /^next\/navigation$/, replacement: shim("next-navigation.ts") },
      { find: /^next$/, replacement: shim("next.ts") },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "desktop/**/*.test.ts"], environment: "node",
    // Face conversion and map-area tests do real work; on a busy machine or a small CI runner they pass 5 s.
    testTimeout: 30_000, hookTimeout: 30_000,
  },
});
