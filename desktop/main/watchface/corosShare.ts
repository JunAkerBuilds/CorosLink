// Send to COROS: a final face archive saved to the signed-in COROS account, with the share link and QR code the
// COROS app opens. Rewritten from CorosLink's publishCorosWatchface and its helpers in corosWatchfaceService.ts
// (docs/studio-port.md, phase 6). The requests themselves, and the session token, stay in CorosAccount.
//
// - COROS answers 9021 "The file size exceeds limit" above 10,485,760 bytes (measured: that many saved, one more
//   refused). A face over 10 MB has its images recompressed toward 8 MB first, losslessly before anything else
//   (compiler/archiveFit.ts); if it's still over, it's refused with its size.
// - A face converted on a local carrier template (ID 0) has no COROS template to publish.
// - The link is accepted only on https://faq.coros.com.
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ARCHIVE_FIT_TARGET_BYTES, ARCHIVE_FIT_TRIGGER_BYTES, fitArchiveEntries, type ArchiveFitResult, type ArchiveFitStats } from "../../watchface/compiler/archiveFit";
import type { FitWorkerRequest, FitWorkerResponse } from "../../watchface/compiler/fitWorker";
import { readZip } from "../../watchface/zipRead";
import { createStoreZip } from "../../watchface/zipStore";
import { AccountProblem, type CorosAccount } from "./corosAccount";
import { extractDecimalProperty } from "./corosMobile";
import { qrCodeDataUrl } from "./phoneSend";
import { msg, t } from "@/lib/i18n";

export { buildCreateLinkBody } from "./corosAccount";

/** COROS's upload cap for a custom face, exactly. */
export const MAX_COROS_UPLOAD_BYTES = 10 * 1024 * 1024;
const SHARE_LINK_LIFETIME_MS = 48 * 60 * 60 * 1000;
const MAX_INFO_BYTES = 1024 * 1024;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export const LOCAL_TEMPLATE_PUBLISH_ERROR = msg(
  "This face was converted without a COROS account, so it has no COROS template to publish. Install it over Bluetooth, or sign in to COROS and convert it again to publish it.");

/** True for the template ID of a face converted on a local carrier: all zeros. */
export const isLocalTemplateId = (templateId: string) => /^0+$/.test(templateId);

export function isOfficialShareUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "faq.coros.com";
  } catch { return false; }
}

/** The COROS template a final archive was built on, from its info.json. `o_template_id` is read as raw text: it's beyond safe integers. */
export function archiveTemplate(archive: Buffer): { sourceTemplateId: string; watchFaceVersion: number } {
  let raw: string;
  try {
    const info = readZip(archive).find((entry) => !entry.directory && entry.path.replace(/^\.\//, "") === "info.json");
    if (!info) throw new AccountProblem(t("The archive must contain an info.json template manifest."), "badInput");
    if (info.size > MAX_INFO_BYTES) throw new AccountProblem(t("The template manifest is unexpectedly large."), "badInput");
    raw = info.read().toString("utf8");
  } catch (error) {
    throw error instanceof AccountProblem ? error : new AccountProblem(t("That file isn't a readable watch face archive."), "badInput");
  }
  let manifest: { o_template_id?: unknown; o_wf_ver?: unknown };
  try { manifest = JSON.parse(raw) as typeof manifest; } catch { throw new AccountProblem(t("info.json is not valid UTF-8 JSON."), "badInput"); }
  const sourceTemplateId = extractDecimalProperty(raw, "o_template_id") ?? (typeof manifest.o_template_id === "string" ? manifest.o_template_id.trim() : undefined);
  if (!sourceTemplateId || !/^\d{1,20}$/.test(sourceTemplateId)) throw new AccountProblem(t("info.json must include a valid o_template_id."), "badInput");
  const watchFaceVersion = Number(manifest.o_wf_ver ?? 0);
  if (!Number.isSafeInteger(watchFaceVersion) || watchFaceVersion < 0 || watchFaceVersion > 999) throw new AccountProblem(t("info.json must include a valid o_wf_ver when present."), "badInput");
  return { sourceTemplateId, watchFaceVersion };
}

/** Where the fit worker sits beside the main process once scripts/build-main.mjs builds compiler/fitWorker.ts there. */
export const FIT_WORKER = path.join(__dirname, "watchfaceFit.cjs");

/** `fitArchiveEntries` in a worker thread; in-process when the worker isn't built or can't start. */
function fitInWorker(entries: FitWorkerRequest["entries"], targetBytes: number, script: string): Promise<ArchiveFitResult> {
  if (!fs.existsSync(script)) return fitArchiveEntries(entries, targetBytes);
  let worker: Worker;
  try { worker = new Worker(script); } catch { return fitArchiveEntries(entries, targetBytes); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); action();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(t("Compressing the watch face took too long.")))), 180_000);
    worker.once("message", (response: FitWorkerResponse) => finish(() => ("error" in response ? reject(new Error(response.error)) : resolve(response))));
    worker.once("error", (error: NodeJS.ErrnoException) => finish(() => {
      if (error.code === "ERR_WORKER_OUT_OF_MEMORY") reject(new Error(t("The watch face is too large to compress.")));
      else fitArchiveEntries(entries, targetBytes).then(resolve, reject);
    }));
    worker.once("exit", () => finish(() => reject(new Error(t("Compressing the watch face stopped unexpectedly.")))));
    worker.postMessage({ entries, targetBytes } satisfies FitWorkerRequest);
  });
}

