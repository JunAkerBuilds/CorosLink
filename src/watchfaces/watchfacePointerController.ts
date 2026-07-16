/** Coalesces arbitrary pointer samples into at most one paint per animation frame. */
export class WatchfacePointerController<T> {
  private pending: T | null = null;
  private frame: number | null = null;

  constructor(private readonly paint: (sample: T) => void) {}

  schedule(sample: T): void {
    this.pending = sample;
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      const latest = this.pending;
      this.pending = null;
      if (latest) this.paint(latest);
    });
  }

  updatePending(update: (sample: T) => T): void {
    if (this.pending) this.pending = update(this.pending);
  }

  flush(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    const latest = this.pending;
    this.pending = null;
    if (latest) this.paint(latest);
  }

  cancel(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }
}
