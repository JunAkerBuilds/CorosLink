// Files the athlete attaches to Coach messages. The window extracts what the
// model needs (document text, downscaled images, page renders) and sends it
// once with the message; this store keeps it under the conversation so every
// later turn can send it again, and the transcript only records a summary.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ChatFileAttachment,
  ChatMessage,
  ChatMessageImage,
  CoachFileUpload,
  CoachFileUploadImage
} from "./types";

export const MAX_COACH_UPLOADS_PER_MESSAGE = 6;
export const MAX_COACH_UPLOAD_BYTES = 32 * 1024 * 1024;
/** About 30k tokens: a long plan fits, a book does not crowd out the coach prompt. */
export const MAX_COACH_DOCUMENT_CHARS = 120_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES_PER_UPLOAD = 12;
/** Images a single request carries; older ones are named instead of resent. */
export const MAX_COACH_MODEL_IMAGES = 12;
/** Document contents travel with the athlete's latest few messages; older documents are named instead. */
export const COACH_DOCUMENT_TURNS = 3;

/** What the athlete may attach, by extension; also what Open may hand to the system. */
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".csv", ".tsv", ".json"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"]);

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

interface StoredMeta {
  attachment: ChatFileAttachment;
  originalFile: string;
  images: { file: string; mimeType: CoachFileUploadImage["mimeType"] }[];
  hasText: boolean;
}

export interface LoadedCoachAttachment {
  attachment: ChatFileAttachment;
  text?: string;
  images: { mimeType: CoachFileUploadImage["mimeType"]; base64: string }[];
}

export class CoachAttachmentError extends Error {}

export interface CoachAttachmentStore {
  save(sessionId: string, upload: CoachFileUpload): Promise<ChatFileAttachment>;
  load(sessionId: string, id: string): Promise<LoadedCoachAttachment | null>;
  /** The kept original, when it is a type the system may open. */
  originalPath(sessionId: string, id: string): Promise<string | null>;
  /** The first image as a data URL, for transcript thumbnails. */
  preview(sessionId: string, id: string): Promise<string | null>;
  remove(sessionId: string, ids: string[]): Promise<void>;
  removeSession(sessionId: string): Promise<void>;
}

export function createCoachAttachmentStore(root: string): CoachAttachmentStore {
  const sessionDir = (sessionId: string) => {
    if (!SAFE_ID.test(sessionId)) throw new CoachAttachmentError("Unknown conversation.");
    return path.join(root, sessionId);
  };
  const attachmentDir = (sessionId: string, id: string) => {
    if (!SAFE_ID.test(id)) throw new CoachAttachmentError("Unknown attachment.");
    return path.join(sessionDir(sessionId), id);
  };
  const readMeta = async (dir: string): Promise<StoredMeta | null> => {
    try {
      return JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")) as StoredMeta;
    } catch {
      return null;
    }
  };

  return {
    async save(sessionId, upload) {
      const checked = checkUpload(upload);
      const id = crypto.randomUUID();
      const dir = attachmentDir(sessionId, id);
      await fs.mkdir(dir, { recursive: true });
      try {
        const originalFile = `original${checked.extension}`;
        await fs.writeFile(path.join(dir, originalFile), checked.original);
        const images: StoredMeta["images"] = [];
        for (const [index, image] of checked.images.entries()) {
          const file = `image-${index}${image.mimeType === "image/png" ? ".png" : ".jpg"}`;
          await fs.writeFile(path.join(dir, file), image.data);
          images.push({ file, mimeType: image.mimeType });
        }
        if (checked.text) await fs.writeFile(path.join(dir, "text.txt"), checked.text, "utf8");
        const first = checked.images[0];
        const attachment: ChatFileAttachment = {
          id,
          name: checked.name,
          kind: checked.kind,
          mimeType: checked.mimeType,
          sizeBytes: checked.original.byteLength,
          ...(checked.pageCount ? { pageCount: checked.pageCount } : {}),
          ...(checked.text ? { textChars: checked.text.length } : {}),
          ...(checked.truncated ? { truncated: true } : {}),
          ...(checked.kind === "document" && images.length ? { pageImages: images.length } : {}),
          ...(checked.kind === "image" && first ? { width: first.width, height: first.height } : {})
        };
        const meta: StoredMeta = { attachment, originalFile, images, hasText: Boolean(checked.text) };
        await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");
        return attachment;
      } catch (error) {
        await fs.rm(dir, { recursive: true, force: true });
        throw error;
      }
    },

    async load(sessionId, id) {
      const dir = attachmentDir(sessionId, id);
      const meta = await readMeta(dir);
      if (!meta) return null;
      try {
        const text = meta.hasText ? await fs.readFile(path.join(dir, "text.txt"), "utf8") : undefined;
        const images = await Promise.all(
          meta.images.map(async (image) => ({
            mimeType: image.mimeType,
            base64: (await fs.readFile(path.join(dir, path.basename(image.file)))).toString("base64")
          }))
        );
        return { attachment: meta.attachment, ...(text ? { text } : {}), images };
      } catch {
        return null;
      }
    },

    async originalPath(sessionId, id) {
      const dir = attachmentDir(sessionId, id);
      const meta = await readMeta(dir);
      if (!meta) return null;
      const file = path.join(dir, path.basename(meta.originalFile));
      const extension = path.extname(file).toLowerCase();
      if (!DOCUMENT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension)) return null;
      try {
        await fs.access(file);
        return file;
      } catch {
        return null;
      }
    },

    async preview(sessionId, id) {
      const dir = attachmentDir(sessionId, id);
      const meta = await readMeta(dir);
      const image = meta?.images[0];
      if (!image) return null;
      try {
        const data = await fs.readFile(path.join(dir, path.basename(image.file)));
        return `data:${image.mimeType};base64,${data.toString("base64")}`;
      } catch {
        return null;
      }
    },

    async remove(sessionId, ids) {
      await Promise.all(
        ids.map((id) => fs.rm(attachmentDir(sessionId, id), { recursive: true, force: true }))
      );
    },

    async removeSession(sessionId) {
      await fs.rm(sessionDir(sessionId), { recursive: true, force: true });
    }
  };
}

