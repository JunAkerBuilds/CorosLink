// Builds the main process and preload with esbuild. Before that, lists the web app's API routes for the main
// process (desktop/main/apiRoutes.gen.ts), so a new route in src/app/api is picked up without editing anything.
import { build, context } from "esbuild";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apiDir = path.join(root, "src/app/api");

function routeFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

export function writeRouteTable() {
  const files = routeFiles(apiDir).sort();
  const lines = files.map((file, i) => `import * as r${i} from "${path.relative(path.join(root, "desktop/main"), file).replace(/\.ts$/, "").split(path.sep).join("/")}";`);
  const rows = files.map((file, i) => `  { pattern: "/api/${path.relative(apiDir, path.dirname(file)).split(path.sep).join("/")}", module: r${i} },`);
  const text = `// Written by scripts/build-main.mjs from src/app/api. Don't edit.\n${lines.join("\n")}\n\nexport const API_ROUTES: { pattern: string; module: Record<string, unknown> }[] = [\n${rows.join("\n")}\n];\n`;
  writeFileSync(path.join(root, "desktop/main/apiRoutes.gen.ts"), text);
}

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
  tsconfig: path.join(root, "tsconfig.json"),
  logLevel: "warning",
  define: { "process.env.NEXT_RUNTIME": '"nodejs"' },
};

const entries = [
  { entryPoints: [path.join(root, "desktop/main/main.ts")], outfile: path.join(root, "dist/main/main.cjs") },
  { entryPoints: [path.join(root, "desktop/preload/preload.ts")], outfile: path.join(root, "dist/main/preload.cjs") },
  // The watch-face compiler runs in a worker thread of its own (desktop/main/watchface/compile.ts).
  { entryPoints: [path.join(root, "desktop/watchface/compiler/worker.ts")], outfile: path.join(root, "dist/main/watchfaceCompiler.cjs") },
  // Studio builds final watch archives in another (desktop/main/watchface/studio.ts).
  { entryPoints: [path.join(root, "desktop/watchface/archive/worker.ts")], outfile: path.join(root, "dist/main/watchfaceArchive.cjs") },
  // Shrinking a face for COROS's 10 MB upload cap (desktop/main/watchface/corosShare.ts).
  { entryPoints: [path.join(root, "desktop/watchface/compiler/fitWorker.ts")], outfile: path.join(root, "dist/main/watchfaceFit.cjs") },
];

writeRouteTable();
// `--routes` only writes the route table: typecheck runs it first, so a fresh checkout (CI) checks without a build.
if (process.argv.includes("--routes")) process.exit(0);
if (process.argv.includes("--watch")) {
  for (const entry of entries) await (await context({ ...shared, ...entry })).watch();
} else {
  await Promise.all(entries.map((entry) => build({ ...shared, ...entry })));
}
