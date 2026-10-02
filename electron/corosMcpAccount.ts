import { getCorosWatchfaceStatus } from "./corosWatchfaceService";
import { getTrainingHubStatus } from "./trainingHubService";
import type { CorosMcpAccount, CorosWatchfaceRegion } from "./types";

// Training Hub hosts whose account region has its own COROS MCP server.
// Singapore accounts (teamsgapi) have none, so they keep the current endpoint.
const TRAINING_HUB_REGIONS: Record<string, CorosWatchfaceRegion> = {
  "teamapi.coros.com": "us",
  "teameuapi.coros.com": "eu",
  "teamcnapi.coros.com": "cn"
};

/** The COROS account CorosLink is signed in with, offered to connect COROS MCP. */
export function getCorosMcpAccount(): CorosMcpAccount {
  const trainingHub = getTrainingHubStatus();
  const trainingHubRegion =
    trainingHub.authenticated && trainingHub.baseUrl
      ? TRAINING_HUB_REGIONS[hostname(trainingHub.baseUrl)]
      : undefined;
  // Watch Faces signs "China / Asia-Pacific" accounts in on one host, and COROS
  // MCP's server for Asia-Pacific accounts is unknown, so only US and Europe
  // sessions pick a server.
  const watchfaceRegion = getCorosWatchfaceStatus().region;
  return {
    email: trainingHub.email,
    region:
      trainingHubRegion ??
      (watchfaceRegion === "cn" ? undefined : watchfaceRegion)
  };
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
