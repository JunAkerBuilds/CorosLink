// Watchmaker's chats, saved with the face they belong to (studio/projects/<id>/watchmaker/<chat>.json), so deleting
// the face deletes them. Pictures are kept in the automation asset store and named by id, so chats stay small.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlanItem } from "./tools";

export interface ChatPicture { assetId: string; why?: string }

export interface ChatStep { tool: string; label: string; ok: boolean; message?: string }

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  at: string;
  text: string;
  /** The person's pictures: a design reference or a troubleshooting screenshot. */
  attachments?: (ChatPicture & { use: "reference" | "screenshot" })[];
  steps?: ChatStep[];
  pictures?: ChatPicture[];
  plan?: PlanItem[];
  /** Steps applied to the face (each one undo step). */
  edits?: number;
  stopped?: boolean;
  error?: string;
  /** Who answered: provider · model. */
  by?: string;
}

export interface Chat { id: string; projectId: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }
export type ChatSummary = Pick<Chat, "id" | "title" | "updatedAt"> & { messages: number };

const ID = /^[a-f0-9-]{36}$/i;
const MAX_MESSAGES = 200;

export class ChatStore {
  constructor(private readonly projectsDir: string) {}

  private dir(projectId: string): string {
    if (!ID.test(projectId)) throw new Error("That isn't a face.");
    return path.join(this.projectsDir, projectId, "watchmaker");
  }

  private file(projectId: string, chatId: string): string {
    if (!ID.test(chatId)) throw new Error("That isn't a chat.");
    return path.join(this.dir(projectId), `${chatId}.json`);
  }

  async list(projectId: string): Promise<ChatSummary[]> {
    const names = await readdir(this.dir(projectId)).catch(() => [] as string[]);
    const chats = await Promise.all(names.filter((n) => /^[a-f0-9-]{36}\.json$/i.test(n)).map((n) => this.load(projectId, n.slice(0, -5)).catch(() => null)));
    return chats.filter((c): c is Chat => !!c).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages.length }));
  }

  async load(projectId: string, chatId: string): Promise<Chat> {
    const chat = JSON.parse(await readFile(this.file(projectId, chatId), "utf8")) as Chat;
    if (chat.id !== chatId || chat.projectId !== projectId || !Array.isArray(chat.messages)) throw new Error("That chat is damaged.");
    return chat;
  }

  /** A new, empty chat (saved once it has a message). */
  fresh(projectId: string): Chat {
    const now = new Date().toISOString();
    return { id: randomUUID(), projectId, title: "New chat", createdAt: now, updatedAt: now, messages: [] };
  }

  async save(chat: Chat): Promise<void> {
    const file = this.file(chat.projectId, chat.id);
    await mkdir(path.dirname(file), { recursive: true });
    const kept = { ...chat, messages: chat.messages.slice(-MAX_MESSAGES), updatedAt: new Date().toISOString() };
    // Written aside and moved into place, so a crash never leaves half a chat.
    await writeFile(`${file}.tmp`, JSON.stringify(kept));
    await rename(`${file}.tmp`, file);
  }

  async remove(projectId: string, chatId: string): Promise<void> {
    await rm(this.file(projectId, chatId), { force: true });
  }
}

/** A chat's title: the start of its first message. */
export function titleOf(text: string, pictures: number): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return pictures ? "Image reference" : "New chat";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}
