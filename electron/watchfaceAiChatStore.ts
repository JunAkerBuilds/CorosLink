import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createWatchfaceAutomationAssetStore } from "./watchfaceAutomationAssets";
import type { WatchfaceAiChatSummary, WatchfaceAiSavedChat } from "./watchfaceAutomationTypes";

const MAX_MESSAGES = 200;
const MAX_TITLE = 80;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9-]{8,80}$/;

interface StoredChat {
  version: 1;
  id: string;
  projectKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Panel messages with every data:image string replaced by {assetId}. */
  messages: unknown[];
}

/**
 * Persists Watch Face Studio AI conversations as one JSON file per chat.
 * Images (attachments, previews, generated art) live in the automation asset
 * store and are referenced by id, so transcripts stay small.
 */
export class WatchfaceAiChatStore {
  private readonly directory: string;
  private readonly assets;

  constructor(userDataPath: string) {
    this.directory = path.join(path.resolve(userDataPath), "watchface-ai-chats");
    this.assets = createWatchfaceAutomationAssetStore(userDataPath);
  }

  async list(projectKey: string): Promise<WatchfaceAiChatSummary[]> {
    const key = requireKey(projectKey);
    const chats = await this.readAll();
    return chats
      .filter((chat) => chat.projectKey === key)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary);
  }

  async load(id: string): Promise<WatchfaceAiSavedChat> {
    const chat = await this.read(requireId(id));
    if (!chat) throw new Error("That chat no longer exists.");
    // Restore images message by message so one missing asset only drops that
    // message's pictures instead of the whole conversation.
    const messages = await Promise.all(chat.messages.map(async (message) => {
      try {
        return await this.assets.hydrateAssetRefs(message);
      } catch {
        return stripAssetRefs(message);
      }
    }));
    return { ...toSummary(chat), projectKey: chat.projectKey, messages };
  }

  async save(input: { id?: string; projectKey: string; title?: string; messages: unknown[] }): Promise<WatchfaceAiChatSummary> {
    const projectKey = requireKey(input.projectKey);
    if (!Array.isArray(input.messages)) throw new Error("Chat messages must be an array.");
    const id = input.id ? requireId(input.id) : crypto.randomUUID();
    const existing = input.id ? await this.read(id) : null;
    const now = new Date().toISOString();
    const trimmed = input.messages.slice(-MAX_MESSAGES);
    let messages: unknown[];
    try {
      messages = await this.assets.externalizeDataImages(trimmed);
    } catch (error) {
      console.warn("[watchface-ai] saving chat without images:", error instanceof Error ? error.message : error);
      messages = stripDataImages(trimmed) as unknown[];
    }
    const chat: StoredChat = {
      version: 1,
      id,
      projectKey,
      title: (input.title?.trim() || existing?.title || "New chat").slice(0, MAX_TITLE),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages
    };
    const body = JSON.stringify(chat);
    if (Buffer.byteLength(body) > MAX_FILE_BYTES) throw new Error("This chat is too large to save.");
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.file(id);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, body, { mode: 0o600 });
    await fs.promises.rename(temporary, target);
    return toSummary(chat);
  }

  async rename(id: string, title: string): Promise<WatchfaceAiChatSummary> {
    const chat = await this.read(requireId(id));
    if (!chat) throw new Error("That chat no longer exists.");
    const next = { ...chat, title: title.trim().slice(0, MAX_TITLE) || chat.title };
    await fs.promises.writeFile(this.file(chat.id), JSON.stringify(next), { mode: 0o600 });
    return toSummary(next);
  }

  async delete(id: string): Promise<void> {
    await fs.promises.rm(this.file(requireId(id)), { force: true });
  }

  private file(id: string): string {
    return path.join(this.directory, `${id}.json`);
  }

  private async read(id: string): Promise<StoredChat | null> {
    try {
      const stat = await fs.promises.stat(this.file(id));
      if (stat.size > MAX_FILE_BYTES) return null;
      const parsed = JSON.parse(await fs.promises.readFile(this.file(id), "utf8")) as StoredChat;
      return parsed?.version === 1 && parsed.id === id && Array.isArray(parsed.messages) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async readAll(): Promise<StoredChat[]> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.directory);
    } catch {
      return [];
    }
    const chats = await Promise.all(names
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(name.slice(0, -5))));
    return chats.filter((chat): chat is StoredChat => chat !== null);
  }
}

function toSummary(chat: StoredChat): WatchfaceAiChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length
  };
}

function requireId(id: unknown): string {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("Invalid chat id.");
  return id;
}

function requireKey(key: unknown): string {
  if (typeof key !== "string" || !key.trim() || key.length > 300 || key.includes("\0")) {
    throw new Error("Invalid chat project key.");
  }
  return key;
}

function stripDataImages(value: unknown): unknown {
  if (typeof value === "string") return value.startsWith("data:image/") ? null : value;
  if (Array.isArray(value)) return value.map(stripDataImages).filter((item) => item !== null);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stripDataImages(child)]));
  }
  return value;
}

function stripAssetRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(item && typeof item === "object" && "assetId" in item && Object.keys(item).length === 1))
      .map(stripAssetRefs);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stripAssetRefs(child)]));
  }
  return value;
}
