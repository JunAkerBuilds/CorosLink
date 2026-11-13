// Pure planning helpers for cutting speech into watch-sized parts. No Electron
// or ffmpeg here, so Node tests can load this file directly.

/** A stretch of quiet audio reported by ffmpeg's silencedetect filter. */
export interface SilenceSpan {
  start: number;
  end: number;
}

/** silencedetect settings: quiet enough to be a pause between sentences. */
export const SILENCE_NOISE_DB = -35;
export const SILENCE_MIN_SECONDS = 0.3;

// How far a cut may move from its target to land in a pause: a tenth of the
// part length, but never more than 30 s.
const MAX_SNAP_SECONDS = 30;
const SNAP_FRACTION = 0.1;
// A cut this close to the end would only make a sliver of a part.
const END_MARGIN_SECONDS = 1;
// Keep the next part's first words: cut at most this long before speech
// resumes, so a long pause stays at the end of the earlier part.
const LEAD_IN_SECONDS = 0.35;

/**
 * Reads silencedetect lines as they stream. Feed every ffmpeg output line;
 * call `finish` with the audio length to close a pause that runs to the end.
 */
export function createSilenceCollector(): {
  push: (line: string) => void;
  finish: (totalSeconds: number) => SilenceSpan[];
} {
  const spans: SilenceSpan[] = [];
  let openStart: number | undefined;
  return {
    push(line: string) {
      const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
      if (start) {
        openStart = Math.max(Number(start[1]), 0);
        return;
      }
      const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
      if (end && openStart !== undefined) {
        const endSeconds = Number(end[1]);
        if (endSeconds > openStart) spans.push({ start: openStart, end: endSeconds });
        openStart = undefined;
      }
    },
    finish(totalSeconds: number) {
      if (openStart !== undefined && totalSeconds > openStart) {
        spans.push({ start: openStart, end: totalSeconds });
        openStart = undefined;
      }
      return spans;
    }
  };
}

/**
 * A part's file name: the zero-padded part number first, then the title. Long
 * names scroll on the watch, so the number has to come first to stay visible.
 */
export function partFileName(stem: string, number: string): string {
  return `${number} ${stem}.mp3`;
}

/** The audiobook source id for one podcast episode split into parts. */
export function podcastEpisodeIdentifier(showId: string, episodeId: string): string {
  return `podcast:${showId}:${episodeId}`;
}

/** The point inside a pause where a part should end. */
export function cutPointInPause(span: SilenceSpan): number {
  const middle = span.start + (span.end - span.start) / 2;
  return Math.min(Math.max(middle, span.end - LEAD_IN_SECONDS), span.end);
}

/**
 * Cut times for parts of about `partSeconds`, each moved to the nearest pause
 * within reach of its target so no part starts or ends mid-word. Where no pause
 * is close enough, the cut stays on its target. Each target is measured from
 * the previous cut, so parts keep their length even after a cut moves.
 */
export function planPauseCuts(
  totalSeconds: number,
  partSeconds: number,
  silences: SilenceSpan[]
): number[] {
  if (!(totalSeconds > 0) || !(partSeconds > 0)) return [];
  const reach = Math.min(MAX_SNAP_SECONDS, partSeconds * SNAP_FRACTION);
  const candidates = silences
    .map(cutPointInPause)
    .filter((point) => point > 0 && point < totalSeconds - END_MARGIN_SECONDS)
    .sort((left, right) => left - right);

  const cuts: number[] = [];
  let last = 0;
  for (;;) {
    const target = last + partSeconds;
    if (target >= totalSeconds - END_MARGIN_SECONDS) break;
    let best: number | undefined;
    for (const point of candidates) {
      if (point <= last) continue;
      if (point > target + reach) break;
      if (point < target - reach) continue;
      if (best === undefined || Math.abs(point - target) < Math.abs(best - target)) best = point;
    }
    const cut = Number((best ?? target).toFixed(3));
    cuts.push(cut);
    last = cut;
  }
  return cuts;
}