interface CheckedUpload {
  name: string;
  mimeType: string;
  kind: "image" | "document";
  extension: string;
  original: Uint8Array;
  text?: string;
  truncated: boolean;
  pageCount?: number;
  images: CoachFileUploadImage[];
}

/** Uploads come from the window: check every field before anything is written. */
function checkUpload(upload: CoachFileUpload): CheckedUpload {
  if (!upload || typeof upload !== "object") throw new CoachAttachmentError("That file could not be attached.");
  const name = cleanFileName(upload.name);
  const extension = path.extname(name).toLowerCase();
  const kind = upload.kind;
  if (kind !== "image" && kind !== "document") throw new CoachAttachmentError(`${name} is not a supported file.`);
  const allowed = kind === "image" ? IMAGE_EXTENSIONS : DOCUMENT_EXTENSIONS;
  if (!allowed.has(extension)) throw new CoachAttachmentError(`${name} is not a supported file.`);
  if (!(upload.original instanceof Uint8Array) || upload.original.byteLength === 0) {
    throw new CoachAttachmentError(`${name} is empty.`);
  }
  if (upload.original.byteLength > MAX_COACH_UPLOAD_BYTES) {
    throw new CoachAttachmentError(`${name} is larger than 32 MB.`);
  }
  const images = Array.isArray(upload.images) ? upload.images : [];
  if (images.length > MAX_IMAGES_PER_UPLOAD) throw new CoachAttachmentError(`${name} has too many pages to attach as images.`);
  for (const image of images) {
    if (
      !image ||
      !(image.data instanceof Uint8Array) ||
      image.data.byteLength === 0 ||
      image.data.byteLength > MAX_IMAGE_BYTES ||
      (image.mimeType !== "image/jpeg" && image.mimeType !== "image/png") ||
      !matchesImageType(image.data, image.mimeType) ||
      !isDimension(image.width) ||
      !isDimension(image.height)
    ) {
      throw new CoachAttachmentError(`${name} could not be read as an image.`);
    }
  }
  if (kind === "image" && images.length !== 1) throw new CoachAttachmentError(`${name} could not be read as an image.`);

  let text = typeof upload.text === "string" ? upload.text.replace(/\r\n?/g, "\n").trim() : "";
  let truncated = upload.truncated === true;
  if (text.length > MAX_COACH_DOCUMENT_CHARS) {
    text = text.slice(0, MAX_COACH_DOCUMENT_CHARS);
    truncated = true;
  }
  if (kind === "document" && !text && images.length === 0) {
    throw new CoachAttachmentError(`${name} has no text Coach can read.`);
  }
  const pageCount =
    typeof upload.pageCount === "number" && Number.isInteger(upload.pageCount) && upload.pageCount > 0
      ? upload.pageCount
      : undefined;
  const mimeType = typeof upload.mimeType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(upload.mimeType)
    ? upload.mimeType
    : "application/octet-stream";
  return {
    name,
    mimeType,
    kind,
    extension,
    original: upload.original,
    ...(text ? { text } : {}),
    truncated: Boolean(text) && truncated,
    ...(pageCount ? { pageCount } : {}),
    images
  };
}

function cleanFileName(value: unknown): string {
  const base = typeof value === "string" ? value.split(/[\\/]/).pop() ?? "" : "";
  // Control characters and quotes would break the model's file tags.
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>]/g, "").trim();
  if (!cleaned) throw new CoachAttachmentError("That file has no name.");
  return cleaned.length > 160 ? `${cleaned.slice(0, 150)}${path.extname(cleaned).slice(0, 10)}` : cleaned;
}

function matchesImageType(data: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  }
  return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 8192;
}

// ----- Requests -----

/** Loads what a message's files are, for one request. Null when a file is gone. */
export type CoachAttachmentLoader = (attachment: ChatFileAttachment) => Promise<LoadedCoachAttachment | null>;

