import { localizedText, renderLocalizedText, type LocalizableText, t, useLanguage } from "../i18n/training";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManualRaceInput, RaceEditInput, RaceOverview } from "../../electron/raceTypes";
import type { TrainingHubActivity } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { createSampleRaceOverview } from "./raceSamples";

export interface RaceJournal {
  overview: RaceOverview | null;
  /** COROS activity IDs tagged as races, for badges and the activity dialog. */
  raceActivityIds: ReadonlySet<string>;
  loading: boolean;
  /** The action in flight, for example `mark:<activityId>` or `import`. */
  pending: string | null;
  error: string | null;
  notice: string | null;
  /** Sample mode: shown, never saved. */
  readOnly: boolean;
  clearMessages: () => void;
  toggleActivity: (activity: TrainingHubActivity) => Promise<void>;
  markActivity: (activity: TrainingHubActivity) => Promise<void>;
  dismissSuggestion: (activityId: string) => Promise<void>;
  updateRace: (input: RaceEditInput) => Promise<boolean>;
  removeRace: (raceId: string) => Promise<boolean>;
  addManualRace: (input: ManualRaceInput) => Promise<boolean>;
  importStrava: () => Promise<void>;
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

/**
 * One race list for the whole Training Hub: the Races tab edits it and the
 * activity dialog tags into it, so both always agree. `refreshKey` changes
 * when the activity cache does, which can bring new suggestions.
 */
export function useRaceJournal(
  api: CorosLinkApi,
  { enabled, sampleMode, refreshKey }: { enabled: boolean; sampleMode: boolean; refreshKey: unknown }
): RaceJournal {
  useLanguage();
  const [overview, setOverview] = useState<RaceOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<LocalizableText | null>(null);
  const [notice, setNotice] = useState<LocalizableText | null>(null);
  const sample = useMemo(() => (sampleMode ? createSampleRaceOverview() : null), [sampleMode]);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled || sampleMode) return;
    const request = ++requestRef.current;
    setLoading(true);
    api
      .getRaceOverview()
      .then((next) => {
        if (request === requestRef.current) setOverview(next);
      })
      .catch((reason: unknown) => {
        if (request === requestRef.current) setError(toErrorMessage(reason));
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, [api, enabled, sampleMode, refreshKey]);

  const run = useCallback(
    async (key: string, action: () => Promise<RaceOverview>, success?: string) => {
      if (sampleMode) return false;
      // A finished action supersedes any load still in flight.
      requestRef.current += 1;
      setPending(key);
      setError(null);
      setNotice(null);
      try {
        setOverview(await action());
        if (success) setNotice(success);
        return true;
      } catch (reason) {
        setError(toErrorMessage(reason));
        return false;
      } finally {
        setPending(null);
        setLoading(false);
      }
    },
    [sampleMode]
  );

  const current = sample ?? overview;
  const raceActivityIds = useMemo(
    () =>
      new Set(
        (current?.races ?? [])
          .map((race) => race.corosActivityId)
          .filter((id): id is string => Boolean(id))
      ),
    [current]
  );

  const markActivity = useCallback(
    async (activity: TrainingHubActivity) => {
      await run(`mark:${activity.activityId}`, () => api.markActivityAsRace(activity));
    },
    [api, run]
  );

  const toggleActivity = useCallback(
    async (activity: TrainingHubActivity) => {
      if (raceActivityIds.has(activity.activityId)) {
        await run(`mark:${activity.activityId}`, () => api.unmarkActivityAsRace(activity.activityId));
      } else {
        await markActivity(activity);
      }
    },
    [api, markActivity, raceActivityIds, run]
  );

  return {
    overview: current,
    raceActivityIds,
    loading: !sample && loading,
    pending,
    error: error ? renderLocalizedText(error) : null,
    notice: notice ? renderLocalizedText(notice) : null,
    readOnly: Boolean(sample),
    clearMessages: () => {
      setError(null);
      setNotice(null);
    },
    toggleActivity,
    markActivity,
    dismissSuggestion: async (activityId) => {
      await run(`dismiss:${activityId}`, () => api.dismissRaceSuggestion(activityId));
    },
    updateRace: (input) => run(`update:${input.raceId}`, () => api.updateRace(input)),
    removeRace: (raceId) => run(`remove:${raceId}`, () => api.removeRace(raceId)),
    addManualRace: (input) => run("add", () => api.addManualRace(input)),
    importStrava: async () => {
      if (sampleMode) return;
      setPending("import");
      setError(null);
      setNotice(null);
      requestRef.current += 1;
      try {
        const result = await api.importStravaRaces();
        setOverview(result.overview);
        setNotice(localizedText(() =>
          result.added > 0
            ? t("Imported {{count}} races from Strava.", { count: result.added })
            : result.found > 0
              ? t("Your Strava races are already here.")
              : result.incremental
                ? t("No new races on Strava since the last import.")
                : t("No runs marked Race on Strava. Set a run's workout type to Race there, then import again.")
        ));
      } catch (reason) {
        setError(toErrorMessage(reason));
      } finally {
        setPending(null);
        setLoading(false);
      }
    }
  };
}
