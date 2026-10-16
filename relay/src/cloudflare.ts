import type { Deps, TunnelConfig } from "./env";

const API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 10_000;

export interface CloudflareTunnel {
  id: string;
  name: string;
  created_at?: string;
  deleted_at?: string | null;
  status?: "inactive" | "degraded" | "healthy" | "down";
  conns_active_at?: string | null;
  conns_inactive_at?: string | null;
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

export interface TunnelListQuery {
  name?: string;
  includePrefix?: string;
  status?: "inactive" | "down";
  existedAt?: string;
  wasInactiveAt?: string;
  page?: number;
  perPage?: number;
}

export interface ResultInfo {
  page?: number;
  per_page?: number;
  count?: number;
  total_count?: number;
}

export class CloudflareApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly errors: ReadonlyArray<{ code?: number; message?: string }>,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Cloudflare ${operation} failed with ${status}${errors[0]?.message ? `: ${errors[0].message}` : ""}`);
    this.name = "CloudflareApiError";
  }

  get notFound(): boolean {
    return this.status === 404;
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof CloudflareApiError && error.notFound;
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof CloudflareApiError && error.rateLimited;
}

interface Envelope<T> {
  success?: boolean;
  result?: T;
  result_info?: ResultInfo;
  errors?: Array<{ code?: number; message?: string }>;
}

/** The handful of Tunnel and DNS endpoints the relay uses. */
export class CloudflareClient {
  constructor(
    private readonly config: TunnelConfig,
    private readonly deps: Deps,
  ) {}

  private async call<T>(
    operation: string,
    method: string,
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<{ result: T; resultInfo?: ResultInfo }> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let response: Response;
    try {
      response = await this.deps.fetch(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiToken}`,
          accept: "application/json",
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CloudflareApiError(operation, 0, [
        { message: error instanceof Error ? error.name : "network error" },
      ]);
    }
    let envelope: Envelope<T> = {};
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      // Non-JSON error pages fall through to the status check.
    }
    if (!response.ok || envelope.success === false) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new CloudflareApiError(
        operation,
        response.status === 200 ? 500 : response.status,
        envelope.errors ?? [],
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return {
      result: envelope.result as T,
      ...(envelope.result_info ? { resultInfo: envelope.result_info } : {}),
    };
  }

  private tunnelPath(suffix = ""): string {
    return `/accounts/${this.config.accountId}/cfd_tunnel${suffix}`;
  }

  private dnsPath(suffix = ""): string {
    return `/zones/${this.config.zoneId}/dns_records${suffix}`;
  }

  async createTunnel(name: string): Promise<CloudflareTunnel> {
    return (
      await this.call<CloudflareTunnel>("create-tunnel", "POST", this.tunnelPath(), {
        body: { name, config_src: "cloudflare" },
      })
    ).result;
  }

  async getTunnel(tunnelId: string): Promise<CloudflareTunnel> {
    return (await this.call<CloudflareTunnel>("get-tunnel", "GET", this.tunnelPath(`/${tunnelId}`))).result;
  }

  async listTunnels(query: TunnelListQuery): Promise<{ result: CloudflareTunnel[]; resultInfo?: ResultInfo }> {
    const response = await this.call<CloudflareTunnel[]>("list-tunnels", "GET", this.tunnelPath(), {
      query: {
        is_deleted: false,
        name: query.name,
        include_prefix: query.includePrefix,
        status: query.status,
        existed_at: query.existedAt,
        was_inactive_at: query.wasInactiveAt,
        page: query.page,
        per_page: query.perPage,
      },
    });
    return { result: Array.isArray(response.result) ? response.result : [], ...(response.resultInfo ? { resultInfo: response.resultInfo } : {}) };
  }

  async putTunnelConfiguration(tunnelId: string, hostname: string, port: number): Promise<void> {
    await this.call("put-tunnel-configuration", "PUT", this.tunnelPath(`/${tunnelId}/configurations`), {
      body: {
        config: {
          ingress: [{ hostname, service: `http://localhost:${port}` }, { service: "http_status:404" }],
        },
      },
    });
  }

  async getTunnelToken(tunnelId: string): Promise<string> {
    const token = (await this.call<string>("get-tunnel-token", "GET", this.tunnelPath(`/${tunnelId}/token`))).result;
    if (typeof token !== "string" || token.length === 0) {
      throw new CloudflareApiError("get-tunnel-token", 502, [{ message: "empty token" }]);
    }
    return token;
  }

  async deleteTunnelConnections(tunnelId: string): Promise<void> {
    await this.call("delete-tunnel-connections", "DELETE", this.tunnelPath(`/${tunnelId}/connections`));
  }

  async deleteTunnel(tunnelId: string): Promise<void> {
    await this.call("delete-tunnel", "DELETE", this.tunnelPath(`/${tunnelId}`));
  }

  async listCnameRecords(hostname: string): Promise<CloudflareDnsRecord[]> {
    const response = await this.call<CloudflareDnsRecord[]>("list-dns-records", "GET", this.dnsPath(), {
      query: { type: "CNAME", name: hostname },
    });
    // Never act on a record that is not exactly this name, whatever the filter semantics.
    return (Array.isArray(response.result) ? response.result : []).filter(
      (record) => record.name?.toLowerCase() === hostname.toLowerCase(),
    );
  }

  private cname(hostname: string, tunnelId: string) {
    return {
      type: "CNAME",
      name: hostname,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
      comment: "CorosLink relay tunnel",
    };
  }

  async createCnameRecord(hostname: string, tunnelId: string): Promise<CloudflareDnsRecord> {
    return (
      await this.call<CloudflareDnsRecord>("create-dns-record", "POST", this.dnsPath(), {
        body: this.cname(hostname, tunnelId),
      })
    ).result;
  }

  async updateCnameRecord(recordId: string, hostname: string, tunnelId: string): Promise<CloudflareDnsRecord> {
    return (
      await this.call<CloudflareDnsRecord>("update-dns-record", "PUT", this.dnsPath(`/${recordId}`), {
        body: this.cname(hostname, tunnelId),
      })
    ).result;
  }

  async deleteDnsRecord(recordId: string): Promise<void> {
    await this.call("delete-dns-record", "DELETE", this.dnsPath(`/${recordId}`));
  }
}
