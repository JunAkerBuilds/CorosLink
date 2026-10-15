import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** `activity:read_all` adds "Only You" activities, where gym sessions often live. */
export const STRAVA_SCOPES = ["read", "activity:read_all"];

export interface StravaClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface StravaAthlete {
  id: string;
  displayName?: string;
}

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Present on the initial exchange only. */
  athlete?: StravaAthlete;
  /** Granted scopes; absent on refresh, which keeps the original grant. */
  scopes?: string[];
}

export class StravaAuthorizationError extends Error {}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Strava writes scopes comma-separated on the redirect and space-separated on token responses. */
export function parseStravaScopes(value: unknown): string[] | undefined {
  const text = stringValue(value);
  return text ? text.split(/[\s,]+/).filter(Boolean) : undefined;
}

export function hasStravaActivityAccess(scopes: string[] | undefined): boolean {
  return Boolean(
    scopes?.includes("activity:read") || scopes?.includes("activity:read_all")
  );
}

function parseAthlete(value: unknown): StravaAthlete | undefined {
  const athlete = record(value);
  const id = athlete?.id;
  const athleteId =
    typeof id === "number" && Number.isSafeInteger(id)
      ? String(id)
      : stringValue(id);
  if (!athleteId) return undefined;
  const name = [stringValue(athlete?.firstname), stringValue(athlete?.lastname)]
    .filter(Boolean)
    .join(" ");
  return {
    id: athleteId,
    displayName: name || stringValue(athlete?.username)
  };
}

function tokenErrorMessage(status: number, body: JsonRecord | undefined): StravaAuthorizationError | Error {
  const errors = Array.isArray(body?.errors) ? body.errors.map(record) : [];
  const fields = errors.map((error) => `${error?.resource ?? ""}.${error?.field ?? ""}`);
  if (fields.some((field) => field.endsWith(".client_secret") || field.endsWith(".client_id"))) {
    return new Error(
      "Strava rejected the Client ID or Client Secret. Copy both again from strava.com/settings/api."
    );
  }
  if (fields.some((field) => field.startsWith("RefreshToken."))) {
    return new StravaAuthorizationError(
      "Strava access expired or was revoked. Reconnect Strava."
    );
  }
  if (fields.some((field) => field.startsWith("AuthorizationCode."))) {
    return new Error("The Strava sign-in expired before it finished. Connect again.");
  }
  // Not an authorization error: an ambiguous refusal must not sign the athlete out.
  if (status === 401 || status === 403) {
    return new Error(
      "Strava refused this application. Check the banner on strava.com/settings/api — personal API apps now need an active Strava subscription."
    );
  }
  return new Error(`Strava could not complete sign-in (${status}).`);
}

export async function requestStravaTokens(
  config: StravaClientConfig,
  parameters: Record<string, string>,
  signal?: AbortSignal
): Promise<StravaTokens> {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...parameters
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000)
  });
  const body = record(await response.json().catch(() => undefined));
  const accessToken = stringValue(body?.access_token);
  const refreshToken = stringValue(body?.refresh_token);
  const expiresAt = typeof body?.expires_at === "number" ? body.expires_at : undefined;
  if (!response.ok || !accessToken || !refreshToken || expiresAt === undefined) {
    throw tokenErrorMessage(response.status, body);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAt * 1000,
    athlete: parseAthlete(body?.athlete),
    scopes: parseStravaScopes(body?.scope)
  };
}

/**
 * Strava checks the client and redirect before its login page, even without a
 * session. Asking first turns a mistyped Client ID into an error here rather
 * than a JSON page in the browser while CorosLink waits out the timeout.
 */
async function preflightAuthorize(url: URL, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    });
  } catch {
    signal.throwIfAborted();
    // Offline or slow: the browser will show whatever Strava says.
    return;
  }
  if (response.status !== 400) return;
  const body = record(await response.json().catch(() => undefined));
  const fields = (Array.isArray(body?.errors) ? body.errors.map(record) : []).map(
    (error) => stringValue(error?.field)
  );
  if (fields.includes("client_id")) {
    throw new Error(
      "Strava does not recognise this Client ID. Copy it again from strava.com/settings/api."
    );
  }
  if (fields.includes("redirect_uri")) {
    throw new Error(
      "Strava refused the sign-in redirect to this computer. Set Authorization Callback Domain to localhost in your Strava API settings, then connect again."
    );
  }
}

/** Desktop OAuth: system browser, random loopback port and state validation. */
export async function authorizeStrava(
  config: StravaClientConfig,
  openUrl: (url: string) => Promise<void>,
  signal: AbortSignal,
  timeoutMs = 180_000
): Promise<StravaTokens> {
  signal.throwIfAborted();
  const state = randomBytes(32).toString("base64url");
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    // Strava white-lists localhost and 127.0.0.1 on any port, whatever the
    // application's Authorization Callback Domain is set to.
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    const url = new URL("https://www.strava.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: STRAVA_SCOPES.join(","),
      state
    }).toString();
    await preflightAuthorize(url, signal);

    const callback = await new Promise<{ code: string; scopes?: string[] }>((resolve, reject) => {
      const finish = (error?: Error, result?: { code: string; scopes?: string[] }) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        server.removeAllListeners("request");
        server.removeAllListeners("error");
        if (error) reject(error);
        else resolve(result!);
      };
      const onAbort = () => finish(new Error("Strava connection cancelled."));
      const timer = setTimeout(
        () => finish(new Error("Strava sign-in timed out. Try connecting again.")),
        timeoutMs
      );
      signal.addEventListener("abort", onAbort, { once: true });
      server.once("error", (error) => finish(error));
      server.on("request", (request, response) => {
        const received = new URL(request.url ?? "/", redirectUri);
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Security-Policy", "default-src 'none'");
        if (request.method !== "GET" || received.pathname !== "/callback") {
          response.writeHead(404).end("Not found.");
          return;
        }
        if (received.searchParams.get("state") !== state) {
          response
            .writeHead(400)
            .end("Invalid sign-in response. Return to CorosLink and try again.");
          return;
        }
        const code = received.searchParams.get("code");
        if (received.searchParams.has("error") || !code) {
          response
            .writeHead(400)
            .end("Strava access was not granted. You can return to CorosLink.");
          finish(new Error("Strava access was not granted. Try again and select Authorize."));
          return;
        }
        const scopes = parseStravaScopes(received.searchParams.get("scope"));
        if (scopes && !hasStravaActivityAccess(scopes)) {
          response
            .writeHead(400)
            .end("Activity access is needed. Return to CorosLink and connect again.");
          finish(
            new Error(
              "Strava did not grant activity access. Connect again and keep \"View data about your activities\" ticked."
            )
          );
          return;
        }
        response.end("Strava connected. Return to CorosLink.");
        finish(undefined, { code, scopes });
      });
      if (signal.aborted) onAbort();
      else
        void openUrl(url.toString()).catch((error) =>
          finish(error instanceof Error ? error : new Error("Could not open your browser."))
        );
    });
    signal.throwIfAborted();
    const tokens = await requestStravaTokens(
      config,
      { code: callback.code, grant_type: "authorization_code" },
      signal
    );
    return { ...tokens, scopes: tokens.scopes ?? callback.scopes };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
