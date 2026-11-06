import type { CorosWatchKeyCheckResult } from "./types";

type CheckFindings = Omit<Extract<CorosWatchKeyCheckResult, { servers: unknown }>, "report">;

/**
 * The watch key check as plain English text for a GitHub issue: key IDs,
 * masked account IDs, servers and field names. No email, token or key material.
 */
export function formatWatchKeyCheckReport(result: CheckFindings, about: {
  version: string; platform: string; signedInRegion?: string; checkedAt: number;
}): string {
  const lines = [
    "CorosLink watch key check (read-only)",
    `CorosLink ${about.version}, ${about.platform}, ${new Date(about.checkedAt).toISOString()}`,
    `Watch: ${result.watch ?? "unknown"}`,
    `Key ID on the watch: ${result.watchKeyId ?? "not recorded yet (connect the watch once, then check again)"}`,
    `Saved key ID: ${result.savedKeyId ?? "none"}`,
    `Signed in on: ${about.signedInRegion ?? "none"}`,
    ""
  ];
  for (const server of result.servers) {
    if (!server.signedIn) {
      lines.push(`${server.region} (${server.host}): not signed in. ${server.error ?? ""}`.trim());
      continue;
    }
    lines.push(`${server.region} (${server.host}): signed in, account ${server.accountId ?? "unknown"}`);
    if (!server.keys.length) lines.push("  no keys in the answer");
    for (const key of server.keys) {
      const issued = key.issuedAt ? `, issued ${new Date(key.issuedAt).toISOString().slice(0, 10)}` : "";
      const owner = key.accountId && key.accountId !== server.accountId ? `, account ${key.accountId}` : "";
      const same = key.keyId && key.keyId === result.watchKeyId ? "  <- matches the watch" : "";
      lines.push(key.keyId ? `  ${key.field}: ${key.keyId}${issued}${owner}${same}` : `  ${key.field}: ${key.error ?? "unreadable"}`);
    }
    if (server.fields?.length) lines.push(`  fields: ${server.fields.join(", ")}`);
  }
  lines.push("", result.match
    ? `Result: COROS's ${result.match.region} server sent the watch's key (${result.match.keyId}) in ${result.match.field}.`
    : result.watchKeyId
      ? `Result: none of the keys COROS sent match the watch's key (${result.watchKeyId}).`
      : "Result: the watch's key ID isn't known yet.");
  return lines.join("\n");
}
