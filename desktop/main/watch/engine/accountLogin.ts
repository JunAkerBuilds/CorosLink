// Gets the watch account key straight from COROS: sign in to the COROS mobile API as its Android client, then unwrap
// the RSA key COROS returns with the session. A port of CorosKit's Pairing/CorosAccountLogin.swift. Only the key is
// kept; the password and COROS's session token are never stored or logged.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, type KeyObject } from "node:crypto";
import { CorosError } from "./bytes";
import { secondsFromGMT, type WatchAccountKey } from "./systemBind";

export type Fetch = typeof fetch;

/** COROS accounts live on one regional host; the wrong one says "Account is not registered". */
export type Region = "us" | "eu" | "sg" | "cn";
export const REGIONS: readonly Region[] = ["us", "eu", "sg", "cn"];
export const REGION_LABELS: Record<Region, string> = { us: "Global", eu: "Europe", sg: "Singapore", cn: "China" };
const BASE_URLS: Record<Region, string> = {
  us: "https://api.coros.com/coros",
  eu: "https://apieu.coros.com/coros",
  sg: "https://apisg.coros.com/coros",
  cn: "https://apicn.coros.com/coros",
};

/** A first guess from a locale such as "de-DE" or "en_CA", as CorosLink for Mac guesses it. */
export function suggestedRegion(locale: string = Intl.DateTimeFormat().resolvedOptions().locale): Region {
  const country = localeRegion(locale) ?? "";
  if (["CN", "HK", "MO", "TW"].includes(country)) return "cn";
  if (country && !["US", "CA", "MX"].includes(country)) return "eu";
  return "us";
}

/** COROS answered "already signed in elsewhere" (1115). Continuing may sign that other session out. */
export class SessionConflict extends CorosError {
  constructor() { super("Your COROS account is signed in somewhere else."); }
}

/** What one regional server answered. */
export type Answer =
  | { kind: "notRegistered" }
  /** COROS's result code and its own message, if it sent one. */
  | { kind: "refused"; code: string; message: string | null }
  | { kind: "noReply" }
  | { kind: "unexpectedReply" };

export const answerText = (a: Answer): string =>
  a.kind === "notRegistered" ? "not registered" : a.kind === "refused" ? `COROS ${a.code}` : a.kind === "noReply" ? "no reply" : "unexpected reply";
/** COROS 1006: "Please input correct user name and password". */
export const isWrongPassword = (a: Answer): boolean => a.kind === "refused" && a.code === "1006";

/** A sign-in COROS turned down, with what each server answered in the order tried. Never the email or password. */
export class SignInFailed extends CorosError {
  readonly summary: string;
  constructor(readonly reason: string, readonly answers: { region: Region; answer: Answer }[]) {
    const summary = answers.map((a) => `${REGION_LABELS[a.region]}: ${answerText(a.answer)}`).join(" · ");
    super(`${reason}\n\nServers tried: ${summary}`);
    this.summary = summary;
  }
}

