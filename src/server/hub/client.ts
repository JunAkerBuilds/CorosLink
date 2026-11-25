// COROS Training Hub, the web API behind training.coros.com. Ported from CorosKit's TrainingHub.swift.
// Requests go only to COROS's four Training Hub hosts, over https, and never follow a redirect.
import { bcryptHash, bcryptSalt } from "./bcrypt";
import { HubExpired, HubInvalid, HubProblem, HubRefused } from "./errors";
import { at, text, type Json, type JsonObject } from "./json";

/** A Training Hub sign-in. The token is a bearer credential: it lives only in the sealed session cookie. */
export interface HubSession {
  accessToken: string;
  userId: string;
  regionId: string;
  /** One of `HUB_REGIONS`. */
  baseURL: string;
}

/** COROS asked for the 6-digit code it emailed before it hands out a session. */
export interface HubChallenge {
  /** The address COROS sent the code to, as COROS spells it. */
  account: string;
  baseURL: string;
  loginTicket: string;
  appKey: string;
  accountType: string;
  regionId: string;
  userId?: string;
}

export type HubSignIn = { kind: "signedIn"; session: HubSession } | { kind: "needsCode"; challenge: HubChallenge };

const GLOBAL = "https://teamapi.coros.com";
export const HUB_REGIONS: readonly string[] = [GLOBAL, "https://teameuapi.coros.com", "https://teamcnapi.coros.com", "https://teamsgapi.coros.com"];
export const HUB_HOSTS: ReadonlySet<string> = new Set(HUB_REGIONS.map((region) => new URL(region).host));

/** COROS's region IDs, as training.coros.com maps them. */
export function regionBaseURL(region: string): string | null {
  switch (region) {
    case "0": case "1": case "us": case "global": return GLOBAL;
    case "2": case "cn": return "https://teamcnapi.coros.com";
    case "3": case "eu": return "https://teameuapi.coros.com";
    case "4": case "sg": return "https://teamsgapi.coros.com";
    default: return null;
  }
}

/** The region a session's server is in, in words. */
export function regionName(baseURL: string): string {
  switch (baseURL) {
    case "https://teameuapi.coros.com": return "Europe";
    case "https://teamcnapi.coros.com": return "Mainland China";
    case "https://teamsgapi.coros.com": return "Singapore";
    default: return "Global";
  }
}

/** Result codes training.coros.com signs out on. */
const SESSION_CODES = new Set(["0101", "0102", "1006", "1019", "ACCESS_TOKEN_IS_INVALID"]);
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 16 << 20;

/** Throws unless `url` is https on one of COROS's Training Hub hosts, default port, no credentials. */
export function assertHubURL(url: URL): void {
  if (url.protocol !== "https:" || !HUB_HOSTS.has(url.host) || url.port !== "" || url.username !== "" || url.password !== "") {
    throw new HubProblem("C-LINK only talks to COROS's own servers for your training.", "blocked");
  }
}

/** The `data` of a COROS answer, or why COROS refused. `signedIn` requests can find the session ended. */
export function dataOf(payload: Json, signedIn: boolean): Json | undefined {
  const result = text(at(payload, "result")) ?? text(at(payload, "apiCode")) ?? "";
  const raw = at(payload, "message");
  const message = typeof raw === "string" && raw !== "" ? raw : undefined;
  if (signedIn && (SESSION_CODES.has(result) || (message !== undefined && message.toLowerCase().includes("token") && result !== "0000"))) {
    throw new HubExpired();
  }
  if (result !== "0000") {
    const code = result === "" ? "unknown" : result;
    throw new HubRefused(code, message ?? `COROS refused the request (${code}).`);
  }
  const data = at(payload, "data");
  return data === null ? undefined : data;
}

type Fetch = typeof fetch;

export class TrainingHub {
  /** `fetchImpl` is for tests; the real one is Node's. */
  constructor(private readonly fetchImpl: Fetch = (...args) => fetch(...args)) {}

  // MARK: Sign-in

  /**
   * Tries each region until one knows the account. `passwordHash` is the password's MD5 in hex, worked out in
   * the browser; COROS's web sign-in takes bcrypt(md5) and its salt. When COROS wants an emailed code, it is
   * sent and the challenge comes back. Nothing here is kept: not the hash, not the bcrypt.
   */
  async signIn(account: string, passwordHash: string): Promise<HubSignIn> {
    let refusal: HubRefused | undefined;
    let lastError: unknown;
    for (const base of HUB_REGIONS) {
      const salt = bcryptSalt(10);
      const secret = bcryptHash(passwordHash, salt);
      if (!secret) throw new HubProblem("C-LINK couldn't prepare the sign-in.");
      const body = { account, accountType: 2, p1: secret, p2: salt, rmbm: 1 };
      try {
        const data = await this.exchange(new URL(base + "/account/login"), "POST", body, null, null, false);
        if (data === undefined) throw new HubProblem("COROS's sign-in answer was incomplete.");
        return await this.finish(account, data, base);
      } catch (error) {
        if (error instanceof HubRefused) {
          // A later region's "not registered" mustn't hide the useful answer from the right one.
          if (!refusal || refusal.code === "1031") refusal = error;
        } else {
          lastError = error;
        }
      }
    }
    if (refusal) throw refusal;
    throw lastError ?? new HubProblem("COROS sign-in failed. Check your email and password, then try again.");
  }

