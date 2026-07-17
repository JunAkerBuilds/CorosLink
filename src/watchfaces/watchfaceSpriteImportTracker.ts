export class WatchfaceSpriteImportTracker {
  private nextId = 0;
  private readonly active = new Set<number>();
  private readonly sessionById = new Map<number, string>();
  private readonly targetById = new Map<number, string>();
  private readonly latestByTarget = new Map<string, number>();

  begin(target: string, sessionId: string): number {
    const importId = ++this.nextId;
    this.active.add(importId);
    this.sessionById.set(importId, sessionId);
    this.targetById.set(importId, target);
    this.latestByTarget.set(target, importId);
    return importId;
  }

  finish(importId: number): void {
    const target = this.targetById.get(importId);
    this.active.delete(importId);
    this.sessionById.delete(importId);
    this.targetById.delete(importId);
    if (target && this.latestByTarget.get(target) === importId) {
      this.latestByTarget.delete(target);
    }
  }

  isCurrent(importId: number, sessionId: string): boolean {
    const target = this.targetById.get(importId);
    if (!target) return false;
    return (
      this.active.has(importId) &&
      this.sessionById.get(importId) === sessionId &&
      this.latestByTarget.get(target) === importId
    );
  }

  get pendingCount(): number {
    return this.active.size;
  }
}
