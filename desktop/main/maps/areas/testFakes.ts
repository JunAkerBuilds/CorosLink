// Test stand-ins for COROS's map service (no network). Not part of the app.
import { signRequest } from "./client";

export const SIGNING = { id: "1234567890123", key: "0123456789abcdef0123456789abcdef" };

/** COROS's map service as the client sees it: the web page, its scripts (signing config as text), the package API and the files. */
export function fakeCoros(opts: { sizes?: { S: number; C: number }; onFile?: (url: string) => void } = {}) {
  const sizes = opts.sizes ?? { S: 1000, C: 500 };
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (url === "https://mapstatic.coros.com/") return new Response('<script>window.__assetsPath("public/main-AbC1.js")</script>', { status: 404 });
    if (url.endsWith("public/main-AbC1.js")) return new Response('import("public/index-x1.js");import("public/index-y2.js")');
    if (url.endsWith("public/index-x1.js")) return new Response("var a=1;");
    // A script that would do harm if it were run: it's only ever read as text.
    if (url.endsWith("public/index-y2.js")) return new Response(`globalThis.__ran=true;const c={prod:{app_id:"${SIGNING.id}",app_secret:"${SIGNING.key}"}}`);
    if (url.endsWith("/openapi/tileMap/getMapPackage")) {
      if (!body || body.sign !== signRequest(body, SIGNING.key)) return Response.json({ code: 401 });
      const keys = (body.list as { quadkey: string }[]).map((l) => l.quadkey);
      const files = keys.flatMap((k) => [{ name: `S${k}V01.t`, size: sizes.S }, { name: `C${k}V01.t`, size: sizes.C }]);
      return Response.json({ code: 200, data: { fileCount: files.length, fileSize: files.reduce((s, f) => s + f.size, 0), files, ...(body.action === "download" ? { map_id: "Ab3_-xyz" } : {}) } });
    }
    const file = /\/osm\/tiles_V01\/(VSM|VCM)\/([SC])\d{7}V01\.t$/.exec(url);
    if (file) { opts.onFile?.(url); return new Response(new Uint8Array(file[2] === "S" ? sizes.S : sizes.C).fill(7)); }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}
