// What every Route Studio client shares: the fetch to call (tests pass their own), a clock and a sleep (tests pass
// fake ones so pacing is checked without waiting), and the one error type the service turns into a MapsProblem.
import { t } from "@/lib/i18n";

export interface Net {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function makeNet(f?: typeof fetch, overrides: Partial<Omit<Net, "fetch">> = {}): Net {
  return {
    fetch: f ?? ((input, init) => fetch(input, init)),
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

/** The User-Agent every public service sees: the app's name only, nothing about the athlete. */
export const USER_AGENT = "C-LINK Desktop";

/** A problem the athlete can read; `status` is what the API answers with. */
export class RoutingProblem extends Error {
  constructor(message: string, readonly code = "routing", readonly status = 400) {
    super(message);
    this.name = "RoutingProblem";
  }
}

export const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** Network failures (fetch rejects with a TypeError) and timeouts, said plainly. */
export function asProblem(e: unknown, service: string): Error {
  if (e instanceof RoutingProblem) return e;
  if (isTimeout(e)) return new RoutingProblem(t("{service} took too long to answer. Try again.", { service }), "timeout", 504);
  if (e instanceof TypeError) return new RoutingProblem(t("Couldn't reach {service}. Check your internet connection.", { service }), "offline", 502);
  return e instanceof Error ? e : new Error(String(e));
}

/** Runs tasks one after another with at least `gapMs` between their starts (Nominatim, Overpass). */
export class Spacer {
  private last = Number.NEGATIVE_INFINITY;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly net: Net, private readonly gapMs: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const turn = this.chain.then(async () => {
      const wait = this.last + this.gapMs - this.net.now();
      if (wait > 0) await this.net.sleep(wait);
      this.last = this.net.now();
      return task();
    });
    this.chain = turn.then(() => undefined, () => undefined);
    return turn;
  }
}
