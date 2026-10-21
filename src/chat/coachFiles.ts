// Turns a file the athlete attaches in Coach into what the model reads: a
// document's text (PDF, Word, plain text), or a downscaled image. PDFs whose
// pages carry no text, such as scans, also get their first pages as images.
// The main process stores the result with the conversation (coachAttachments.ts).
import type { CoachFileUpload, CoachFileUploadImage } from "../../electron/types";
import { t } from "../i18n/toolsLocale";

export const MAX_COACH_FILES = 6;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Matches MAX_COACH_DOCUMENT_CHARS in the main process. */
const MAX_DOCUMENT_CHARS = 120_000;
/** Claude's and OpenAI's vision models both read about this much detail. */
const IMAGE_LONG_EDGE = 1568;
const PAGE_LONG_EDGE = 1400;
const MAX_PAGE_IMAGES = 8;
/** PNGs above this are re-encoded as JPEG. */
const MAX_PNG_BYTES = 3.5 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 40 * 1024 * 1024;

const DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "md", "markdown", "csv", "tsv", "json"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];

/** For the file picker. */
export const COACH_FILE_ACCEPT = [...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS]
  .map((extension) => `.${extension}`)
  .join(",");

export class CoachFileError extends Error {}

type FileFormat = "pdf" | "docx" | "text" | "image";

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

function formatOf(file: File): FileFormat | null {
  const extension = extensionOf(file.name);
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (DOCUMENT_EXTENSIONS.includes(extension)) return "text";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  return null;
}

/** Pasted screenshots arrive as "image.png"; give them a name worth keeping. */
function fileName(file: File, format: FileFormat): string {
  const name = file.name.trim();
  if (format === "image" && /^image\.\w+$/i.test(name)) {
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, ".");
    return `Screenshot ${stamp}.${extensionOf(name) || "png"}`;
  }
  return name;
}

export function isImageFile(file: File): boolean {
  return formatOf(file) === "image";
}

export async function prepareCoachFile(file: File): Promise<CoachFileUpload> {
  const format = formatOf(file);
  if (!format) {
    if (/\.(docm?|pages|rtf|odt|xlsx?|numbers|pptx?|key)$/i.test(file.name)) {
      throw new CoachFileError(
        t("Coach can't read {{name}}. Export it as a PDF or Word (.docx) file and attach that.", { name: file.name })
      );
    }
    throw new CoachFileError(
      t("Coach can't read {{name}}. Attach a PDF, Word document, text file, or image.", { name: file.name })
    );
  }
  if (file.size === 0) throw new CoachFileError(t("{{name}} is empty.", { name: file.name }));
  if (file.size > MAX_FILE_BYTES) {
    throw new CoachFileError(t("{{name}} is larger than 32 MB.", { name: file.name }));
  }
  const name = fileName(file, format);
  const original = new Uint8Array(await file.arrayBuffer());
  const base = { name, mimeType: file.type || mimeFromExtension(name), original };

  if (format === "image") {
    const image = await readImage(file, name);
    return { ...base, kind: "image", images: [image] };
  }
  if (format === "pdf") {
    const pdf = await readPdf(original, name);
    return { ...base, kind: "document", ...pdf };
  }
  const text = format === "docx" ? await readDocx(original, name) : readText(original, name);
  if (!text.trim()) throw new CoachFileError(t("{{name}} has no text Coach can read.", { name }));
  return { ...base, kind: "document", ...clip(text) };
}

function mimeFromExtension(name: string): string {
  const extension = extensionOf(name);
  return (
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      csv: "text/csv",
      tsv: "text/tab-separated-values",
      json: "application/json",
      md: "text/markdown",
      markdown: "text/markdown",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      bmp: "image/bmp",
      avif: "image/avif"
    }[extension] ?? "text/plain"
  );
}

function clip(text: string): { text: string; truncated?: boolean } {
  const trimmed = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return trimmed.length > MAX_DOCUMENT_CHARS
    ? { text: trimmed.slice(0, MAX_DOCUMENT_CHARS), truncated: true }
    : { text: trimmed };
}

// ----- Images -----

