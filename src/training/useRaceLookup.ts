import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RaceLookupCandidate,
  RaceLookupEvent,
  RaceLookupProgress,
  RaceLookupRequest,
  RaceLookupResult,
  RaceLookupStatus
} from "../../electron/raceTypes";
import { getLanguage, type Language } from "../i18n/locale";
import { toErrorMessage, type RaceJournal } from "./useRaceJournal";

export type RaceLookupState =
  | { phase: "idle" }
  | { phase: "needsName" }
  | { phase: "searching"; stage?: RaceLookupProgress["stage"]; detail?: string }
  | { phase: "choose"; candidates: RaceLookupCandidate[] }
  | { phase: "found"; candidate: RaceLookupCandidate; event?: RaceLookupEvent }
  | { phase: "empty"; message?: string }
  | { phase: "failed"; message: string };

/** The language the AI writes its sentences in. */
const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  de: "German, addressing the reader as du",
  es: "Spanish",
  fr: "French",
  pt: "European Portuguese",
  "zh-CN": "Simplified Chinese"
};

let nextRequest = 0;

/**
 * One race search at a time for the race editor. It stops when the editor
 * closes, and a result that arrives after that is dropped.
 */
export function useRaceLookup(
  lookup: RaceJournal["lookup"],
  active: boolean,
  onResult: (result: RaceLookupResult) => void
) {
  const [state, setState] = useState<RaceLookupState>({ phase: "idle" });
  /** Undefined until checked; null when this build has no lookup at all. */
  const [status, setStatus] = useState<RaceLookupStatus | null | undefined>(undefined);
  const current = useRef<string | null>(null);
  const resultHandler = useRef(onResult);
  resultHandler.current = onResult;

  const stop = useCallback(() => {
    const requestId = current.current;
    current.current = null;
    if (requestId) void lookup.cancelRaceLookup?.(requestId);
    setState({ phase: "idle" });
  }, [lookup]);

  useEffect(() => {
    if (!active) return;
    let stale = false;
    setStatus(undefined);
    if (!lookup.getRaceLookupStatus || !lookup.lookupRace) {
      setStatus(null);
      return;
    }
    lookup.getRaceLookupStatus()
      .then((next) => {
        if (!stale) setStatus(next);
      })
      .catch(() => {
        if (!stale) setStatus(null);
      });
    const unsubscribe = lookup.onRaceLookupProgress?.((progress) => {
      if (progress.requestId !== current.current) return;
      setState({ phase: "searching", stage: progress.stage, detail: progress.detail });
    });
    return () => {
      stale = true;
      unsubscribe?.();
      stop();
    };
  }, [active, lookup, stop]);

  const search = useCallback(
    async (request: Omit<RaceLookupRequest, "requestId" | "language">) => {
      if (!lookup.lookupRace) return;
      nextRequest += 1;
      const requestId = `race-lookup-${Date.now()}-${nextRequest}`;
      current.current = requestId;
      setState({ phase: "searching" });
      try {
        const result = await lookup.lookupRace({ ...request, requestId, language: LANGUAGE_NAMES[getLanguage()] });
        if (current.current !== requestId) return;
        current.current = null;
        resultHandler.current(result);
      } catch (reason) {
        if (current.current !== requestId) return;
        current.current = null;
        setState({ phase: "failed", message: toErrorMessage(reason) });
      }
    },
    [lookup]
  );

  return { state, setState, status, search, stop };
}