const APP_KEY = "3475792298363620";
const IV = Buffer.from("weloop3_2015_03#");
const VERSION_CODE = "407081000";
const APP_VERSION = "1125929972137984";
const USER_SETTING_SCOPE = "CAEQARgBIAEoATABOAFAAQ==";
const KEY_ERROR = "COROS didn't send a usable watch key for this account. Try again, or scan from CorosLink desktop.";
const UNREACHABLE = "Couldn't reach COROS. Check your connection and try again.";
const UNEXPECTED = "COROS sent an unexpected response. Try again later.";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** 32 lowercase hex characters, kept per install (COROS sees it as the phone's name). */
export const newInstallId = (): string => randomBytes(16).toString("hex");

/** MD5 of the password in lowercase hex, as the official client sends it (CorosKit's TrainingHub.passwordHash). */
export const passwordHash = (password: string): string => createHash("md5").update(password, "utf8").digest("hex");

export interface LoginOptions {
  /** 32 lowercase hex characters for this install. */
  installId: string;
  fetchImpl?: Fetch;
  /** Tests only; replaces every regional host. */
  baseOverride?: string;
}

/** Signs in and returns the account key, trying the other regions in turn when `region` doesn't know the account. */
export async function watchKey(options: LoginOptions, email: string, password: string, region: Region, takeOverSession = false): Promise<WatchAccountKey> {
  const account = email.trim();
  if (!account || !password) throw new CorosError("Enter your COROS email and password.");
  const hash = passwordHash(password);
  const answers: { region: Region; answer: Answer }[] = [];
  let lastMessage = "COROS couldn't find that account.";
  for (const candidate of [region, ...REGIONS.filter((r) => r !== region)]) {
    try {
      return await signInOnce(options, account, hash, candidate, takeOverSession);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      answers.push({ region: candidate, answer: error.answer });
      lastMessage = error.message;
      if (error.answer.kind === "notRegistered") continue;
      throw new SignInFailed(lastMessage, answers);
    }
  }
  throw new SignInFailed(lastMessage, answers);
}

/** The helper's `signIn` command: the key as CorosKit's JSONEncoder writes it, and the masked account. */
export async function signIn(fields: Record<string, unknown>, fetchImpl?: Fetch): Promise<{ key: string; account: string }> {
  const { email, password, region } = fields;
  if (typeof email !== "string" || typeof password !== "string" || typeof region !== "string" || !(REGIONS as readonly string[]).includes(region)) {
    throw new CorosError("Email, password and region are needed.");
  }
  const installId = typeof fields.installId === "string" ? fields.installId : newInstallId();
  const key = await watchKey({ installId, fetchImpl }, email, password, region as Region, fields.takeOver === true);
  return { key: encodeWatchKey(key), account: maskedAccount(key) };
}

/** The last digits of the account ID, enough to recognise it. */
export const maskedAccount = (key: WatchAccountKey): string => `•••• ${String(key.accountUserId).slice(-4)}`;

/** The key as Swift's JSONEncoder writes WatchAccountKey: nil left out, Data as base64 with "/" escaped as "\/".
 * (JSONEncoder's key order is unspecified; this writes them sorted, as engine.test.ts's keyText does.) */
export function encodeWatchKey(key: WatchAccountKey): string {
  const json = (value: unknown) => JSON.stringify(value).replaceAll("/", "\\/");
  const fields = [
    `"accountUserId":${BigInt(key.accountUserId)}`,
    `"dataCollectSwitch":${key.dataCollectSwitch}`,
    ...(typeof key.deviceName === "string" ? [`"deviceName":${json(key.deviceName)}`] : []),
    `"privateKeyDER":${json(key.privateKeyDER)}`,
    `"unit":${key.unit}`,
  ];
  return `{${fields.join(",")}}`;
}

// Sign-in

/** One server turning the sign-in down, before any key arrived. */
class Refused extends Error {
  constructor(readonly answer: Answer, message: string) { super(message); }
}

async function signInOnce(options: LoginOptions, account: string, hash: string, region: Region, takeOverSession: boolean): Promise<WatchAccountKey> {
  const body = JSON.stringify(loginPayload(account, hash, takeOverSession ? 0 : 1));
  let raw: string, object: Json;
  try {
    ({ raw, object } = await post(options, "user/login", body, region));
  } catch (error) {
    if (!(error instanceof CorosError)) throw error;
    throw new Refused({ kind: error.message === UNREACHABLE ? "noReply" : "unexpectedReply" }, error.message);
  }
  const result = resultCode(object);
  if (result === "1115") throw new SessionConflict();
  if (result !== "0000") {
    const message = typeof object.message === "string" ? object.message.trim() : null;
    const code = result || "unknown";
    const text = `${message ? message : "COROS refused the sign-in."} (COROS ${code})`;
    const notRegistered = !!message && /not registered/i.test(message);
    throw new Refused(notRegistered ? { kind: "notRegistered" } : { kind: "refused", code, message: message || null }, text);
  }
  if (!isObject(object.data)) throw keyError("no data", null);
  const userId = decimal("userId", raw);
  if (userId === null) throw keyError("no account ID", object.data);
  return decodeKey(object.data, userId);
}

async function post(options: LoginOptions, path: string, body: string, region: Region): Promise<{ raw: string; object: Json }> {
  const base = options.baseOverride ?? BASE_URLS[region];
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${base}/${path}`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        YFHeader: yfHeader(options.installId),
        "app-state": "foreground",
        "request-time": String(Date.now()),
      },
      // CorosKit refuses redirects; a 3xx then reads as an unexpected reply.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CorosError(UNREACHABLE);
  }
  let raw: string, object: unknown;
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    object = JSON.parse(raw);
  } catch {
    throw new CorosError(UNEXPECTED);
  }
  if (response.status < 200 || response.status >= 300 || !isObject(object)) throw new CorosError(UNEXPECTED);
  return { raw, object };
}

/** The Android client's identity header, with the user ID left at 0 before sign-in. */
export function yfHeader(installId: string, offsetSeconds: number = secondsFromGMT()): string {
  const digest = createHash("sha256").update(installId, "utf8").digest("hex");
  const quarterHours = Math.trunc(offsetSeconds / 900);
  return `{"appVersion":${APP_VERSION},"clientType":1,"language":"en-US","mobileName":"${installId}","releaseType":1,"systemDisplayId":"c${digest}","systemVersion":"16","timezone":${quarterHours},"userId":0,"userSettingScope":"${USER_SETTING_SCOPE}","versionCode":"${VERSION_CODE}"}`;
}

export function loginPayload(account: string, hash: string, checkStatus: number, locale?: string, timeZone?: string): Json {
  return {
    account: encryptField(account),
    accountType: 2,
    appKey: APP_KEY,
    checkStatus,
    clientType: 1,
    hasHrCalibrated: 0,
    kbValidity: 0,
    pwd: encryptField(hash.toLowerCase()),
    region: domainRegion(locale, timeZone),
    skipValidation: false,
  };
}

/** Android sends a serialized `DomainRegion`; COROS treats it as a hint. */
export function domainRegion(locale: string = Intl.DateTimeFormat().resolvedOptions().locale, timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const country = (localeRegion(locale) ?? "US").toUpperCase();
  let language = "en";
  try { language = new Intl.Locale(locale.replace(/_/g, "-")).language.toLowerCase(); } catch { /* keep en */ }
  const mcc: Record<string, string> = { AU: "505", CA: "302", CN: "460", DE: "262", ES: "214", FR: "208", GB: "234",
    IT: "222", JP: "440", KR: "450", NZ: "530", US: "310" };
  return `DomainRegion(simMcc=${mcc[country] ?? "310"},countryCode=${country},timeZoneId=${timeZone},language=${language},countryIso=${country.toLowerCase()})`;
}

function localeRegion(locale: string): string | undefined {
  try { return new Intl.Locale(locale.replace(/_/g, "-")).region; } catch { return undefined; }
}

/** COROS's result code: "result" or "apiCode" as text, or "result" as a number. */
export function resultCode(object: Json): string {
  if (typeof object.result === "string") return object.result;
  if (typeof object.apiCode === "string") return object.apiCode;
  if (typeof object.result === "number") return String(object.result);
  if (typeof object.result === "boolean") return object.result ? "1" : "0"; // NSNumber's stringValue
  return "";
}

/** A u64 field read from the raw JSON text, so it can't round through a double. Zero counts as missing. */
export function decimal(field: string, raw: string): bigint | null {
  const match = new RegExp(`"${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"?(\\d{1,20})`).exec(raw);
  if (!match) return null;
  const value = BigInt(match[1]);
  return value !== 0n && value <= 0xffff_ffff_ffff_ffffn ? value : null;
}

// Field cipher and key envelope

/** Each login field: XOR with the app key, then AES-128-CBC (PKCS#7) under the same key. TLS is what protects it. */
export function encryptField(value: string): string {
  const key = Buffer.from(APP_KEY);
  const bytes = Buffer.from(value, "utf8");
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return aes(true, bytes, key).toString("base64");
}

function aes(encrypt: boolean, input: Buffer, key: Buffer): Buffer {
  try {
    const cipher = encrypt ? createCipheriv("aes-128-cbc", key, IV) : createDecipheriv("aes-128-cbc", key, IV);
    return Buffer.concat([cipher.update(input), cipher.final()]);
  } catch {
    throw new CorosError(KEY_ERROR);
  }
}

/** Foundation's Data(base64Encoded:): strict, padded, no whitespace. */
function base64Strict(text: string): Buffer | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return Buffer.from(text, "base64");
}

/** `KEY_ERROR` plus which check failed and the shape of COROS's reply (names, types and lengths, never values). */
export function keyError(step: string, login: Json | null): CorosError {
  const graphemes = new Intl.Segmenter();
  const fields = Object.keys(login ?? {}).sort().map((name) => {
    const value = login?.[name];
    if (typeof value === "string") return `${name}[${[...graphemes.segment(value)].length}]`;
    if (typeof value === "boolean") return `${name}:bool`;
    if (typeof value === "number") return `${name}:num`;
    if (Array.isArray(value)) return `${name}:list`;
    if (isObject(value)) return `${name}{${Object.keys(value).sort().join(",")}}`;
    return `${name}:null`;
  });
  return new CorosError(`${KEY_ERROR}\n\nDetails: ${step}; ${fields.length ? fields.join(" ") : "no data"}`);
}

/** Swift's Character.isNewline, for the base64 key texts. */
const NEWLINES = /[\n\r\u000b\u000c\u0085\u2028\u2029]/g;

/** Reverses COROS's AES-CBC then repeating-XOR wrapping of the account key, and checks the key it holds. */
export function decodeKey(login: Json, userId: bigint): WatchAccountKey {
  const encKeyText = login.appEncKey;
  if (typeof encKeyText !== "string" || Buffer.byteLength(encKeyText, "utf8") !== 16) throw keyError("appEncKey", login);
  const encrypted = typeof login.userKey === "string" ? base64Strict(login.userKey.replace(/[\r\n]/g, "")) : null;
  if (!encrypted || encrypted.length === 0 || encrypted.length % 16 !== 0) throw keyError("userKey", login);
  const key = Buffer.from(encKeyText, "utf8");
  let clear: Buffer;
  try { clear = aes(false, encrypted, key); } catch { clear = Buffer.alloc(0); }
  try {
    if (clear.length === 0) throw keyError("decrypt", login);
    for (let i = 0; i < clear.length; i++) clear[i] ^= key[i % key.length];
    let text: string, info: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(clear);
      info = JSON.parse(text);
    } catch { throw keyError("key text", login); }
    if (!isObject(info)) throw keyError("key text", login);
    const keyUser = decimal("userId", text);
    if (keyUser === null || keyUser !== userId) {
      throw keyError(keyUser === null ? `key account missing (${Object.keys(info).sort().join(",")})` : "key account differs", login);
    }
    const sentPrivateDER = typeof info.privateKey === "string" ? base64Strict(info.privateKey.replace(NEWLINES, "")) : null;
    const publicSPKI = typeof info.publicKey === "string" ? base64Strict(info.publicKey.replace(NEWLINES, "")) : null;
    if (!sentPrivateDER || !publicSPKI) throw keyError(`key fields (${Object.keys(info).sort().join(",")})`, login);

    // COROS sends PKCS#8 (Java's encoding); the key is kept as PKCS#1, which the pairing code also carries.
    const privateDER = pkcs1PrivateKey(sentPrivateDER) ?? sentPrivateDER;
    let secKey: KeyObject;
    try { secKey = createPrivateKey({ key: privateDER, format: "der", type: "pkcs1" }); } catch {
      throw keyError(`private key unreadable (${sentPrivateDER.length} bytes)`, login);
    }
    const bits = secKey.asymmetricKeyDetails?.modulusLength ?? 0;
    if (secKey.asymmetricKeyType !== "rsa" || bits !== 2048) throw keyError(`private key size ${Math.ceil(bits / 8) * 8}`, login);
    // Compare the modulus itself: COROS's SPKI header need not be byte for byte what we would write.
    const modulus = rsaModulus(createPublicKey(secKey).export({ type: "pkcs1", format: "der" }));
    if (!modulus || modulus.length !== 256 || publicSPKI.indexOf(modulus) < 0) throw keyError(`public key mismatch (${publicSPKI.length} bytes)`, login);

    const unit = nsInt(login.unit);
    if (unit !== 0 && unit !== 1) throw keyError("unit", login);
    const profile = login.userProfile;
    const switches = isObject(profile) ? nsInt(profile.dataCollectSwitch) : null;
    if (switches === null || switches < 0 || switches > 0xffff_ffff) throw keyError("data settings", login);
    return { accountUserId: userId, unit, dataCollectSwitch: switches, privateKeyDER: privateDER.toString("base64") };
  } finally {
    clear.fill(0);
  }
}

/** A JSON number (or bool) read as NSNumber's intValue: truncated toward zero. */
function nsInt(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** The modulus of a PKCS#1 RSAPublicKey (SEQUENCE { INTEGER n, INTEGER e }), without leading zeros. */
export function rsaModulus(der: Uint8Array): Buffer | null {
  const reader = new DERReader(der);
  if (!reader.enter(0x30)) return null;
  const n = reader.read(0x02);
  if (!n) return null;
  let start = 0;
  while (start < n.length && n[start] === 0) start++;
  return start < n.length ? Buffer.from(n.subarray(start)) : null;
}

/** The RSAPrivateKey inside a PKCS#8 PrivateKeyInfo (SEQUENCE { INTEGER 0, SEQUENCE { rsaEncryption, NULL }, OCTET STRING }), or null. */
export function pkcs1PrivateKey(der: Uint8Array): Buffer | null {
  const rsaEncryption = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
  const reader = new DERReader(der);
  if (!reader.enter(0x30)) return null;
  const version = reader.read(0x02);
  if (!version || version.length !== 1 || version[0] !== 0) return null;
  const algorithm = reader.read(0x30);
  if (!algorithm) return null;
  const oid = new DERReader(algorithm).read(0x06);
  if (!oid || !rsaEncryption.equals(oid)) return null;
  const key = reader.read(0x04);
  return key ? Buffer.from(key) : null;
}

/** Just enough DER to walk the two RSA key structures above. */
class DERReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  /** Reads one element's header; returns its content length. */
  private header(tag: number): number | null {
    const bytes = this.bytes;
    if (this.offset + 2 > bytes.length || bytes[this.offset] !== tag) return null;
    const first = bytes[this.offset + 1];
    this.offset += 2;
    let length = first;
    if (first & 0x80) {
      const count = first & 0x7f;
      if (count < 1 || count > 4 || this.offset + count > bytes.length) return null;
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + bytes[this.offset + i];
      this.offset += count;
    }
    return this.offset + length <= bytes.length ? length : null;
  }

  /** Steps inside a constructed element. */
  enter(tag: number): boolean { return this.header(tag) !== null; }

  /** Returns an element's content and moves past it. */
  read(tag: number): Uint8Array | null {
    const length = this.header(tag);
    if (length === null) return null;
    const content = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return content;
  }
}
