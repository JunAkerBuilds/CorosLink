// Files sent with a question: photos, PDFs and text files. Pure. The browser reads them, the route checks them
// here, and each model gets them in its own shape. They go to the model with this one question only: nothing is
// stored, the conversation keeps just their names.

export type CoachFileKind = "image" | "pdf" | "text";

export interface CoachFile {
  name: string;
  mime: string;
  kind: CoachFileKind;
  /** Base64 for images and PDFs, the text itself for text files. */
  data: string;
}

/** A part of the athlete's message as the loop hands it to a model. */
export type UserPart = { type: "text"; text: string } | { type: "file"; file: CoachFile };

export const MAX_FILES = 4;
/** Per file, in bytes before encoding. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
/** All files of one question together, in bytes. */
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const TEXT_EXT = /\.(txt|md|csv|tsv|json|gpx|tcx|xml|log)$/i;

/** What a picked file is, from its type or name; null when Coach can't read it. */
export function fileKind(name: string, mime: string): CoachFileKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(mime)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(name)) return "text";
  return null;
}

/** The list the file picker offers. */
export const ACCEPT = [...IMAGE_TYPES, "application/pdf", ".pdf", "text/plain", ".txt", ".md", ".csv", ".tsv", ".json", ".gpx", ".tcx"].join(",");

const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
const cleanName = (name: unknown) => String(name ?? "").replace(/[\u0000-\u001f\u007f/\\]+/g, " ").trim().slice(0, 120) || "file";

/** Size of a file as sent, in bytes. */
export const fileBytes = (f: CoachFile): number => (f.kind === "text" ? new TextEncoder().encode(f.data).length : base64Bytes(f.data));

/** Why a file can't go (a sentence for the athlete), or null when it can. */
export function fileProblem(f: Pick<CoachFile, "name" | "kind">, bytes: number): string | null {
  if (f.kind === "image" && bytes > MAX_IMAGE_BYTES) return `${f.name} is over 5 MB. Send a smaller photo.`;
  if (f.kind === "pdf" && bytes > MAX_PDF_BYTES) return `${f.name} is over 10 MB.`;
  if (f.kind === "text" && bytes > MAX_TEXT_CHARS * 4) return `${f.name} is too long to read.`;
  return null;
}

/** The files of a request, checked. Anything malformed, unknown or too big is dropped; at most four are kept. */
export function parseFiles(raw: unknown): CoachFile[] {
  if (!Array.isArray(raw)) return [];
  const out: CoachFile[] = [];
  let total = 0;
  for (const item of raw.slice(0, MAX_FILES)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.data !== "string" || typeof r.mime !== "string") continue;
    const name = cleanName(r.name), mime = r.mime.slice(0, 80).toLowerCase();
    const kind = fileKind(name, mime);
    if (!kind) continue;
    let data = r.data;
    if (kind === "text") data = data.replace(/\u0000/g, "").slice(0, MAX_TEXT_CHARS);
    else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
    const file: CoachFile = { name, mime: kind === "pdf" ? "application/pdf" : kind === "text" ? "text/plain" : mime, kind, data };
    const bytes = fileBytes(file);
    if (fileProblem(file, bytes) || total + bytes > MAX_TOTAL_BYTES) continue;
    total += bytes;
    out.push(file);
  }
  return out;
}

/** The question with its files, for the model. */
export function withFiles(text: string, files: readonly CoachFile[]): string | UserPart[] {
  return files.length ? [{ type: "text", text }, ...files.map((file) => ({ type: "file" as const, file }))] : text;
}

/** A text file as the model reads it: its name, then its contents between markers. */
export const textFileBlock = (f: CoachFile): string => `Attached file "${f.name}":\n<<<file\n${f.data}\nfile>>>`;

/** The words of a message's content, whatever its shape (for the scripted dev model). */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (p && typeof p === "object" && (p as UserPart).type === "text" ? (p as { text: string }).text : "")).join("\n");
}
