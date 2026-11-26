// The COROS account Studio signs in to for COROS's face catalogs: its official faces, the faces this account saved,
// and the live editable-template list with the advanced filters. Rewritten from CorosLink's corosWatchfaceService.ts
// and corosCredentialStore.ts (docs/studio-port.md, phase 5).
//
// - Secrets stay here. The session token and, when "Save this COROS account" is on, the email and the password's MD5
//   digest (never the password) are kept in studio/coros-account.bin, sealed with the OS keychain. Without a real
//   keychain nothing is written: the session lasts until the app quits and the account can't be saved.
// - The page sees only who is signed in, the region and whether an account is saved.
// - Packages download only from URLs a catalog listed in this run, only from COROS's hosts.
// - Requests go through the global fetch, so Local-Only Mode (dataMode.ts) applies; sign-in and the lists are reads.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Sealer } from "../secrets";
import type { CorosWatchfaceTheme } from "../../watchface/types";
import {
  API_SUCCESS, buildMobileLoginPayload, extractDecimalProperty, findHttpsUrlInJson, hashCorosPassword, mobileBase, mobileHeaders,
  MOBILE_HOSTS, normalizeCorosWatchfaceThemes, parseCorosMobileJson, regionOf, suggestRegion, themeListBody, themeListEndpoint,
  type CorosCatalog, type CorosRegion,
} from "./corosMobile";
import { t } from "@/lib/i18n";

export const MAX_OFFICIAL_PACKAGE = 25 * 1024 * 1024;

export class AccountProblem extends Error {
  constructor(message: string, readonly code = "coros", readonly status = 400) { super(message); }
}

interface Session { accessToken: string; userId?: string; region: CorosRegion; email: string }
interface Saved { account: string; pwdHash: string }
interface State { installId: string; session?: Session; saved?: Saved }

export interface AccountStatus {
  signedIn: boolean;
  email?: string;
  region?: CorosRegion;
  suggestedRegion: CorosRegion;
  /** The saved account's email, when one is saved. */
  savedEmail?: string;
  /** False where there's no OS keychain: then nothing is saved. */
  canSave: boolean;
}

export interface ThemeQuery {
  firmwareType: string;
  language?: string;
  maxWatchFaceVersion?: number;
  snCode?: string;
  modelVersion?: string;
}

/** A final face for publishFace, already checked by corosShare.ts. */
export interface PublishedFace {
  archive: Buffer;
  name: string;
  firmwareType: string;
  language: string;
  /** Decimal text: beyond JavaScript's safe integers. */
  sourceTemplateId: string;
  watchFaceVersion: number;
  backgroundImageId: number;
}

/** What COROS answered for a published face; corosShare.ts checks the link. */
export interface CorosShareAnswer { templateId: string; url?: string; expireTimestamp?: number; previewImageUrl?: string }

/** The createLink body COROS's app sends, with both template IDs as raw JSON numbers. */
export function buildCreateLinkBody(input: { backgroundImageId: number; firmwareType: string; sourceTemplateId: string; templateId: string; name: string }): string {
  if (!/^\d+$/.test(input.templateId) || !/^\d+$/.test(input.sourceTemplateId)) throw new AccountProblem(t("Invalid COROS watch face template ID."), "badInput");
  return `{"type":2,"watchFaceTemplateUserCustom":{"backgroundImageId":${input.backgroundImageId},"firmwareType":${JSON.stringify(input.firmwareType)},"srcWatchFaceTemplateId":${input.sourceTemplateId},"watchFaceTemplateId":${input.templateId},"watchFaceTemplateName":${JSON.stringify(input.name)}}}`;
}

const isCorosHost =(host: string) => host === "coros.com" || host.endsWith(".coros.com");
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface AccountOptions {
  sealer: Sealer;
  /** Whether the sealer really encrypts (secrets.ts keychainSecure). */
  secure: () => Promise<boolean>;
  fetch?: typeof fetch;
  locale?: string;
}

export class CorosAccount {
  private readonly file: string;
  private readonly fetch: typeof fetch;
  private state: State | null = null;
  private loading: Promise<State> | null = null;
  /** Bumped by every sign-in and sign-out, so a slower one never overwrites a newer state. */
  private revision = 0;
  /** Package URLs by catalog and face ID, from lists COROS returned in this run. */
  private readonly known = new Map<string, CorosWatchfaceTheme>();

