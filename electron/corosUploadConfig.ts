export type CorosRegion = "US" | "EU";

export const SALT = "9y78gpoERW4lBNYL";
// COROS retired the public faq.coros.com/openapi/oss/sts endpoint (404 since
// Oct 2026). The Training Hub web app now fetches STS through its own
// same-origin proxy, authenticated by the CPL-coros-token session cookie.
const REGION_STS = {
  US: { webOrigin: "https://t.coros.com", bucket: "coros-s3" },
  EU: { webOrigin: "https://trainingeu.coros.com", bucket: "eu-coros" }
} as const;

export interface StsCredentials {
  Region: string;
  Bucket: string;
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
}

export function regionFromBaseUrl(baseUrl: string): CorosRegion {
  return baseUrl.includes("teameuapi") ? "EU" : "US";
}

export function stsRequestUrl(region: CorosRegion): string {
  const { webOrigin, bucket } = REGION_STS[region];
  const params = new URLSearchParams({ bucket, service: "aws", v: "2" });
  return `${webOrigin}/api/proxy/oss/sts?${params.toString()}`;
}

export function stsRequestHeaders(accessToken: string): Record<string, string> {
  return {
    Cookie: `CPL-coros-token=${accessToken}`,
    Accept: "application/json, text/plain, */*"
  };
}

export function decodeStsCredentials(rawCredentials: string): StsCredentials {
  // COROS appends the salt as a SUFFIX to the base64 payload (verified live:
  // the credentials string ends with SALT). Strip it from the end; fall back to
  // removing a single occurrence anywhere for resilience if the format shifts.
  const base64 = rawCredentials.endsWith(SALT)
    ? rawCredentials.slice(0, -SALT.length)
    : rawCredentials.replace(SALT, "");
  const json = Buffer.from(base64, "base64").toString("utf8");
  return JSON.parse(json) as StsCredentials;
}
