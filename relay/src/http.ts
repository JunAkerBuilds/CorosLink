import type { ErrorBody, ErrorCode } from "./protocol";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_token: 401,
  client_not_allowed: 403,
  invalid_signature: 401,
  signature_replayed: 401,
  signature_stale: 401,
  environment_not_linked: 404,
  environment_not_ready: 409,
  link_limit_reached: 409,
  allocation_conflict: 409,
  allocation_busy: 503,
  rate_limited: 429,
  environment_unreachable: 502,
  environment_redirect_refused: 502,
  environment_refused: 502,
  environment_response_invalid: 502,
  upstream_error: 502,
  upstream_rate_limited: 503,
  not_configured: 503,
  not_found: 404,
  method_not_allowed: 405,
  internal_error: 500,
};

/** An error that maps to a `{ error: { code, message } }` response. */
export class RelayError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly options: {
      retryAfterSeconds?: number;
      details?: Record<string, string | number | boolean>;
    } = {},
  ) {
    super(message);
    this.name = "RelayError";
    this.status = STATUS_BY_CODE[code];
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function errorResponse(error: RelayError): Response {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.options.details ? { details: error.options.details } : {}),
    },
  };
  const headers: Record<string, string> = {};
  if (error.options.retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(Math.max(1, Math.ceil(error.options.retryAfterSeconds)));
  }
  if (error.status === 401 && error.code === "invalid_token") {
    headers["www-authenticate"] = 'Bearer error="invalid_token"';
  }
  return json(body, error.status, headers);
}

export const MAX_BODY_BYTES = 16 * 1024;

/** Reads at most `limit` bytes of a body; null when it is longer. Never buffers past the limit. */
export async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface JsonBody {
  raw: Uint8Array;
  value: unknown;
}

/** Reads the raw bytes (environment signatures hash them) and parses JSON. */
export async function readJsonBody(request: Request, options: { allowEmpty?: boolean } = {}): Promise<JsonBody> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    throw new RelayError("invalid_request", "Request body is too large.");
  }
  const raw = await readBounded(request.body, MAX_BODY_BYTES);
  if (raw === null) {
    throw new RelayError("invalid_request", "Request body is too large.");
  }
  if (raw.byteLength === 0) {
    if (options.allowEmpty) return { raw, value: {} };
    throw new RelayError("invalid_request", "Request body is required.");
  }
  try {
    return { raw, value: JSON.parse(new TextDecoder().decode(raw)) as unknown };
  } catch {
    throw new RelayError("invalid_request", "Request body is not valid JSON.");
  }
}

// --- small validators -------------------------------------------------------

export function asObject(value: unknown, what = "Request body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelayError("invalid_request", `${what} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function requireString(
  object: Record<string, unknown>,
  key: string,
  options: { pattern?: RegExp; min?: number; max?: number } = {},
): string {
  const value = object[key];
  const min = options.min ?? 1;
  const max = options.max ?? 256;
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new RelayError("invalid_request", `${key} must be a string of ${min}-${max} characters.`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    throw new RelayError("invalid_request", `${key} has an invalid format.`);
  }
  return value;
}

export function requirePort(object: Record<string, unknown>, key = "port"): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new RelayError("invalid_request", `${key} must be an integer from 1 to 65535.`);
  }
  return value;
}

export function requireOneOf<T extends string>(
  object: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = object[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new RelayError("invalid_request", `${key} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