  constructor(folder: string, private readonly options: AccountOptions) {
    this.file = path.join(folder, "coros-account.bin");
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  private async load(): Promise<State> {
    if (this.state) return this.state;
    return (this.loading ??= (async () => {
      let state: State = { installId: randomBytes(16).toString("hex") };
      try {
        if (await this.options.secure()) {
          const { text, stale } = await this.options.sealer.decrypt(await fs.promises.readFile(this.file));
          const read = JSON.parse(text) as Partial<State>;
          if (typeof read.installId === "string" && /^[a-f0-9]{32}$/.test(read.installId)) {
            state = {
              installId: read.installId,
              ...(read.session?.accessToken && typeof read.session.email === "string" ? { session: { ...read.session, region: regionOf(read.session.region) } } : {}),
              ...(read.saved && typeof read.saved.account === "string" && /^[a-f0-9]{32}$/.test(read.saved.pwdHash ?? "") ? { saved: read.saved } : {}),
            };
            if (stale) await this.write(state);
          }
        }
      } catch { /* none saved, or sealed on another computer: start signed out */ }
      this.state ??= state;
      return this.state;
    })());
  }

  private async write(state: State): Promise<void> {
    if (!(await this.options.secure())) return;
    const sealed = await this.options.sealer.encrypt(JSON.stringify(state));
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.promises.writeFile(temp, sealed, { mode: 0o600 });
      await fs.promises.rename(temp, this.file);
    } finally {
      await fs.promises.rm(temp, { force: true }).catch(() => {});
    }
  }

  private async update(change: (s: State) => State): Promise<void> {
    const next = change(await this.load());
    this.state = next;
    await this.write(next);
  }

  async status(): Promise<AccountStatus> {
    const s = await this.load();
    return {
      signedIn: Boolean(s.session),
      ...(s.session ? { email: s.session.email, region: s.session.region } : {}),
      suggestedRegion: s.session?.region ?? suggestRegion(this.options.locale),
      ...(s.saved ? { savedEmail: s.saved.account } : {}),
      canSave: await this.options.secure(),
    };
  }

