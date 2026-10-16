/** Bindings, vars and secrets. README.md documents each one. */
export interface Env {
  DB: D1Database;

  RELAY_STAGE: string;
  RELAY_ORIGIN: string;

  WEBSITE_ISSUER: string;
  WEBSITE_JWKS_URL: string;
  WEBSITE_JWT_AUDIENCE: string;

  CF_ACCOUNT_ID: string;
  TUNNEL_ZONE_ID: string;
  TUNNEL_ZONE_NAME: string;
  CF_API_TOKEN?: string;

  RELAY_SIGNING_KEY?: string;
  RELAY_SIGNING_KEY_ID: string;
  /** Optional JSON array of extra public JWKs to publish (key rotation). */
  RELAY_EXTRA_JWKS?: string;

  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  APNS_PRIVATE_KEY?: string;

  RELAY_TUNNEL_CLEANUP_MODE: string;
}

export type CleanupMode = "off" | "dry-run" | "enabled";

/** Injected so tests control the clock and the network. */
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}

export function defaultDeps(): Deps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  };
}

export interface TunnelConfig {
  accountId: string;
  zoneId: string;
  zoneName: string;
  apiToken: string;
}

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKey: string;
}

export interface RelayConfig {
  stage: string;
  origin: string;
  websiteIssuer: string;
  websiteJwksUrl: string;
  websiteAudience: string;
  tunnel: TunnelConfig | null;
  signingKey: { pem: string; kid: string } | null;
  extraJwks: string | undefined;
  apns: ApnsConfig | null;
  cleanupMode: CleanupMode;
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function cleanupModeFrom(value: string | undefined): CleanupMode {
  return value === "dry-run" || value === "enabled" ? value : "off";
}

export function loadConfig(env: Env): RelayConfig {
  const zoneName = (env.TUNNEL_ZONE_NAME ?? "").trim().toLowerCase().replace(/\.$/u, "");
  return {
    stage: present(env.RELAY_STAGE) ? env.RELAY_STAGE.trim() : "production",
    origin: env.RELAY_ORIGIN.replace(/\/+$/u, ""),
    websiteIssuer: env.WEBSITE_ISSUER,
    websiteJwksUrl: env.WEBSITE_JWKS_URL,
    websiteAudience: env.WEBSITE_JWT_AUDIENCE,
    tunnel:
      present(env.CF_ACCOUNT_ID) &&
      present(env.TUNNEL_ZONE_ID) &&
      present(zoneName) &&
      present(env.CF_API_TOKEN)
        ? {
            accountId: env.CF_ACCOUNT_ID.trim(),
            zoneId: env.TUNNEL_ZONE_ID.trim(),
            zoneName,
            apiToken: env.CF_API_TOKEN.trim(),
          }
        : null,
    signingKey:
      present(env.RELAY_SIGNING_KEY) && present(env.RELAY_SIGNING_KEY_ID)
        ? { pem: env.RELAY_SIGNING_KEY, kid: env.RELAY_SIGNING_KEY_ID.trim() }
        : null,
    extraJwks: present(env.RELAY_EXTRA_JWKS) ? env.RELAY_EXTRA_JWKS : undefined,
    apns:
      present(env.APNS_KEY_ID) &&
      present(env.APNS_TEAM_ID) &&
      present(env.APNS_BUNDLE_ID) &&
      present(env.APNS_PRIVATE_KEY)
        ? {
            keyId: env.APNS_KEY_ID.trim(),
            teamId: env.APNS_TEAM_ID.trim(),
            bundleId: env.APNS_BUNDLE_ID.trim(),
            privateKey: env.APNS_PRIVATE_KEY,
          }
        : null,
    cleanupMode: cleanupModeFrom(env.RELAY_TUNNEL_CLEANUP_MODE),
  };
}

/** Tunnel names are `<prefix><16 hex>`; the prefix separates stages in one account. */
export function tunnelNamePrefix(stage: string): string {
  return stage === "production" ? "clink-" : `clink-${stage}-`;
}
