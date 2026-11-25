// What Local mode drives (the TypeScript watch engine, engine/engine.ts) and what it answers with.
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type HelperEvent = { event: string; [key: string]: unknown };

/** Starts a process speaking the engine's JSON lines; tests give a fake one (lineDriver.ts). */
export type Spawner = () => ChildProcessWithoutNullStreams;

export class HelperProblem extends Error {}

/** What Local mode drives: the TypeScript engine, or a test's stand-in. */
export interface WatchDriver {
  readonly running: boolean;
  call<T>(cmd: string, fields?: Record<string, unknown>): Promise<T>;
  stop(): void;
}