  /** One mobile API call. 1019 means the session expired: signed out at once. */
  private async request<T>(endpoint: string, init: { body: string | FormData; region: CorosRegion; session?: Session; allow?: string[]; extraHeaders?: Record<string, string> }):
    Promise<{ result: string; message?: string; data?: T; raw: string }> {
    const { installId } = await this.load();
    const token = init.session?.accessToken;
    const query = token ? `?accessToken=${encodeURIComponent(token)}` : "";
    let answer: Response;
    try {
      answer = await this.fetch(`${mobileBase(init.region)}${endpoint}${query}`, {
        method: "POST",
        // A form sets its own multipart content type.
        headers: { ...mobileHeaders(installId, token, init.session?.userId), ...init.extraHeaders, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) },
        body: init.body,
      });
    } catch { throw new AccountProblem(t("COROS couldn't be reached. Check the connection and try again."), "offline", 502); }
    const raw = await answer.text();
    if (!answer.ok) throw new AccountProblem(t("COROS answered {status}.", { status: answer.status }), "coros", 502);
    let payload: { result?: unknown; apiCode?: unknown; message?: string; data?: T };
    try { payload = parseCorosMobileJson(raw) as typeof payload; } catch { throw new AccountProblem(t("COROS sent an answer that couldn't be read."), "coros", 502); }
    const result = String(payload.result ?? payload.apiCode ?? "");
    if (result !== API_SUCCESS && !init.allow?.includes(result)) {
      if (result === "1019") {
        await this.signOut();
        throw new AccountProblem(t("Your COROS sign-in expired. Sign in again."), "signedOut", 401);
      }
      throw new AccountProblem(`${payload.message?.trim() || t("COROS refused that.")}${result && result !== "LOCAL" ? ` (COROS ${result})` : ""}`, result === "LOCAL" ? "localOnly" : "coros", result === "LOCAL" ? 403 : 400);
    }
    return { result, message: payload.message, data: payload.data, raw };
  }

  private async establish(account: string, pwdHash: string, region: CorosRegion): Promise<void> {
    const revision = ++this.revision;
    let envelope = await this.request<{ accessToken?: string; userId?: string }>("/user/login", { region, body: JSON.stringify(buildMobileLoginPayload(account, pwdHash, 1)), allow: ["1115"] });
    // 1115 "User logged in" is the client's session-conflict checkpoint; retrying with checkStatus 0 is the app's own next step.
    if (envelope.result === "1115") envelope = await this.request("/user/login", { region, body: JSON.stringify(buildMobileLoginPayload(account, pwdHash, 0)) });
    const accessToken = envelope.data?.accessToken?.trim();
    if (!accessToken) throw new AccountProblem(t("COROS didn't return a session. Try again."), "coros", 502);
    if (revision !== this.revision) throw new AccountProblem(t("The COROS sign-in changed meanwhile. Sign in again."), "changed", 409);
    const userId = extractDecimalProperty(envelope.raw, "userId") ?? (typeof envelope.data?.userId === "string" ? envelope.data.userId : undefined);
    this.known.clear();
    await this.update((s) => ({ ...s, session: { accessToken, ...(userId ? { userId } : {}), region, email: account } }));
  }

  async signIn(input: { email?: unknown; password?: unknown; region?: unknown; remember?: unknown }): Promise<AccountStatus> {
    const account = typeof input.email === "string" ? input.email.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!account || !password || account.length > 200 || CONTROL.test(account)) throw new AccountProblem(t("Enter your COROS email and password."), "badInput");
    const pwdHash = hashCorosPassword(password);
    await this.establish(account, pwdHash, regionOf(input.region));
    if (input.remember === true && (await this.options.secure())) await this.update((s) => ({ ...s, saved: { account, pwdHash } }));
    else if (input.remember === false) await this.update(({ saved: _saved, ...s }) => s);
    return this.status();
  }

  /** Signs in again with the saved account. */
  async signInSaved(input: { region?: unknown }): Promise<AccountStatus> {
    const { saved } = await this.load();
    if (!saved) throw new AccountProblem(t("No COROS account is saved here. Enter your email and password."), "noSaved");
    await this.establish(saved.account, saved.pwdHash, regionOf(input.region));
    return this.status();
  }

  /** Ends the session; a saved account stays for next time. */
  /**
   * The COROS sign-in CorosLink kept (coroslink/move.ts): its mobile session and, when "remember" was on, the login
   * it signs in again with. Taken only while this account has neither.
   */
  async adopt(input: { session?: { accessToken: string; userId?: string; region?: unknown; email: string }; saved?: Saved }): Promise<boolean> {
    const state = await this.load();
    if (state.session || state.saved) return false;
    const saved = input.saved && /^[a-f0-9]{32}$/.test(input.saved.pwdHash) && input.saved.account ? input.saved : undefined;
    const session = input.session?.accessToken && input.session.email ? { accessToken: input.session.accessToken, ...(input.session.userId ? { userId: input.session.userId } : {}), region: regionOf(input.session.region), email: input.session.email } : undefined;
    if (!saved && !session) return false;
    this.revision++;
    await this.update((s) => ({ ...s, ...(session ? { session } : {}), ...(saved ? { saved } : {}) }));
    return true;
  }

  async signOut(): Promise<AccountStatus> {
    this.revision++;
    this.known.clear();
    await this.update(({ session: _session, ...s }) => s);
    return this.status();
  }

  /** Removes the saved account (the session stays). */
  async forget(): Promise<AccountStatus> {
    await this.update(({ saved: _saved, ...s }) => s);
    return this.status();
  }

  async signedIn(): Promise<boolean> {
    return Boolean((await this.load()).session);
  }

  /** A COROS face list for a watch. Official and saved faces need the session; templates do too when asked live. */
  async themes(catalog: CorosCatalog, query: ThemeQuery): Promise<CorosWatchfaceTheme[]> {
    const { session } = await this.load();
    if (!session) throw new AccountProblem(t("Sign in to your COROS account first."), "signedOut", 401);
    const firmwareType = query.firmwareType.trim();
    const language = (query.language || "en-US").trim();
    const maxWatchFaceVersion = query.maxWatchFaceVersion ?? 5;
    const snCode = (query.snCode ?? "").trim();
    const modelVersion = (query.modelVersion ?? "").trim();
    if (!firmwareType || firmwareType.length > 120 || CONTROL.test(firmwareType)) throw new AccountProblem(t("Enter a COROS firmware type."), "badInput");
    if (!/^[a-z]{2,3}-[A-Z]{2}$/.test(language)) throw new AccountProblem(t("Language must be a locale such as en-US."), "badInput");
    if (!Number.isSafeInteger(maxWatchFaceVersion) || maxWatchFaceVersion < 0 || maxWatchFaceVersion > 999) throw new AccountProblem(t("Maximum version is a whole number from 0 to 999."), "badInput");
    if (snCode.length > 80 || CONTROL.test(snCode) || modelVersion.length > 120 || CONTROL.test(modelVersion)) throw new AccountProblem(t("Enter a valid watch serial."), "badInput");
    const answer = await this.request<unknown>(themeListEndpoint(catalog), {
      region: session.region, session,
      body: themeListBody(catalog, session.accessToken, { firmwareType, language, maxWatchFaceVersion, snCode }),
      ...(catalog !== "editable" && modelVersion ? { extraHeaders: { "x-model-version": modelVersion } } : {}),
    });
    const themes = normalizeCorosWatchfaceThemes(answer.data, catalog);
    for (const t of themes) if (t.id && t.packageUrl) this.known.set(`${catalog}:${t.id}`, t);
    return themes;
  }

  /**
   * Saves a final face archive to this account's custom faces and asks COROS for its share link (corosShare.ts checks
   * and fits the archive first). Template IDs are beyond Number.MAX_SAFE_INTEGER, so they go into both bodies as raw
   * JSON numbers, never through JSON.parse or JSON.stringify. Both requests are writes: Local-Only Mode stops them.
   */
  async publishFace(face: PublishedFace): Promise<CorosShareAnswer> {
    const { session } = await this.load();
    if (!session) throw new AccountProblem(t("Sign in to your COROS account first."), "signedOut", 401);
    if (!/^\d{1,20}$/.test(face.sourceTemplateId)) throw new AccountProblem(t("This face has no valid COROS template ID."), "badInput");
    const saveBody = {
      accessToken: session.accessToken, backgroundImageId: face.backgroundImageId, firmwareType: face.firmwareType, language: face.language,
      maxWatchFaceVersion: face.watchFaceVersion, releaseType: 1, saveOrUpdate: 1, srcWatchFaceTemplateId: "__SRC_TEMPLATE_ID__", version: 2,
      watchFaceTemplateName: face.name,
    };
    const form = new FormData();
    form.append("jsonParameter", JSON.stringify(saveBody).replace('"__SRC_TEMPLATE_ID__"', face.sourceTemplateId));
    form.append("saveOrUpdate", "1");
    form.append("watchFaceTemplateUserCustomZipFile", new Blob([new Uint8Array(face.archive)], { type: "application/zip" }), "watchFaceTemplateUserCustomZipFile.dat");
    const saved = await this.request<{ watchFaceTemplateId?: unknown }>("/watchFaceTemplateUserCustom/saveOrUpdateV2", { region: session.region, session, body: form });
    const id = saved.data?.watchFaceTemplateId;
    const templateId = extractDecimalProperty(saved.raw, "watchFaceTemplateId") ?? (typeof id === "string" && /^\d{1,20}$/.test(id) ? id : undefined);
    if (!templateId) throw new AccountProblem(t("COROS saved the face but didn't return its ID."), "coros", 502);
    const link = await this.request<{ url?: unknown; expireTimestamp?: unknown; previewImageUrl?: unknown }>("/watchface/share/createLink", {
      region: session.region, session,
      body: buildCreateLinkBody({ backgroundImageId: face.backgroundImageId, firmwareType: face.firmwareType, sourceTemplateId: face.sourceTemplateId, templateId, name: face.name }),
    });
    const { url, expireTimestamp, previewImageUrl } = link.data ?? {};
    return {
      templateId,
      ...(typeof url === "string" ? { url: url.trim() } : {}),
      ...(typeof expireTimestamp === "number" && Number.isFinite(expireTimestamp) ? { expireTimestamp } : {}),
      ...(typeof previewImageUrl === "string" ? { previewImageUrl } : {}),
    };
  }

  /** A face a list returned in this run, by catalog and ID. */
  theme(catalog: CorosCatalog, id: string): CorosWatchfaceTheme | undefined {
    return this.known.get(`${catalog}:${id}`);
  }

  /**
   * A listed face's package (ZIP or compiled BIN, ≤25 MB). The session's token goes along as the app sends it; a JSON
   * envelope pointing at the real file is followed once, and only to COROS.
   */
  async fetchPackage(packageUrl: string): Promise<Buffer> {
    const { session, installId } = await this.load();
    const get = async (target: string): Promise<Buffer> => {
      const u = new URL(target);
      if (u.protocol !== "https:" || !isCorosHost(u.hostname)) throw new AccountProblem(t("Faces only come from COROS."), "badUrl");
      if (session && MOBILE_HOSTS.includes(u.hostname) && !u.searchParams.has("accessToken")) u.searchParams.set("accessToken", session.accessToken);
      let answer: Response;
      try { answer = await this.fetch(u, { headers: mobileHeaders(installId, session?.accessToken, session?.userId) }); } catch {
        throw new AccountProblem(t("COROS couldn't be reached. Check the connection and try again."), "offline", 502);
      }
      if (!answer.ok) throw new AccountProblem(t("COROS answered {status} for that face.", { status: answer.status }), "download", 502);
      const bytes = Buffer.from(await answer.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_OFFICIAL_PACKAGE) throw new AccountProblem(t("That face's package must be between 1 byte and 25 MB."), "download", 502);
      return bytes;
    };
    let bytes = await get(packageUrl);
    const head = bytes.subarray(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0, 64).toString("latin1").trimStart();
    if (head.startsWith("{") || head.startsWith("[")) {
      const nested = findHttpsUrlInJson(bytes.toString("utf8").replace(/^﻿/, ""));
      if (nested) bytes = await get(nested);
    }
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try { bytes = gunzipSync(bytes); } catch { /* checked by the caller */ }
    }
    return bytes;
  }
}