/**
 * Turns attached files into what every provider understands: document text in
 * <attached_file> blocks inside the message, and images on `images`. Only the
 * newest MAX_COACH_MODEL_IMAGES images are sent, and documents only with the
 * athlete's latest COACH_DOCUMENT_TURNS messages; older ones are named instead.
 */
export async function expandCoachAttachments(
  messages: ChatMessage[],
  load: CoachAttachmentLoader
): Promise<ChatMessage[]> {
  if (!messages.some((message) => message.files?.length)) return messages;
  let imageBudget = MAX_COACH_MODEL_IMAGES;
  const documentsFrom = coachDocumentWindowStart(messages);
  const expanded: ChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.files?.length) {
      expanded.unshift(message);
      continue;
    }
    const blocks: string[] = [];
    const images: ChatMessageImage[] = [];
    for (const file of message.files) {
      if (file.kind === "document" && index < documentsFrom) {
        blocks.push(earlierDocumentBlock(file));
        continue;
      }
      const loaded = await load(file).catch(() => null);
      if (!loaded) {
        blocks.push(`[Attached file no longer available: ${file.name}]`);
        continue;
      }
      const pages = loaded.images.length;
      const sendImages = pages > 0 && pages <= imageBudget;
      if (sendImages) {
        imageBudget -= pages;
        loaded.images.forEach((image, page) => {
          images.push({
            label: file.kind === "document" ? `${file.name}, page ${page + 1}` : file.name,
            mimeType: image.mimeType,
            base64: image.base64
          });
        });
      }
      blocks.push(attachedFileBlock(file, loaded.text, pages, sendImages));
    }
    const content = [message.content.trim(), ...blocks].filter(Boolean).join("\n\n");
    expanded.unshift({ ...message, content, ...(images.length ? { images } : {}) });
  }
  return expanded;
}

/**
 * Where the messages whose documents are sent in full begin: the athlete's
 * latest COACH_DOCUMENT_TURNS messages. Answers to Coach's own questions don't
 * count; they belong to the request that led to the question.
 */
export function coachDocumentWindowStart(messages: ChatMessage[]): number {
  let athleteTurns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && !message.answersPrompt && ++athleteTurns > COACH_DOCUMENT_TURNS) return index + 1;
  }
  return 0;
}

const ATTACHED_FILE_BLOCK = /(<attached_file\b[^>]*>\n)([\s\S]*?)(\n<\/attached_file>)/g;
const SHORTENED_NOTE = "[The text was cut here to fit this conversation; the rest of the file is not included.]";

/**
 * Message text with about `removeChars` fewer characters of attached document
 * text. The longest documents are cut first, down to a common length, and say
 * so; the athlete's own words and shorter documents stay whole.
 */
export function shortenAttachedDocuments(content: string, removeChars: number): string {
  const lengths = Array.from(content.matchAll(ATTACHED_FILE_BLOCK), (match) => match[2]!.length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (removeChars <= 0 || total === 0) return content;
  // A cut text ends with a blank line and the note.
  let remaining = Math.max(0, total - removeChars - (SHORTENED_NOTE.length + 2) * lengths.length);
  let cap = 0;
  const sorted = [...lengths].sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index += 1) {
    const share = remaining / (sorted.length - index);
    if (sorted[index]! >= share) {
      cap = Math.floor(share);
      break;
    }
    remaining -= sorted[index]!;
  }
  return content.replace(ATTACHED_FILE_BLOCK, (block, open: string, body: string, close: string) => {
    if (body.length <= cap) return block;
    const kept = body.slice(0, cap).trimEnd();
    return `${open}${kept ? `${kept}\n\n` : ""}${SHORTENED_NOTE}${close}`;
  });
}

function fileAttributes(file: ChatFileAttachment): string {
  const attributes = [`name="${file.name}"`];
  if (file.pageCount) attributes.push(`pages="${file.pageCount}"`);
  return attributes.join(" ");
}

function earlierDocumentBlock(file: ChatFileAttachment): string {
  return (
    `<attached_file ${fileAttributes(file)}>\n` +
    "[Shared earlier in the conversation; its contents are not repeated here. " +
    "If you need them again, ask the athlete to attach the file again.]\n" +
    "</attached_file>"
  );
}

function attachedFileBlock(
  file: ChatFileAttachment,
  text: string | undefined,
  pageImages: number,
  imagesSent: boolean
): string {
  if (file.kind === "image") {
    return imagesSent
      ? `[Attached image: ${file.name}]`
      : `[Image shared earlier in the conversation: ${file.name}]`;
  }
  const body: string[] = [];
  if (text) body.push(text.replace(/<\/attached_file/gi, "<\\/attached_file"));
  if (file.truncated) body.push("[The text was cut here to fit; the rest of the file is not included.]");
  if (pageImages > 0) {
    body.push(
      imagesSent
        ? `[This file has little or no text layer; its first ${pageImages} page(s) are attached as images.]`
        : "[This file's pages were sent as images earlier in the conversation.]"
    );
  }
  return `<attached_file ${fileAttributes(file)}>\n${body.join("\n\n")}\n</attached_file>`;
}
