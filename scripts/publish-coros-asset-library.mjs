#!/usr/bin/env node
// Publishes a built asset library (scripts/build-coros-asset-library.mjs) in
// the layout the app's official-asset service fetches, then uploads it to any
// S3-compatible bucket (Cloudflare R2, S3, MinIO…) with the repo's own SigV4
// signer — no SDK dependency.
//
//   node --experimental-strip-types --import ./scripts/register-ts-ext.mjs \
//     scripts/publish-coros-asset-library.mjs [library-dir] [--layout-only]
//
// Environment for the upload step — either a Vercel Blob store:
//   BLOB_READ_WRITE_TOKEN   read-write token of a PUBLIC Blob store
//   ASSET_BUCKET_PREFIX     object prefix, default "official-faces"
// or any S3-compatible bucket:
//   ASSET_BUCKET_ENDPOINT   https://<account>.r2.cloudflarestorage.com (or an S3 endpoint)
//   ASSET_BUCKET_NAME       bucket name
//   ASSET_BUCKET_REGION     "auto" for R2 (default), otherwise the S3 region
//   ASSET_BUCKET_ACCESS_KEY_ID / ASSET_BUCKET_SECRET_ACCESS_KEY
//   ASSET_BUCKET_PREFIX     object prefix, default "official-faces"
//
// Hosted layout (all under <prefix>/v1/):
//   manifest.json                 models → face/asset counts and index path
//   models/<slug>/library.json    per-watch index the app downloads (~1–3 MB)
//   assets/<hash>/strip.png       preview strip, fetched as the user browses
//   assets/<hash>/<hash>.zip      all frames, fetched only when a set is picked
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { sha256Hex, signRequest } from "../electron/awsSigV4.ts";
import { classifyOfficialAsset, officialFontRole } from "../electron/corosOfficialAssetLibrary.ts";
import { WATCHFACE_TARGETS } from "../electron/watchfaceTargets.ts";

const args = process.argv.slice(2);
const layoutOnly = args.includes("--layout-only");
const libraryDir = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? "output/coros-asset-library");
const hostedDir = path.resolve("output/coros-asset-hosted");
const slugOf = (firmwareType) => firmwareType.replace(/[^A-Za-z0-9]+/g, "-");

// ---- 1. Layout -------------------------------------------------------------
const index = JSON.parse(await fs.readFile(path.join(libraryDir, "index.json"), "utf8"));
const assetsById = new Map(index.assets.map((asset) => [asset.id, asset]));
await fs.rm(hostedDir, { recursive: true, force: true });
await fs.mkdir(path.join(hostedDir, "v1", "models"), { recursive: true });

const manifest = { version: 1, generatedAt: index.generatedAt, models: {} };
const referenced = new Set();
for (const target of WATCHFACE_TARGETS) {
  const faces = index.faces.filter((face) => face.firmwareType === target.firmwareType);
  if (faces.length === 0) continue;
  const perAsset = new Map(); // id → { names: Set, elementIds: Set, configKeys: Set }
  for (const face of faces) {
    for (const use of face.assets) {
      const entry = perAsset.get(use.asset) ?? { names: new Set(), elementIds: new Set(), configKeys: new Set() };
      entry.names.add(face.name);
      for (const id of use.elements) entry.elementIds.add(id);
      perAsset.set(use.asset, entry);
    }
  }
  const assets = [];
  for (const [id, entry] of perAsset) {
    const asset = assetsById.get(id);
    if (!asset) continue;
    referenced.add(id);
    // Config keys are recorded per asset (not per face) in index.json; they are
    // the same key names on every resolution so reuse them here.
    const elementIds = [...entry.elementIds].sort();
    const configKeys = asset.configKeys;
    const category = classifyOfficialAsset(elementIds, configKeys);
    assets.push({
      id, category, ...(category === "fonts" ? { role: officialFontRole(elementIds) } : {}),
      width: asset.width, height: asset.height, frames: asset.frames, encoding: asset.encoding,
      elementIds, configKeys, faces: [...entry.names].slice(0, 3), faceCount: entry.names.size, strip: asset.strip
    });
  }
  assets.sort((a, b) => a.category.localeCompare(b.category) || b.faceCount - a.faceCount || a.id.localeCompare(b.id));
  const library = { version: 1, firmwareType: target.firmwareType, builtAt: index.generatedAt, source: "hosted", faceCount: faces.length, failures: [], assets };
  const slug = slugOf(target.firmwareType);
  await fs.mkdir(path.join(hostedDir, "v1", "models", slug), { recursive: true });
  await fs.writeFile(path.join(hostedDir, "v1", "models", slug, "library.json"), JSON.stringify(library));
  manifest.models[target.firmwareType] = { slug, label: target.label, faces: faces.length, assets: assets.length, index: `v1/models/${slug}/library.json` };
  console.log(`${target.label}: ${faces.length} faces, ${assets.length} sets`);
}
await fs.writeFile(path.join(hostedDir, "v1", "manifest.json"), JSON.stringify(manifest, null, 2));

// Frames and strips are hard-linked so the hosted tree costs no extra disk.
const objects = [];
for (const id of referenced) {
  const source = path.join(libraryDir, "assets", id);
  const destination = path.join(hostedDir, "v1", "assets", id);
  await fs.mkdir(destination, { recursive: true });
  for (const file of ["strip.png", `${id}.zip`]) {
    await fs.link(path.join(source, file), path.join(destination, file)).catch(() => fs.copyFile(path.join(source, file), path.join(destination, file)));
    objects.push(`v1/assets/${id}/${file}`);
  }
}
for (const model of Object.values(manifest.models)) objects.push(model.index);
console.log(`Layout written to ${hostedDir}: ${referenced.size} sets, ${objects.length + 1} objects`);
if (layoutOnly) process.exit(0);

