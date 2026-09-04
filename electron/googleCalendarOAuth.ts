import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { GoogleCalendarConfigInput } from "./googleCalendarTypes";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class GoogleAuthorizationError extends Error {}

export async function requestGoogleTokens(
  config: GoogleCalendarConfigInput,
  parameters: Record<string, string>,
  signal?: AbortSignal,
): Promise<GoogleCalendarTokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.clientId,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      ...parameters,
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      throw new GoogleAuthorizationError(
        "Google Calendar access expired or was revoked. Reconnect your account.",
      );
    }
    throw new Error(
      "Google could not authorize Calendar. Check your Desktop app credentials and try again.",
    );
  }
  if (
    body.scope &&
    GOOGLE_CALENDAR_SCOPES.some(
      (scope) => !body.scope!.split(" ").includes(scope),
    )
  ) {
    throw new GoogleAuthorizationError(
      "Allow calendar access on Google's consent screen, then reconnect.",
    );
  }
  const refreshToken = body.refresh_token ?? parameters.refresh_token;
  if (!refreshToken)
    throw new GoogleAuthorizationError(
      "Google did not grant offline access. Reconnect and allow calendar access.",
    );
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/** Desktop OAuth: system browser, random loopback port, state validation and PKCE. */
export async function authorizeGoogleCalendar(
  config: GoogleCalendarConfigInput,
  openUrl: (url: string) => Promise<void>,
  signal: AbortSignal,
  timeoutMs = 180_000,
): Promise<GoogleCalendarTokens> {
  signal.throwIfAborted();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent select_account",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();

    const code = await new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, code?: string) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        server.removeAllListeners("request");
        server.removeAllListeners("error");
        if (error) reject(error);
        else resolve(code!);
      };
      const onAbort = () =>
        finish(new Error("Google Calendar connection cancelled."));
      const timer = setTimeout(
        () =>
          finish(new Error("Google sign-in timed out. Try connecting again.")),
        timeoutMs,
      );
      signal.addEventListener("abort", onAbort, { once: true });
      server.once("error", (error) => finish(error));
      server.on("request", (request, response) => {
        const callback = new URL(request.url ?? "/", redirectUri);
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Security-Policy", "default-src 'none'");
        if (request.method !== "GET" || callback.pathname !== "/callback") {
          response.writeHead(404).end("Not found.");
          return;
        }
        if (callback.searchParams.get("state") !== state) {
          response
            .writeHead(400)
            .end(
              "Invalid sign-in response. Return to CorosLink and try again.",
            );
          return;
        }
        const code = callback.searchParams.get("code");
        if (callback.searchParams.has("error") || !code) {
          response
            .writeHead(400)
            .end(
              "Calendar access was not granted. You can return to CorosLink.",
            );
          finish(
            new Error(
              "Google Calendar access was not granted. Try again and allow calendar access.",
            ),
          );
          return;
        }
        response.end(
          "Sign-in received. Return to CorosLink to finish connecting your calendar.",
        );
        finish(undefined, code);
      });
      if (signal.aborted) onAbort();
      else
        void openUrl(url.toString()).catch((error) =>
          finish(
            error instanceof Error
              ? error
              : new Error("Could not open your browser."),
          ),
        );
    });
    signal.throwIfAborted();
    return await requestGoogleTokens(
      config,
      {
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      },
      signal,
    );
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
