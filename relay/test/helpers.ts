import { createExecutionContext, env as bindings, waitOnExecutionContext } from "cloudflare:test";
import {
  calculateJwkThumbprint,
  CompactSign,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
  type CryptoKey as JoseCryptoKey,
  type JWK,
} from "jose";
import { resetApnsCaches } from "../src/apns";
import { resetWebsiteJwksCache } from "../src/auth/userTokens";
import type { Deps, Env } from "../src/env";
import { handleRequest, runMaintenance } from "../src/index";
import {
  ENVIRONMENT_MINT_RESPONSE_TYP,
  ENVIRONMENT_SIGNATURE_HEADER,
  ENVIRONMENT_SIGNATURE_TYP,
  RELAY_MINT_REQUEST_TYP,
  sha256Base64Url,
  type EnvironmentOperation,
  type EnvironmentPublicJwk,
  type WebsiteClientId,
} from "../src/protocol";

export const RELAY_ORIGIN = "https://relay.test";
export const WEBSITE_ISSUER = "https://watchfaces.coroslink.com";
export const WEBSITE_JWKS_URL = "https://watchfaces.coroslink.com/.well-known/relay-jwks.json";
export const WEBSITE_AUDIENCE = "relay.coroslink.com";
export const ZONE_NAME = "tunnels.test";
export const ACCOUNT_ID = "acct123";
export const ZONE_ID = "zone456";
export const START = Date.UTC(2026, 9, 16, 12, 0, 0);

const encoder = new TextEncoder();

// --- keys ---------------------------------------------------------------------

export interface KeyPair {
  privateKey: JoseCryptoKey;
  publicJwk: JWK;
  pem: string;
}

export async function es256KeyPair(): Promise<KeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, publicJwk, pem: await exportPKCS8(privateKey) };
}

// --- clock ----------------------------------------------------------------------

export class Clock {
  now = START;
  advance(ms: number): void {
    this.now += ms;
  }
  get seconds(): number {
    return Math.floor(this.now / 1000);
  }
}

// --- fake Cloudflare API ---------------------------------------------------------

export interface FakeTunnel {
  id: string;
  name: string;
  created_at: string;
  deleted_at: string | null;
  status: "inactive" | "degraded" | "healthy" | "down";
  conns_inactive_at: string | null;
  config_src: "cloudflare";
  ingress?: Array<{ hostname?: string; service: string }>;
}

export interface FakeDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

interface Failure {
  method: string;
  path: RegExp;
  status: number;
  code?: number;
  message?: string;
  times: number;
}

function cfResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function cfOk(result: unknown, resultInfo?: unknown): Response {
  return cfResponse(200, { success: true, errors: [], messages: [], result, ...(resultInfo ? { result_info: resultInfo } : {}) });
}

function cfError(status: number, code: number, message: string): Response {
  return cfResponse(status, { success: false, errors: [{ code, message }], messages: [], result: null });
}

export class FakeCloudflare {
  tunnels = new Map<string, FakeTunnel>();
  dns = new Map<string, FakeDnsRecord>();
  private failures: Failure[] = [];
  private counter = 0;
  /** Runs before a matching request is handled; lets tests interleave concurrent work. */
  hooks: Array<{ method: string; path: RegExp; run: () => Promise<void> | void; once?: boolean }> = [];

  constructor(private readonly clock: Clock) {}

  private raw: Array<{ method: string; path: RegExp; status: number; body: string }> = [];

  /** Answers the next matching request with exactly this status and body. */
  rawNext(method: string, path: RegExp, status: number, body: string): void {
    this.raw.push({ method, path, status, body });
  }

  failNext(method: string, path: RegExp, status: number, options: { code?: number; message?: string; times?: number } = {}): void {
    this.failures.push({ method, path, status, times: options.times ?? 1, code: options.code, message: options.message });
  }

  liveTunnels(): FakeTunnel[] {
    return [...this.tunnels.values()].filter((tunnel) => !tunnel.deleted_at);
  }

