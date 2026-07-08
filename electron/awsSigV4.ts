import crypto from "node:crypto";

export interface SigV4Params {
  method: string;
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Header values to sign, keyed by header name (case-insensitive). */
  signedHeaders: Record<string, string>;
  /** Hex SHA-256 of the request body. */
  payloadHash: string;
  /** Override for deterministic tests, e.g. "20150830T123600Z". */
  amzDate?: string;
}

export function sha256Hex(body: Buffer | string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

// Encode a URI path, preserving "/" between segments (AWS canonical URI rules).
function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
      )
    )
    .join("/");
}

export function signRequest(params: SigV4Params): {
  authorization: string;
  amzDate: string;
} {
  const url = new URL(params.url);
  const amzDate =
    params.amzDate ??
    new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = encodePath(url.pathname || "/");
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  // x-amz-date is always part of the signature (AWS convention). Merge it in
  // so callers never have to pass it explicitly.
  const allSignedHeaders: Record<string, string> = {
    ...params.signedHeaders,
    "x-amz-date": amzDate
  };
  const headerEntries = Object.entries(allSignedHeaders)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders =
    headerEntries.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaderNames = headerEntries.map(([k]) => k).join(";");

  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames,
    params.payloadHash
  ].join("\n");

  const scope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, params.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  return { authorization, amzDate };
}
