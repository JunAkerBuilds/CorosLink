import type { DataModeStore } from "./dataModeStore";
import type {
  DataMode,
  DataModeServiceFailure,
  DataModeStatus,
  LocalOnlyActivationOptions,
  NetworkAccessReport,
  PersistedDataMode
} from "./dataModeTypes";
import type { NetworkPolicy } from "./networkPolicy";

export interface CredentialActions {
  forgetCloudSession(): Promise<void> | void;
  forgetWatchKey(): Promise<void> | void;
}

export interface DataModeServiceOptions {
  store: DataModeStore;
  policy: NetworkPolicy;
  initial: PersistedDataMode;
  /** Restarts the app; leaving Local-Only Mode always relaunches. */
  relaunch: () => void;
}

type StatusListener = (status: DataModeStatus) => void;

export class DataModeService {
  private persisted: PersistedDataMode;
  private phase: DataModeStatus["phase"];
  private failedServices: DataModeServiceFailure[] = [];
  private readonly listeners = new Set<StatusListener>();
  private credentials?: CredentialActions;
  private transition?: Promise<DataModeStatus>;

  constructor(private readonly options: DataModeServiceOptions) {
    this.persisted = options.initial;
    this.phase = options.initial.mode === "local_only" ? "active" : "connected";
    options.policy.onAttempt(() => this.emit());
  }

  get mode(): DataMode { return this.persisted.mode; }
  get isLocalOnly(): boolean { return this.persisted.mode === "local_only"; }

  setCredentialActions(actions: CredentialActions): void {
    this.credentials = actions;
  }

  status(): DataModeStatus {
    return {
      mode: this.persisted.mode,
      phase: this.phase,
      enforcing: this.options.policy.enforcing,
      changedAt: this.persisted.changedAt,
      ...(this.persisted.recovered ? { recovered: true } : {}),
      failedServices: this.failedServices.map(failure => ({ ...failure })),
      blockedAttempts: this.options.policy.blockedCount
    };
  }

  report(now = Date.now()): NetworkAccessReport {
    return { generatedAt: now, status: this.status(), attempts: this.options.policy.recentAttempts() };
  }

  onChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Enter Local-Only Mode:
   * 1. block uploads to COROS at once and abort uploads in flight,
   * 2. persist `local_only` (a crash from here on restarts in Local-Only Mode),
   * 3. forget the saved credentials the user chose to remove,
   * 4. report the mode as active.
   * Nothing in CorosLink uploads to COROS on its own, so there is no job to stop.
   * A failed save or credential clean-up leaves the mode enforced but `degraded`.
   */
  activateLocalOnly(options: LocalOnlyActivationOptions = {}): Promise<DataModeStatus> {
    if (this.transition) return this.transition;
    if (this.persisted.mode === "local_only" && this.phase === "active") return Promise.resolve(this.status());
    this.transition = this.runActivation({ retainWatchKey: options.retainWatchKey !== false, forgetCloudSession: options.forgetCloudSession === true })
      .finally(() => { this.transition = undefined; });
    return this.transition;
  }

  private async runActivation(options: LocalOnlyActivationOptions): Promise<DataModeStatus> {
    this.phase = "activating";
    this.options.policy.enforce();
    this.emit();

    const failed: DataModeServiceFailure[] = [];
    try {
      this.persisted = this.options.store.save("local_only");
    } catch (error) {
      // Enforced for this run either way; without the file a restart would come back connected.
      failed.push({ id: "persist", label: "Saving Local-Only Mode", error: error instanceof Error ? error.message : String(error) });
    }
    try {
      if (options.forgetCloudSession) await this.credentials?.forgetCloudSession();
      if (options.retainWatchKey === false) await this.credentials?.forgetWatchKey();
    } catch (error) {
      failed.push({ id: "credentials", label: "Saved credentials", error: error instanceof Error ? error.message : String(error) });
    }

    this.failedServices = failed.sort((left, right) => left.id.localeCompare(right.id));
    this.phase = failed.length ? "degraded" : "active";
    this.emit();
    return this.status();
  }

  /**
   * Leave Local-Only Mode. The caller has already obtained explicit
   * confirmation. The process-wide guards are never relaxed in place:
   * Connected Mode is persisted and CorosLink relaunches without them.
   */
  async returnToConnected(): Promise<DataModeStatus> {
    if (this.transition) await this.transition.catch(() => undefined);
    if (this.persisted.mode === "connected" && !this.options.policy.enforcing) return this.status();
    this.persisted = this.options.store.save("connected");
    this.phase = "restart-required";
    this.emit();
    this.options.relaunch();
    return this.status();
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      try { listener(status); } catch { /* a listener never breaks the lifecycle */ }
    }
  }
}
