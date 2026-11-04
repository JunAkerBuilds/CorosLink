import { formatDate, t, useLanguage } from "../../i18n/training";
import { AlertCircle, Check, ChevronRight, ExternalLink, Loader2, Sparkles, Square, Undo2 } from "lucide-react";
import type { RaceLookupCandidate, RaceLookupEvent, RaceLookupStatus } from "../../../electron/raceTypes";
import { raceDistanceLabel } from "../../../electron/raceModel";
import { formatRaceStartTime } from "../raceFormat";
import type { RaceLookupState } from "../useRaceLookup";

function inputDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function eventLabel(event: RaceLookupEvent): string {
  return event.distanceKey === "other" ? event.label : t(raceDistanceLabel(event.distanceKey));
}

function CandidateMeta({ candidate }: { candidate: RaceLookupCandidate }) {
  const parts = [
    candidate.raceDay
      ? formatDate(inputDay(candidate.raceDay), { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : t("Date not announced"),
    candidate.location,
    candidate.events.map(eventLabel).join(", ") || undefined
  ].filter(Boolean);
  return <span>{parts.join(" · ")}</span>;
}

function StatusHint({ status }: { status: RaceLookupStatus | null | undefined }) {
  if (status === undefined || status === null) return null;
  const provider = t(status.label);
  if (!status.webSearch) {
    return <p className="race-finder-hint">{t("{{p0}} can't search the web. Choose another provider in Training Coach settings to fill this in with AI.", { p0: provider })}</p>;
  }
  if (!status.ready) {
    return <p className="race-finder-hint">{t("Connect {{p0}} in Training Coach settings to fill this in with AI.", { p0: provider })}</p>;
  }
  return (
    <p className="race-finder-hint">
      {t("{{p0}} searches the web for the date, distance, start time, bib pickup and deadline. Nothing is saved until you check it.", { p0: provider })}
      {status.provider === "openrouter" ? ` ${t("OpenRouter bills web searches to your credit.")}` : ""}
    </p>
  );
}

/**
 * The race name, and the button that asks the AI to look the rest up. One
 * input for both: what the athlete types to name the race is what gets searched.
 */
export function RaceFinder({
  value,
  status,
  state,
  filledCount,
  canUndo,
  enterSearches,
  placeholder,
  onChange,
  onSearch,
  onStop,
  onUndo,
  onDismiss,
  onPickCandidate,
  onPickEvent
}: {
  value: string;
  status: RaceLookupStatus | null | undefined;
  state: RaceLookupState;
  filledCount: number;
  canUndo: boolean;
  /** Enter runs the search while the form has nothing of the AI's to save yet. */
  enterSearches: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  onStop: () => void;
  onUndo: () => void;
  onDismiss: () => void;
  onPickCandidate: (candidate: RaceLookupCandidate) => void;
  onPickEvent: (event: RaceLookupEvent) => void;
}) {
  useLanguage();
  const searching = state.phase === "searching";
  const available = status !== null;
  const ready = status?.ready === true && status.webSearch;

  return (
    <section className="race-finder" aria-label={t("Find your race")}>
      <label className="race-field race-finder-name">
        <span>{t("Race name")}</span>
        <input
          type="text"
          value={value}
          maxLength={120}
          placeholder={placeholder}
          aria-describedby="race-finder-status"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            // A second Enter mid-search must not submit the form and save the race.
            if (searching) {
              event.preventDefault();
              return;
            }
            if (!enterSearches) return;
            event.preventDefault();
            onSearch();
          }}
        />
      </label>
      {available ? (
        searching ? (
          <button type="button" className="race-finder-button" onClick={onStop}>
            <Square size={12} fill="currentColor" aria-hidden="true" />
            {t("Stop")}
          </button>
        ) : (
          <button type="button" className="race-finder-button" disabled={!ready} onClick={onSearch}>
            <Sparkles size={15} aria-hidden="true" />
            {t("Find with AI")}
          </button>
        )
      ) : null}

      <div id="race-finder-status" className="race-finder-status" aria-live="polite">
        {state.phase === "idle" ? <StatusHint status={status} /> : null}

        {state.phase === "searching" ? (
          <div className="race-finder-progress">
            <Loader2 className="spin" size={15} aria-hidden="true" />
            <div>
              <strong>
                {state.stage === "read" && state.detail
                  ? t("Reading {{p0}}", { p0: state.detail })
                  : state.stage === "search" && state.detail
                    ? t("Searching for “{{p0}}”", { p0: state.detail })
                    : state.stage === "write"
                      ? t("Putting the details together")
                      : t("Searching the web")}
              </strong>
              <span>{t("This can take a minute or two.")}</span>
            </div>
          </div>
        ) : null}

        {state.phase === "needsName" ? (
          <p className="race-finder-hint">{t("Type the race name or paste its website first.")}</p>
        ) : null}

        {state.phase === "failed" || state.phase === "empty" ? (
          <div className="race-finder-problem">
            <AlertCircle size={15} aria-hidden="true" />
            <div>
              <strong>{state.phase === "failed" ? t("The search didn't finish") : t("Couldn't find that race")}</strong>
              <span>
                {state.phase === "failed"
                  ? state.message
                  : state.message ?? t("Add the city or the year, or paste the race's website, and try again.")}
              </span>
            </div>
          </div>
        ) : null}

        {state.phase === "choose" ? (
          <div className="race-finder-choices">
            <div className="race-finder-choices-head">
              <strong>{t("A few races match. Which one is yours?")}</strong>
              <button type="button" className="race-text-button" onClick={onDismiss}>{t("None of these")}</button>
            </div>
            <ul>
              {state.candidates.map((candidate, index) => (
                <li key={`${candidate.name}-${index}`}>
                  <button type="button" onClick={() => onPickCandidate(candidate)}>
                    <span className="race-finder-choice-copy">
                      <strong>{candidate.name}</strong>
                      <CandidateMeta candidate={candidate} />
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* A later search that finds nothing leaves the earlier fill in place, so keep its Undo. */}
        {state.phase !== "found" && state.phase !== "searching" && canUndo ? (
          <button type="button" className="race-text-button" onClick={onUndo}>
            <Undo2 size={13} aria-hidden="true" />
            {t("Undo")}
          </button>
        ) : null}

        {state.phase === "found" ? (
          <div className="race-finder-found">
            <div className="race-finder-found-head">
              <Check size={15} strokeWidth={2.6} aria-hidden="true" />
              <strong>
                {filledCount === 1 ? t("1 detail filled in") : t("{{count}} details filled in", { count: filledCount })}
              </strong>
              {canUndo ? (
                <button type="button" className="race-text-button" onClick={onUndo}>
                  <Undo2 size={13} aria-hidden="true" />
                  {t("Undo")}
                </button>
              ) : null}
            </div>
            {!state.candidate.raceDay ? (
              <p className="race-finder-note">{t("No date found for the next edition. Add it when it's announced.")}</p>
            ) : null}
            {state.candidate.note ? <p className="race-finder-note">{state.candidate.note}</p> : null}
            {state.candidate.events.length > 1 ? (
              <div className="race-finder-events">
                <span>{t("Which race are you running?")}</span>
                <div className="race-choices-row">
                  {state.candidate.events.map((option) => (
                    <button
                      key={`${option.distanceKey}-${option.distance}`}
                      type="button"
                      className={`race-choice${state.event?.distance === option.distance ? " is-on" : ""}`}
                      aria-pressed={state.event?.distance === option.distance}
                      data-distance={option.distanceKey}
                      onClick={() => onPickEvent(option)}
                    >
                      <i aria-hidden="true" />
                      <span>{eventLabel(option)}</span>
                      {option.startTime ? <small>{formatRaceStartTime(option.startTime)}</small> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="race-finder-caution">{t("AI can get details wrong, so check them against the race's site.")}</p>
            <p className="race-finder-sources">
              {state.candidate.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.title ?? source.url}>
                  {hostOf(source.url)}
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              ))}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
