import type { CorosWatchfaceRegion } from "./types";

// COROS runs one MCP deployment per account region, and each hands sign-in to
// that region's open platform (openus/openeu/opencn.coros.com). mcp.coros.com
// publishes the US deployment's metadata, so it counts as US.
const COROS_MCP_URLS: Record<CorosWatchfaceRegion, string> = {
  us: "https://mcpus.coros.com/mcp",
  eu: "https://mcpeu.coros.com/mcp",
  cn: "https://mcpcn.coros.com/mcp"
};

export const COROS_MCP_REGION_LABELS: Record<CorosWatchfaceRegion, string> = {
  us: "United States",
  eu: "Europe",
  cn: "Mainland China"
};

const COROS_MCP_HOST = /^mcp(us|eu|cn)?\.coros\.com$/;
const COROS_SIGN_IN_HOST = /^open(?:us|eu|cn)?\.coros\.com$/;

/** Account region a COROS MCP endpoint serves, or null for any other server. */
export function corosMcpRegion(url: string): CorosWatchfaceRegion | null {
  const parsed = parseHttpsUrl(url);
  const match = parsed ? COROS_MCP_HOST.exec(parsed.hostname) : null;
  if (!match) return null;
  return (match[1] as CorosWatchfaceRegion | undefined) ?? "us";
}

export function isCorosMcpUrl(url: string): boolean {
  return corosMcpRegion(url) !== null;
}

export function corosMcpUrl(region: CorosWatchfaceRegion): string {
  return COROS_MCP_URLS[region];
}

/** COROS's OAuth sign-in form, where a known account email can be filled in. */
export function isCorosSignInPage(url: string): boolean {
  const parsed = parseHttpsUrl(url);
  return Boolean(
    parsed &&
      COROS_SIGN_IN_HOST.test(parsed.hostname) &&
      parsed.pathname === "/oauth2/authorize"
  );
}

/**
 * Fills the sign-in form's email unless it already holds one, then focuses the
 * password. The input event lets the page re-check its "Authorize" button.
 */
export function corosSignInEmailScript(email: string): string {
  return `(() => {
  const email = document.getElementById("txt_userName");
  if (!(email instanceof HTMLInputElement) || email.value.trim()) return;
  email.value = ${JSON.stringify(email)};
  email.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("psw_password")?.focus();
})();`;
}

function parseHttpsUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}
