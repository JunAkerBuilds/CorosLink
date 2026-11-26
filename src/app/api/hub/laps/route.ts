// COROS's lap table for an activity.
import { HubNotWired } from "@/server/hub/errors";
import { hubRoute } from "@/server/hub/http";
import { t } from "@/lib/i18n";

/**
 * Not connected: the phone app reads lap tables through COROS's MCP data access (`queryActivityLapData`,
 * its own OAuth sign-in), not through Training Hub, and the Hub client has no request for them. The reader
 * for COROS's lap JSON is ported (`@/server/hub/lapTable`) for when that connection exists.
 */
export const GET = hubRoute({}, async (): Promise<never> => {
  throw new HubNotWired(t("Lap tables aren't connected yet: COROS serves them through its data access for apps, not through Training Hub."));
});