async function canvasBytes(canvas: HTMLCanvasElement, mimeType: CoachFileUploadImage["mimeType"]): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.86));
  if (!blob) throw new Error("Canvas encoding failed.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function readImage(file: File, name: string): Promise<CoachFileUploadImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new CoachFileError(t("{{name}} could not be read as an image.", { name }));
  }
  try {
    const scale = Math.min(1, IMAGE_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new CoachFileError(t("{{name}} could not be read as an image.", { name }));
    // Screenshots stay PNG so small text stays sharp; photos travel as JPEG.
    if (file.type === "image/png") {
      context.drawImage(bitmap, 0, 0, width, height);
      const png = await canvasBytes(canvas, "image/png");
      if (png.byteLength <= MAX_PNG_BYTES) return { mimeType: "image/png", data: png, width, height };
    }
    // JPEG has no alpha: transparent pixels become white rather than black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return { mimeType: "image/jpeg", data: await canvasBytes(canvas, "image/jpeg"), width, height };
  } finally {
    bitmap.close();
  }
}

// ----- PDF -----

type PdfJs = typeof import("pdfjs-dist");
let pdfjsLoading: Promise<PdfJs> | null = null;

/** pdf.js is large; load it the first time a PDF is attached. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoading ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  pdfjsLoading.catch(() => {
    pdfjsLoading = null;
  });
  return pdfjsLoading;
}

/** Fonts, character maps and image decoders vite.config.ts copies from pdfjs-dist. */
function pdfAssetUrl(folder: string): string {
  return new URL(`pdfjs/${folder}/`, document.baseURI).href;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/**
 * One page's text in reading order. pdf.js returns positioned fragments; lines
 * are rebuilt from their baselines, and wide gaps (table columns) become " | "
 * so a schedule's rows stay readable. Spaces come from the gaps themselves:
 * pdf.js pads gaps with space items as wide as the gap, which would hide a
 * column break.
 */
export function pdfPageText(items: PdfTextItem[]): string {
  const fragments = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      size: Math.max(1, Math.abs(item.height) || Math.hypot(item.transform[2], item.transform[3]) || 10)
    }));
  if (fragments.length === 0) return "";
  // Higher baselines first (PDF y grows upward), then left to right.
  fragments.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: (typeof fragments)[] = [];
  for (const fragment of fragments) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - fragment.y) <= Math.min(line[0].size, fragment.size) * 0.5) {
      line.push(fragment);
    } else {
      lines.push([fragment]);
    }
  }
  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      let text = "";
      let end = Number.NEGATIVE_INFINITY;
      for (const fragment of line) {
        const gap = fragment.x - end;
        if (text) {
          if (gap > fragment.size * 1.2) text += " | ";
          else if (gap > fragment.size * 0.15 && !text.endsWith(" ") && !fragment.text.startsWith(" ")) text += " ";
        }
        text += fragment.text;
        end = Math.max(end, fragment.x + fragment.width);
      }
      return text.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n");
}

async function readPdf(
  bytes: Uint8Array,
  name: string
): Promise<Pick<CoachFileUpload, "text" | "pageCount" | "truncated" | "images">> {
  let pdfjs: PdfJs;
  try {
    pdfjs = await loadPdfJs();
  } catch {
    throw new CoachFileError(t("The PDF reader could not start. Try again."));
  }
  const task = pdfjs.getDocument({
    // pdf.js hands its buffer to the worker; keep the original for upload.
    data: bytes.slice(),
    cMapUrl: pdfAssetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrl("standard_fonts"),
    wasmUrl: pdfAssetUrl("wasm"),
    enableXfa: false
  });
  try {
    let document_;
    try {
      document_ = await task.promise;
    } catch (error) {
      if ((error as { name?: string })?.name === "PasswordException") {
        throw new CoachFileError(t("{{name}} is password-protected. Remove the password and attach it again.", { name }));
      }
      throw new CoachFileError(t("{{name}} could not be read as a PDF.", { name }));
    }
    const pageCount = document_.numPages;
    const pages: string[] = [];
    let length = 0;
    let truncated = false;
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await document_.getPage(number);
      const content = await page.getTextContent();
      const text = pdfPageText(
        content.items.flatMap((item): PdfTextItem[] => ("str" in item ? [item] : []))
      );
      page.cleanup();
      pages.push(pageCount > 1 ? `--- Page ${number} ---\n${text}` : text);
      length += text.length;
      if (length > MAX_DOCUMENT_CHARS) {
        truncated = number < pageCount;
        break;
      }
    }
    const { text, truncated: clipped } = clip(pages.join("\n\n"));
    const readable = pages.join("").replace(/--- Page \d+ ---|\s/g, "").length;
    // Scans and image-only exports: let the model look at the pages instead.
    const images = readable < 60 * Math.min(pageCount, MAX_PAGE_IMAGES)
      ? await renderPdfPages(document_, Math.min(pageCount, MAX_PAGE_IMAGES))
      : [];
    if (!readable && images.length === 0) {
      throw new CoachFileError(t("{{name}} has no text Coach can read.", { name }));
    }
    return {
      ...(readable ? { text } : {}),
      pageCount,
      ...(truncated || clipped ? { truncated: true } : {}),
      ...(images.length ? { images } : {})
    };
  } finally {
    void task.destroy();
  }
}