  private async finish(account: string, data: Json, base: string): Promise<HubSignIn> {
    const region = text(at(data, "regionId")) ?? "1";
    const accountBase = regionBaseURL(region) ?? base;
    const token = text(at(data, "accessToken"));
    if (token) return { kind: "signedIn", session: await this.session(token, text(at(data, "userId")), region, accountBase) };
    const ticket = text(at(data, "loginTicket")), appKey = text(at(data, "appKey"));
    if (!ticket || !appKey) throw new HubProblem("COROS's sign-in answer was incomplete.");
    const userId = text(at(data, "userId"));
    const challenge: HubChallenge = {
      account: text(at(data, "account")) || account, baseURL: accountBase, loginTicket: ticket, appKey,
      accountType: text(at(data, "accountType2fa")) || "2", regionId: region, ...(userId !== undefined ? { userId } : {}),
    };
    await this.sendCode(challenge);
    return { kind: "needsCode", challenge };
  }

  /** Asks COROS to email the 6-digit code (again). */
  async sendCode(challenge: HubChallenge): Promise<void> {
    const body = { account: challenge.account, codeType: 20, lengthType: 2, accountType: challenge.accountType };
    await this.exchange(new URL(challenge.baseURL + "/account/captcha"), "POST", body, null, null, false);
  }

  async verify(code: string, challenge: HubChallenge): Promise<HubSession> {
    const trimmed = code.trim();
    if (!/^[0-9]{6}$/.test(trimmed)) throw new HubInvalid("Enter the 6-digit code COROS emailed you.");
    const body = { loginTicket: challenge.loginTicket, appKey: challenge.appKey, code: trimmed };
    const data = await this.exchange(new URL(challenge.baseURL + "/account/2fa/login/verify"), "POST", body, null, null, true);
    const token = text(at(data, "accessToken"));
    if (!token) throw new HubProblem("COROS didn't send a session for that code.");
    return this.session(token, text(at(data, "userId")) ?? challenge.userId, text(at(data, "regionId")) ?? challenge.regionId, challenge.baseURL);
  }

  /** The session, on the region that answers for this token, with the account's own user ID. */
  private async session(token: string, userId: string | undefined, region: string, base: string): Promise<HubSession> {
    let resolved = base;
    let account: Json | undefined;
    for (const candidate of [base, ...HUB_REGIONS.filter((other) => other !== base)]) {
      try {
        const answer = await this.exchange(new URL(candidate + "/account/query"), "GET", null, token, null, false);
        if (answer !== undefined) { resolved = candidate; account = answer; break; }
      } catch {
        // Another region may be the one that knows this token.
      }
    }
    const id = text(at(account, "userId")) ?? userId ?? "";
    if (id === "") throw new HubProblem("COROS's sign-in answer didn't name your account.");
    return { accessToken: token, userId: id, regionId: region, baseURL: resolved };
  }

  /** Asks COROS whether it still takes the session's token. Throws `HubExpired` when it doesn't. */
  async check(session: HubSession): Promise<void> {
    await this.get("account/query", {}, session);
  }

  // MARK: Requests

  /** `data` of a GET on the session's region. */
  get(path: string, query: Record<string, string>, session: HubSession): Promise<Json | undefined> {
    const url = new URL(session.baseURL + "/" + path);
    for (const key of Object.keys(query).sort()) url.searchParams.append(key, query[key]);
    return this.exchange(url, "GET", null, session.accessToken, session.userId, false);
  }

  /** `data` of a POST on the session's region; undefined when COROS sends none (most writes). */
  post(path: string, body: JsonObject, session: HubSession): Promise<Json | undefined> {
    return this.exchange(new URL(session.baseURL + "/" + path), "POST", body, session.accessToken, session.userId, false);
  }

  private async exchange(url: URL, method: "GET" | "POST", body: JsonObject | null, token: string | null, userId: string | null, noWarning: boolean):
    Promise<Json | undefined> {
    assertHubURL(url);
    const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };
    if (body !== null) headers["Content-Type"] = "application/json";
    if (token !== null) {
      headers.accesstoken = token;
      if (userId !== null) headers.yfheader = JSON.stringify({ userId });
    } else {
      headers.YFHeader = '{"language":"en-US"}';
    }
    if (noWarning) headers["X-No-Warnning"] = "1";

    let response: Response;
    let bytes: ArrayBuffer;
    try {
      response = await this.fetchImpl(url, {
        method, headers, body: body === null ? undefined : JSON.stringify(body),
        redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new HubProblem("COROS sent an unexpected response.");
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (error instanceof HubProblem) throw error;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new HubProblem("COROS didn't answer within 30 seconds. Check your connection and try again.", "unreachable");
      }
      throw new HubProblem("COROS couldn't be reached. Check your connection and try again.", "unreachable");
    }
    if (bytes.byteLength > MAX_BYTES) throw new HubProblem("COROS sent an unexpected response.");
    // A redirect is never followed: with `redirect: "manual"` it arrives as its own 3xx answer and stops here.
    if (response.status < 200 || response.status >= 300) {
      throw new HubProblem(`COROS couldn't answer right now (HTTP ${response.status}). Try again later.`);
    }
    let payload: Json;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes)) as Json;
    } catch {
      throw new HubProblem("COROS sent an unexpected answer.");
    }
    return dataOf(payload, token !== null);
  }
}