export interface ArchiveSizeFit extends ArchiveFitStats { originalBytes: number; bytes: number }

/**
 * A final face archive as it should leave the app (CorosLink's fitWatchfaceArchiveSize): over `triggerBytes` (10 MB)
 * its images are compressed toward `targetBytes` (8 MB), losslessly first and then only as far as needed; smaller
 * archives, and any the pass can't shrink, come back untouched.
 */
export async function fitWatchfaceArchiveSize(archive: Buffer, { triggerBytes = ARCHIVE_FIT_TRIGGER_BYTES, targetBytes = ARCHIVE_FIT_TARGET_BYTES, worker = FIT_WORKER } = {}):
  Promise<{ bytes: Buffer; fit?: ArchiveSizeFit }> {
  if (archive.length <= triggerBytes) return { bytes: archive };
  const entries = readZip(archive).filter((entry) => !entry.directory).map((entry) => ({ name: entry.path, data: entry.read() }));
  const { entries: fitted, stats } = await fitInWorker(entries, targetBytes, worker);
  const bytes = createStoreZip(fitted.map((entry) => ({ name: entry.name, data: Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength) })));
  if (bytes.length >= archive.length) return { bytes: archive };
  return { bytes, fit: { originalBytes: archive.length, bytes: bytes.length, ...stats } };
}

const megabytes = (size: number) => (size / (1024 * 1024)).toFixed(1);

/** Brings an archive under COROS's cap, or says by how much it's over. */
export async function fitCorosUploadLimit(archive: Buffer, options: { worker?: string } = {}): Promise<Buffer> {
  const { bytes } = await fitWatchfaceArchiveSize(archive, options);
  if (bytes.length > MAX_COROS_UPLOAD_BYTES) {
    throw new AccountProblem(t("This face is {mb} MB even after compression, and COROS accepts custom faces up to {max} MB. Remove some images or use smaller ones, then publish again.", { mb: megabytes(bytes.length), max: megabytes(MAX_COROS_UPLOAD_BYTES) }), "tooLarge", 413);
  }
  return bytes;
}

export interface CorosPublishInput {
  /** The final face archive (DAT/ZIP). */
  archive: Buffer;
  name: string;
  firmwareType: string;
  /** Decimal text, from the archive's info.json (archiveTemplate). */
  sourceTemplateId: string;
  watchFaceVersion: number;
  backgroundImageId: number;
  /** A locale such as en-US (the default). */
  language?: string;
}

export interface CorosShareLink {
  url: string;
  qrDataUrl: string;
  /** ISO time. */
  expiresAt: string;
  previewImageUrl?: string;
}

/** Saves the face to the signed-in COROS account and makes its share link and QR code. */
export async function publishToCoros(account: CorosAccount, input: CorosPublishInput, options: { worker?: string; now?: () => number } = {}): Promise<CorosShareLink> {
  const name = input.name.replace(new RegExp(CONTROL.source, "g"), "").trim();
  if (!name) throw new AccountProblem(t("Enter a name for the custom watch face."), "badInput");
  if (name.length > 64) throw new AccountProblem(t("Watch face names must be 64 characters or fewer."), "badInput");
  const firmwareType = input.firmwareType.trim();
  if (!firmwareType || firmwareType.length > 120 || CONTROL.test(firmwareType)) throw new AccountProblem(t("Enter the COROS firmware type for this face."), "badInput");
  if (!Number.isSafeInteger(input.backgroundImageId) || input.backgroundImageId < 0) throw new AccountProblem(t("Background image ID must be a non-negative integer."), "badInput");
  const language = (input.language || "en-US").trim();
  if (!/^[a-z]{2,3}-[A-Z]{2}$/.test(language)) throw new AccountProblem(t("Language must be a locale such as en-US."), "badInput");
  const sourceTemplateId = input.sourceTemplateId.trim();
  if (!/^\d{1,20}$/.test(sourceTemplateId)) throw new AccountProblem(t("Invalid COROS source template ID."), "badInput");
  if (isLocalTemplateId(sourceTemplateId)) throw new AccountProblem(t(LOCAL_TEMPLATE_PUBLISH_ERROR), "localTemplate");
  if (!Number.isSafeInteger(input.watchFaceVersion) || input.watchFaceVersion < 0 || input.watchFaceVersion > 999) throw new AccountProblem(t("Invalid watch face version."), "badInput");
  if (!(await account.signedIn())) throw new AccountProblem(t("Sign in to your COROS account first."), "signedOut", 401);

  const archive = await fitCorosUploadLimit(input.archive, options);
  const answer = await account.publishFace({ archive, name, firmwareType, language, sourceTemplateId, watchFaceVersion: input.watchFaceVersion, backgroundImageId: input.backgroundImageId });
  if (!answer.url || !isOfficialShareUrl(answer.url)) throw new AccountProblem(t("COROS didn't return an official share link."), "coros", 502);
  const expiresAt = new Date(answer.expireTimestamp ?? (options.now ?? Date.now)() + SHARE_LINK_LIFETIME_MS).toISOString();
  const preview = answer.previewImageUrl && /^https:\/\//i.test(answer.previewImageUrl) ? answer.previewImageUrl : undefined;
  return { url: answer.url, qrDataUrl: await qrCodeDataUrl(answer.url), expiresAt, ...(preview ? { previewImageUrl: preview } : {}) };
}