type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

async function renderPdfPages(document_: PdfDocument, count: number): Promise<CoachFileUploadImage[]> {
  const images: CoachFileUploadImage[] = [];
  for (let number = 1; number <= count; number += 1) {
    const page = await document_.getPage(number);
    try {
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(3, PAGE_LONG_EDGE / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      images.push({
        mimeType: "image/jpeg",
        data: await canvasBytes(canvas, "image/jpeg"),
        width: canvas.width,
        height: canvas.height
      });
    } catch (error) {
      console.warn("[coach] could not render a PDF page:", error);
      break;
    } finally {
      page.cleanup();
    }
  }
  return images;
}

// ----- Word and text -----

function readText(bytes: Uint8Array, name: string): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  // A NUL byte means this is not text, whatever its extension says.
  if (text.includes("\u0000")) throw new CoachFileError(t("{{name}} has no text Coach can read.", { name }));
  return text;
}

async function readDocx(bytes: Uint8Array, name: string): Promise<string> {
  let xml: Uint8Array | null;
  try {
    xml = await readZipEntry(bytes, "word/document.xml");
  } catch {
    xml = null;
  }
  if (!xml) throw new CoachFileError(t("{{name}} could not be read as a Word document.", { name }));
  const parsed = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(xml), "application/xml");
  const body = parsed.getElementsByTagNameNS("*", "body")[0];
  if (!body || parsed.getElementsByTagName("parsererror").length) {
    throw new CoachFileError(t("{{name}} could not be read as a Word document.", { name }));
  }
  return docxBlocks(body).join("\n");
}

/** Paragraphs as lines and table rows as "cell | cell", in document order. */
function docxBlocks(parent: Element): string[] {
  const lines: string[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.localName === "p") {
      lines.push(docxParagraph(child));
    } else if (child.localName === "tbl") {
      for (const row of Array.from(child.children).filter((node) => node.localName === "tr")) {
        const cells = Array.from(row.children)
          .filter((node) => node.localName === "tc")
          .map((cell) => docxBlocks(cell).filter(Boolean).join(" "));
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
      lines.push("");
    } else if (child.children.length) {
      // Content controls (sdt) and other wrappers.
      lines.push(...docxBlocks(child));
    }
  }
  return lines;
}

function docxParagraph(paragraph: Element): string {
  let text = "";
  for (const node of Array.from(paragraph.getElementsByTagNameNS("*", "*"))) {
    if (node.localName === "t") text += node.textContent ?? "";
    else if (node.localName === "tab") text += "\t";
    else if (node.localName === "br" || node.localName === "cr") text += "\n";
  }
  return text;
}

/** Reads one entry of a ZIP archive (a .docx), refusing anything that inflates past a sane size. */
async function readZipEntry(zip: Uint8Array, entryName: string): Promise<Uint8Array | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let offset = zip.byteLength - 22; offset >= Math.max(0, zip.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < entries && offset + 46 <= zip.byteLength; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== entryName) continue;
    if (size > MAX_DOCX_XML_BYTES || view.getUint32(localOffset, true) !== 0x04034b50) return null;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return data;
    if (method !== 8) return null;
    return inflateRaw(data, MAX_DOCX_XML_BYTES);
  }
  return null;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      void reader.cancel();
      throw new Error("ZIP entry too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.byteLength;
  }
  return out;
}