// ---- 2. Upload -------------------------------------------------------------
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const endpoint = process.env.ASSET_BUCKET_ENDPOINT?.replace(/\/+$/, "");
const bucket = process.env.ASSET_BUCKET_NAME;
const region = process.env.ASSET_BUCKET_REGION || "auto";
const accessKeyId = process.env.ASSET_BUCKET_ACCESS_KEY_ID;
const secretAccessKey = process.env.ASSET_BUCKET_SECRET_ACCESS_KEY;
const prefix = (process.env.ASSET_BUCKET_PREFIX || "official-faces").replace(/^\/+|\/+$/g, "");
if (!blobToken && (!endpoint || !bucket || !accessKeyId || !secretAccessKey)) {
  console.error("Set BLOB_READ_WRITE_TOKEN (Vercel Blob) or ASSET_BUCKET_ENDPOINT/NAME/ACCESS_KEY_ID/SECRET_ACCESS_KEY (S3), or pass --layout-only.");
  process.exit(1);
}

let publicBaseUrl = "";
const maxAgeOf = (key) => key.startsWith("v1/assets/") ? 31536000 : 3600;

// Vercel Blob REST API (what @vercel/blob wraps); HEAD is a metadata GET by URL.
async function vercelBlob(method, key, body, contentType) {
  const pathname = `${prefix}/${key}`;
  if (method === "HEAD") {
    if (!publicBaseUrl) return { status: 404 };
    const response = await fetch(`https://blob.vercel-storage.com/?url=${encodeURIComponent(`${publicBaseUrl}/${pathname}`)}`, {
      headers: { authorization: `Bearer ${blobToken}`, "x-api-version": "7" }
    });
    return { status: response.status };
  }
  const response = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
    method: "PUT", body,
    headers: {
      authorization: `Bearer ${blobToken}`, "x-api-version": "7", "x-content-type": contentType,
      "x-add-random-suffix": "0", "x-allow-overwrite": "1", "x-cache-control-max-age": String(maxAgeOf(key)),
    }
  });
  if (response.ok) {
    const { url } = await response.json();
    publicBaseUrl ||= url.slice(0, url.indexOf(`/${pathname}`));
  }
  return response;
}

// Vercel's CDN compresses JSON on the fly; plain buckets get pre-gzipped
// indexes (Content-Encoding: gzip) so a 4 MB index travels as ~500 KB.
async function s3(method, key, body, contentType, cacheControl) {
  if (blobToken) return vercelBlob(method, key, body, contentType);
  if (body && key.endsWith("library.json")) body = gzipSync(body, { level: 9 });
  const url = `${endpoint}/${bucket}/${prefix}/${key}`;
  const payloadHash = sha256Hex(body ?? "");
  const headers = {
    host: new URL(url).host,
    "x-amz-content-sha256": payloadHash,
    ...(body ? { "content-type": contentType, "cache-control": cacheControl } : {}),
    ...(body && key.endsWith("library.json") ? { "content-encoding": "gzip" } : {})
  };
  const { authorization, amzDate } = signRequest({ method, url, region, service: "s3", accessKeyId, secretAccessKey, signedHeaders: headers, payloadHash });
  const { host, ...sendHeaders } = headers;
  return fetch(url, { method, headers: { ...sendHeaders, authorization, "x-amz-date": amzDate }, body });
}

const contentTypeOf = (key) => key.endsWith(".png") ? "image/png" : key.endsWith(".zip") ? "application/zip" : "application/json";
// Content-hashed assets never change; indexes and the manifest are re-fetched hourly by the app.
const cacheControlOf = (key) => key.startsWith("v1/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
let uploaded = 0;
let skipped = 0;
let failed = 0;
let next = 0;
async function worker() {
  while (next < objects.length) {
    const key = objects[next++];
    try {
      if (key.startsWith("v1/assets/")) {
        const head = await s3("HEAD", key);
        if (head.status === 200) { skipped += 1; continue; }
      }
      const response = await s3("PUT", key, await fs.readFile(path.join(hostedDir, key)), contentTypeOf(key), cacheControlOf(key));
      if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
      uploaded += 1;
    } catch (error) {
      failed += 1;
      console.error(`\n${key}: ${error.message}`);
    }
    if ((uploaded + skipped + failed) % 200 === 0) process.stdout.write(`\r${uploaded} uploaded, ${skipped} unchanged, ${failed} failed of ${objects.length}`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
process.stdout.write(`\r${uploaded} uploaded, ${skipped} unchanged, ${failed} failed of ${objects.length}\n`);
if (failed) process.exit(1);
// The manifest goes last so a half-finished publish never advertises missing indexes.
const manifestResponse = await s3("PUT", "v1/manifest.json", await fs.readFile(path.join(hostedDir, "v1", "manifest.json")), "application/json", cacheControlOf("v1/manifest.json"));
if (!manifestResponse.ok) throw new Error(`manifest upload failed: HTTP ${manifestResponse.status}`);
console.log(`Published. Point the app at ${publicBaseUrl ? `${publicBaseUrl}/${prefix}` : `<public bucket URL>/${prefix}`} (COROSLINK_ASSET_LIBRARY_URL).`);