  /** Adds a tunnel directly, as if created earlier. */
  seedTunnel(input: Partial<FakeTunnel> & { name: string }): FakeTunnel {
    const tunnel: FakeTunnel = {
      id: input.id ?? this.nextId("tun"),
      name: input.name,
      created_at: input.created_at ?? new Date(this.clock.now).toISOString(),
      deleted_at: input.deleted_at ?? null,
      status: input.status ?? "inactive",
      conns_inactive_at: input.conns_inactive_at ?? null,
      config_src: "cloudflare",
    };
    this.tunnels.set(tunnel.id, tunnel);
    return tunnel;
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(4, "0")}-0000-4000-8000-000000000000`;
  }

  async handle(request: Request): Promise<Response> {
    if (request.headers.get("authorization") !== "Bearer cf-test-token") {
      return cfError(403, 10000, "Authentication error");
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/client\/v4/u, "");
    for (const hook of [...this.hooks]) {
      if (hook.method === request.method && hook.path.test(path)) {
        if (hook.once) this.hooks.splice(this.hooks.indexOf(hook), 1);
        await hook.run();
      }
    }
    const raw = this.raw.find((entry) => entry.method === request.method && entry.path.test(path));
    if (raw) {
      this.raw.splice(this.raw.indexOf(raw), 1);
      return new Response(raw.body, { status: raw.status });
    }
    const failure = this.failures.find((entry) => entry.method === request.method && entry.path.test(path));
    if (failure) {
      failure.times -= 1;
      if (failure.times <= 0) this.failures.splice(this.failures.indexOf(failure), 1);
      return cfError(failure.status, failure.code ?? 1000, failure.message ?? `injected ${failure.status}`);
    }
    const body = request.method === "GET" || request.method === "DELETE" ? null : ((await request.json()) as Record<string, unknown>);
    const tunnelBase = `/accounts/${ACCOUNT_ID}/cfd_tunnel`;
    const dnsBase = `/zones/${ZONE_ID}/dns_records`;

    if (path === tunnelBase && request.method === "POST") {
      const name = String(body?.name);
      if (body?.config_src !== "cloudflare") return cfError(400, 1001, "config_src must be cloudflare");
      if (this.liveTunnels().some((tunnel) => tunnel.name === name)) {
        return cfError(409, 1013, "You already have a tunnel with this name.");
      }
      return cfOk(this.seedTunnel({ name }));
    }
    if (path === tunnelBase && request.method === "GET") {
      let rows = [...this.tunnels.values()];
      if (url.searchParams.get("is_deleted") === "false") rows = rows.filter((tunnel) => !tunnel.deleted_at);
      const name = url.searchParams.get("name");
      if (name) rows = rows.filter((tunnel) => tunnel.name === name);
      const prefix = url.searchParams.get("include_prefix");
      if (prefix) rows = rows.filter((tunnel) => tunnel.name.startsWith(prefix));
      const status = url.searchParams.get("status");
      if (status) rows = rows.filter((tunnel) => tunnel.status === status);
      const existedAt = url.searchParams.get("existed_at");
      if (existedAt) rows = rows.filter((tunnel) => Date.parse(tunnel.created_at) <= Date.parse(existedAt));
      const perPage = Number(url.searchParams.get("per_page") ?? "20");
      const page = Number(url.searchParams.get("page") ?? "1");
      const slice = rows.slice((page - 1) * perPage, page * perPage);
      return cfOk(slice, { page, per_page: perPage, count: slice.length, total_count: rows.length });
    }
    const tunnelMatch = new RegExp(`^${tunnelBase}/([^/]+)(/configurations|/token|/connections)?$`, "u").exec(path);
    if (tunnelMatch) {
      const tunnel = this.tunnels.get(tunnelMatch[1]!);
      if (!tunnel) return cfError(404, 1003, "Tunnel not found");
      const suffix = tunnelMatch[2];
      if (!suffix && request.method === "GET") return cfOk(tunnel);
      if (!suffix && request.method === "DELETE") {
        if (tunnel.deleted_at) return cfError(404, 1003, "Tunnel not found");
        if (tunnel.status === "healthy" || tunnel.status === "degraded") {
          return cfError(400, 1022, "Cannot delete tunnel because it has active connections");
        }
        tunnel.deleted_at = new Date(this.clock.now).toISOString();
        return cfOk(tunnel);
      }
      if (tunnel.deleted_at) return cfError(404, 1003, "Tunnel not found");
      if (suffix === "/configurations" && request.method === "PUT") {
        tunnel.ingress = (body?.config as { ingress: FakeTunnel["ingress"] }).ingress;
        return cfOk({ tunnel_id: tunnel.id, version: 1, config: body?.config });
      }
      if (suffix === "/token" && request.method === "GET") return cfOk(`connector-token-${tunnel.id}`);
      if (suffix === "/connections" && request.method === "DELETE") {
        if (tunnel.status === "healthy" || tunnel.status === "degraded") {
          tunnel.status = "down";
          tunnel.conns_inactive_at = new Date(this.clock.now).toISOString();
        }
        return cfOk(null);
      }
    }
    if (path === dnsBase && request.method === "GET") {
      const rows = [...this.dns.values()].filter(
        (record) => record.name === url.searchParams.get("name") && record.type === (url.searchParams.get("type") ?? record.type),
      );
      return cfOk(rows);
    }
    if (path === dnsBase && request.method === "POST") {
      const name = String(body?.name);
      if ([...this.dns.values()].some((record) => record.name === name)) {
        return cfError(400, 81053, "An A, AAAA, or CNAME record with that host already exists.");
      }
      const record: FakeDnsRecord = {
        id: this.nextId("dns"),
        type: String(body?.type),
        name,
        content: String(body?.content),
        proxied: body?.proxied === true,
      };
      this.dns.set(record.id, record);
      return cfOk(record);
    }
    const dnsMatch = new RegExp(`^${dnsBase}/([^/]+)$`, "u").exec(path);
    if (dnsMatch) {
      const record = this.dns.get(dnsMatch[1]!);
      if (!record) return cfError(404, 81044, "Record does not exist.");
      if (request.method === "PUT") {
        Object.assign(record, { type: String(body?.type), name: String(body?.name), content: String(body?.content), proxied: body?.proxied === true });
        return cfOk(record);
      }
      if (request.method === "DELETE") {
        this.dns.delete(record.id);
        return cfOk({ id: record.id });
      }
    }
    return cfError(404, 7003, `No route for ${request.method} ${path}`);
  }
}

// --- fake APNs --------------------------------------------------------------------

export class FakeApns {
  sent: Array<{ host: string; token: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  responses = new Map<string, { status: number; reason?: string }[]>();

  constructor(private readonly publicJwk: JWK) {}

  respond(token: string, ...responses: { status: number; reason?: string }[]): void {
    this.responses.set(token, responses);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.pathname.replace("/3/device/", "");
    const headers = Object.fromEntries(request.headers.entries());
    const body = (await request.json()) as Record<string, unknown>;
    this.sent.push({ host: url.host, token, headers, body });
    // Check the provider token is a valid ES256 JWT from our key.
    const bearer = headers.authorization?.replace(/^bearer /u, "") ?? "";
    try {
      await jwtVerify(bearer, await importJWK(this.publicJwk, "ES256"));
    } catch {
      return new Response(JSON.stringify({ reason: "InvalidProviderToken" }), { status: 403 });
    }
    const queue = this.responses.get(token);
    const next = queue?.shift();
    if (next && next.status !== 200) {
      return new Response(JSON.stringify({ reason: next.reason }), { status: next.status });
    }
    return new Response(null, { status: 200, headers: { "apns-id": crypto.randomUUID() } });
  }
}

// --- environment (desktop) identity -------------------------------------------------

export interface EnvironmentIdentity {
  environmentId: string;
  keys: KeyPair;
  publicJwk: EnvironmentPublicJwk;
  kid: string;
}

let environmentCounter = 0;

export async function createEnvironment(environmentId?: string): Promise<EnvironmentIdentity> {
  environmentCounter += 1;
  const keys = await es256KeyPair();
  const publicJwk: EnvironmentPublicJwk = { kty: "EC", crv: "P-256", x: keys.publicJwk.x!, y: keys.publicJwk.y! };
  return {
    environmentId: environmentId ?? `env_${String(environmentCounter).padStart(4, "0")}_desktop`,
    keys,
    publicJwk,
    kid: await calculateJwkThumbprint(publicJwk, "sha256"),
  };
}

export async function signEnvironmentRequest(
  identity: EnvironmentIdentity,
  op: EnvironmentOperation,
  body: string,
  options: { iat?: number; nonce?: string; aud?: string; environmentId?: string; kid?: string; signer?: KeyPair } = {},
  clock?: Clock,
): Promise<string> {
  const payload = {
    aud: options.aud ?? RELAY_ORIGIN,
    environmentId: options.environmentId ?? identity.environmentId,
    op,
    nonce: options.nonce ?? crypto.randomUUID().replaceAll("-", "") + "abcdefgh",
    iat: options.iat ?? Math.floor((clock?.now ?? START) / 1000),
    bodySha256: await sha256Base64Url(body),
  };
  return new CompactSign(encoder.encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "ES256", typ: ENVIRONMENT_SIGNATURE_TYP, kid: options.kid ?? identity.kid })
    .sign((options.signer ?? identity.keys).privateKey);
}

// --- DPoP ---------------------------------------------------------------------------

export async function dpopProof(
  key: KeyPair,
  input: { htm: string; htu: string; accessToken: string; iat: number; jti?: string; ath?: string },
): Promise<string> {
  return new SignJWT({
    htm: input.htm,
    htu: input.htu,
    jti: input.jti ?? crypto.randomUUID(),
    iat: input.iat,
    ath: input.ath ?? (await sha256Base64Url(input.accessToken)),
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: { kty: "EC", crv: "P-256", x: key.publicJwk.x!, y: key.publicJwk.y! } })
    .sign(key.privateKey);
}

export async function thumbprint(key: KeyPair): Promise<string> {
  return calculateJwkThumbprint({ kty: "EC", crv: "P-256", x: key.publicJwk.x!, y: key.publicJwk.y! }, "sha256");
}

// --- fake desktop mint endpoint --------------------------------------------------------

export type DesktopMint = (request: Request) => Promise<Response>;

/** An honest desktop: verifies the relay's request, mints and signs a credential. */
export function honestDesktop(
  identity: EnvironmentIdentity,
  relayPublicJwk: JWK,
  clock: Clock,
  options: {
    tamper?: (response: { credential: string; expiresAt: string; proof: Record<string, unknown> }) => void;
    signer?: KeyPair;
    seen?: string[];
  } = {},
): DesktopMint {
  return async (request) => {
    const { request: jwt } = (await request.json()) as { request: string };
    const { payload, protectedHeader } = await jwtVerify(jwt, await importJWK(relayPublicJwk, "ES256"), {
      issuer: RELAY_ORIGIN,
      audience: `coroslink-env:${identity.environmentId}`,
      typ: RELAY_MINT_REQUEST_TYP,
      currentDate: new Date(clock.now),
    });
    if (!protectedHeader.kid) throw new Error("missing kid");
    options.seen?.push(String(payload.nonce));
    const credential = `cred-${crypto.randomUUID()}`;
    const expiresAt = new Date(clock.now + 5 * 60 * 1000).toISOString();
    const proof: Record<string, unknown> = {
      environmentId: payload.environmentId,
      nonce: payload.nonce,
      jkt: payload.jkt,
      credentialSha256: await sha256Base64Url(credential),
      exp: Math.floor(Date.parse(expiresAt) / 1000),
      iat: clock.seconds,
    };
    const response = { credential, expiresAt, proof };
    options.tamper?.(response);
    const signed = await new CompactSign(encoder.encode(JSON.stringify(response.proof)))
      .setProtectedHeader({ alg: "ES256", typ: ENVIRONMENT_MINT_RESPONSE_TYP, kid: identity.kid })
      .sign((options.signer ?? identity.keys).privateKey);
    return new Response(JSON.stringify({ credential: response.credential, expiresAt: response.expiresAt, proof: signed }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

// --- the harness ---------------------------------------------------------------------

export interface FetchCall {
  method: string;
  url: string;
  redirect: RequestInit["redirect"];
}

export class Harness {
  clock = new Clock();
  cloudflare = new FakeCloudflare(this.clock);
  apns!: FakeApns;
  website!: KeyPair & { kid: string };
  relayKey!: KeyPair;
  apnsKey!: KeyPair;
  calls: FetchCall[] = [];
  /** Desktop mint handlers by hostname. */
  desktops = new Map<string, DesktopMint>();
  jwksFetches = 0;
  jwksFailing = false;
  extraWebsiteKeys: Array<JWK & { kid: string }> = [];
  env!: Env;

  static async create(overrides: Partial<Env> = {}): Promise<Harness> {
    const harness = new Harness();
    resetWebsiteJwksCache();
    resetApnsCaches();
    harness.website = { ...(await es256KeyPair()), kid: "website-key-1" };
    harness.relayKey = await es256KeyPair();
    harness.apnsKey = await es256KeyPair();
    harness.apns = new FakeApns(harness.apnsKey.publicJwk);
    harness.env = {
      ...(bindings as unknown as Env),
      RELAY_STAGE: "production",
      RELAY_ORIGIN,
      WEBSITE_ISSUER,
      WEBSITE_JWKS_URL,
      WEBSITE_JWT_AUDIENCE: WEBSITE_AUDIENCE,
      CF_ACCOUNT_ID: ACCOUNT_ID,
      TUNNEL_ZONE_ID: ZONE_ID,
      TUNNEL_ZONE_NAME: ZONE_NAME,
      CF_API_TOKEN: "cf-test-token",
      RELAY_SIGNING_KEY: harness.relayKey.pem,
      RELAY_SIGNING_KEY_ID: "relay-test-1",
      APNS_KEY_ID: "APNSKEY123",
      APNS_TEAM_ID: "TEAM123456",
      APNS_BUNDLE_ID: "com.akerrules.clink",
      APNS_PRIVATE_KEY: harness.apnsKey.pem,
      RELAY_TUNNEL_CLEANUP_MODE: "off",
      ...overrides,
    };
    await resetDatabase(harness.env.DB);
    return harness;
  }

  deps: Deps = {
    now: () => this.clock.now,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      this.calls.push({ method: request.method, url: request.url, redirect: init?.redirect });
      const url = new URL(request.url);
      if (url.host === "api.cloudflare.com") return this.cloudflare.handle(request);
      if (url.href === WEBSITE_JWKS_URL) {
        this.jwksFetches += 1;
        if (this.jwksFailing) return new Response("unavailable", { status: 503 });
        return new Response(
          JSON.stringify({
            keys: [{ ...this.website.publicJwk, kid: this.website.kid, alg: "ES256", use: "sig" }, ...this.extraWebsiteKeys],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.host === "api.push.apple.com" || url.host === "api.sandbox.push.apple.com") return this.apns.handle(request);
      const desktop = this.desktops.get(url.host);
      if (desktop) return desktop(request);
      throw new TypeError(`fetch failed: no route to ${url.host}`);
    },
  };

  cloudflareCalls(): FetchCall[] {
    return this.calls.filter((call) => call.url.startsWith("https://api.cloudflare.com/"));
  }

  callsTo(method: string, pathPattern: RegExp): FetchCall[] {
    return this.cloudflareCalls().filter(
      (call) => call.method === method && pathPattern.test(new URL(call.url).pathname.replace("/client/v4", "")),
    );
  }

  async userToken(
    input: {
      sub?: string;
      clientId?: WebsiteClientId | string;
      aud?: string;
      iss?: string;
      iat?: number;
      exp?: number;
      kid?: string;
      signer?: KeyPair;
    } = {},
  ): Promise<string> {
    const iat = input.iat ?? this.clock.seconds;
    return new SignJWT({ client_id: input.clientId ?? "coroslink-desktop", sid: "clk_session_1" })
      .setProtectedHeader({ alg: "ES256", kid: input.kid ?? this.website.kid })
      .setIssuer(input.iss ?? WEBSITE_ISSUER)
      .setAudience(input.aud ?? WEBSITE_AUDIENCE)
      .setSubject(input.sub ?? "user_1")
      .setIssuedAt(iat)
      .setExpirationTime(input.exp ?? iat + 600)
      .setJti(crypto.randomUUID())
      .sign((input.signer ?? this.website).privateKey);
  }

  async fetch(request: Request): Promise<Response> {
    const ctx = createExecutionContext();
    const response = await handleRequest(request, this.env, ctx, this.deps);
    await waitOnExecutionContext(ctx);
    return response;
  }

  maintenance() {
    return runMaintenance(this.env, this.deps);
  }

  /** An environment-signed POST. */
  async signedPost(
    identity: EnvironmentIdentity,
    path: string,
    op: EnvironmentOperation,
    body: Record<string, unknown>,
    options: { userToken?: string; signatureOptions?: Parameters<typeof signEnvironmentRequest>[3] } = {},
  ): Promise<Response> {
    const text = JSON.stringify(body);
    const signature = await signEnvironmentRequest(identity, op, text, options.signatureOptions, this.clock);
    return this.fetch(
      new Request(`${RELAY_ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ENVIRONMENT_SIGNATURE_HEADER]: signature,
          ...(options.userToken ? { authorization: `Bearer ${options.userToken}` } : {}),
        },
        body: text,
      }),
    );
  }

  async link(
    identity: EnvironmentIdentity,
    options: { userId?: string; port?: number; label?: string } = {},
  ): Promise<Response> {
    return this.signedPost(
      identity,
      "/v1/environments/link",
      "environment.link",
      {
        environmentId: identity.environmentId,
        publicJwk: identity.publicJwk,
        label: options.label ?? "Aker's MacBook",
        platform: "darwin",
        port: options.port ?? 47_831,
      },
      { userToken: await this.userToken({ sub: options.userId ?? "user_1", clientId: "coroslink-desktop" }) },
    );
  }

  async recovery(identity: EnvironmentIdentity, body: { tunnelId: string | null; port: number }): Promise<Response> {
    return this.signedPost(identity, "/v1/environments/recovery", "environment.recovery", {
      environmentId: identity.environmentId,
      ...body,
    });
  }

  async getJson<T = Record<string, unknown>>(path: string, token: string): Promise<{ status: number; body: T }> {
    const response = await this.fetch(new Request(`${RELAY_ORIGIN}${path}`, { headers: { authorization: `Bearer ${token}` } }));
    return { status: response.status, body: (await response.json()) as T };
  }

  async allocation(userId: string, environmentId: string) {
    return this.env.DB.prepare("SELECT * FROM allocations WHERE user_id = ? AND environment_id = ?")
      .bind(userId, environmentId)
      .first<import("../src/db").AllocationRow>();
  }

  async linkRow(userId: string, environmentId: string) {
    return this.env.DB.prepare("SELECT * FROM environment_links WHERE user_id = ? AND environment_id = ?")
      .bind(userId, environmentId)
      .first<import("../src/db").LinkRow>();
  }
}

export async function resetDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM allocations"),
    db.prepare("DELETE FROM environment_links"),
    db.prepare("DELETE FROM push_devices"),
    db.prepare("DELETE FROM live_activities"),
    db.prepare("DELETE FROM live_turn_ends"),
    db.prepare("DELETE FROM nonces"),
    db.prepare("DELETE FROM tunnel_status_cache"),
    db.prepare("DELETE FROM apns_provider_tokens"),
  ]);
}

export async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? `<no error: ${response.status}>`;
}
