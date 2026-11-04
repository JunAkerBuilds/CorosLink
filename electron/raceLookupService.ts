import { completeWithWebSearch, getWebSearchStatus } from "./chatService";
import { parseRaceLookupReply, raceLookupInstructions, raceLookupPrompt } from "./raceLookupModel";
import type { RaceLookupProgress, RaceLookupRequest, RaceLookupResult, RaceLookupStatus } from "./raceTypes";

/** Past this the search has gone astray, however busy it looks. */
const LOOKUP_TIMEOUT_MS = 4 * 60_000;
const MAX_QUERY_LENGTH = 300;

const running = new Map<string, AbortController>();

export function getRaceLookupStatus(): Promise<RaceLookupStatus> {
  return getWebSearchStatus();
}

function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The page's host, or the words as they are; the athlete sees this while they wait. */
function progressDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  try {
    return new URL(detail).hostname.replace(/^www\./, "");
  } catch {
    return detail.slice(0, 120);
  }
}

/** Asks the Coach's AI provider to find a race on the web. Saves nothing. */
export async function lookupRace(
  request: RaceLookupRequest,
  onProgress: (progress: RaceLookupProgress) => void
): Promise<RaceLookupResult> {
  const query = typeof request?.query === "string" ? request.query.trim() : "";
  if (!query) throw new Error("Enter the race name first.");
  if (query.length > MAX_QUERY_LENGTH) throw new Error("That's too long to search for. Try just the race name.");

  // A dialog runs one search at a time; a new one replaces any left behind.
  for (const controller of running.values()) controller.abort();
  running.clear();

  const controller = new AbortController();
  running.set(request.requestId, controller);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOOKUP_TIMEOUT_MS);
  const today = localDay();

  try {
    const reply = await completeWithWebSearch(
      raceLookupInstructions(today, request.language),
      raceLookupPrompt({ ...request, query }),
      controller.signal,
      (progress) => {
        if (controller.signal.aborted) return;
        const detail = "detail" in progress ? progressDetail(progress.detail) : undefined;
        onProgress({ requestId: request.requestId, stage: progress.stage, ...(detail ? { detail } : {}) });
      }
    );
    controller.signal.throwIfAborted();
    return parseRaceLookupReply(reply, today);
  } catch (error) {
    if (timedOut) throw new Error("The search took too long. Try again with the race's website.");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (running.get(request.requestId) === controller) running.delete(request.requestId);
  }
}

export function cancelRaceLookup(requestId: string): void {
  running.get(requestId)?.abort();
  running.delete(requestId);
}
