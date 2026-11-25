// The Community list on Studio's home, a page of 12 at a time. Rewritten from CorosLink's useCommunityWatchfaceCatalog:
// each filter choice owns its requests, so a late answer never lands in a newer list; coming back within 5 minutes
// reuses what was loaded; a catalog that can't sort by popularity falls back to newest.
import { useCallback, useEffect, useRef, useState } from "react";
import { listCommunity, said, type CommunityPage, type CommunityQuery } from "./studio";

type Sort = NonNullable<CommunityQuery["sort"]>;
interface Cached { page: CommunityPage; hasMore: boolean; sort: Sort; at: number }
export interface CommunityList { key?: string; page: CommunityPage | null; loading: boolean; error: string | null; hasMore: boolean; sort: Sort }

const FRESH_MS = 5 * 60 * 1000;
const cache = new Map<string, Cached>();
const remember = (key: string, entry: Cached) => {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > 24) cache.delete(cache.keys().next().value!);
};

/** Merges a new page into what's shown: a changing catalog can repeat a face at a page boundary. */
export function mergePage(shown: CommunityPage | null, next: CommunityPage): CommunityPage {
  const items = new Map(shown?.items.map((f) => [f.id, f]));
  for (const f of next.items) items.set(f.id, f);
  return { ...next, items: [...items.values()] };
}

/** More to load only while the catalog moved forward and has pages left (it can clamp the page). */
export const hasMoreAfter = (next: CommunityPage, asked: number) => next.items.length > 0 && next.pagination.page >= asked && next.pagination.page < next.pagination.pageCount;

const initial = (key: string, sort: Sort): CommunityList => {
  const c = cache.get(key);
  return c ? { key, page: c.page, loading: false, error: null, hasMore: c.hasMore, sort: c.sort } : { key, page: null, loading: true, error: null, hasMore: false, sort };
};

export function useCommunityList(q: CommunityQuery): CommunityList & { loadMore: () => void } {
  const sort: Sort = q.sort ?? "trending";
  const key = JSON.stringify([q.q ?? "", q.model ?? "", q.style ?? "", sort, q.view ?? "", q.group ?? ""]);
  const [state, setState] = useState<CommunityList>(() => initial(key, sort));
  const request = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false, busy = false;
    const cached = cache.get(key);
    let page = cached?.page ?? null, hasMore = cached?.hasMore ?? true, used: Sort = cached?.sort ?? sort;
    const load = async () => {
      if (cancelled || busy || !hasMore) return;
      busy = true;
      setState((s) => ({ ...(s.key === key ? s : initial(key, sort)), key, loading: true, error: null }));
      const asked = (page?.pagination.page ?? 0) + 1;
      const fetchPage = (s: Sort) => listCommunity({ ...q, sort: s, page: asked, pageSize: 12 });
      try {
        let next: CommunityPage;
        try { next = await fetchPage(used); } catch (e) {
          if (asked !== 1 || (used !== "trending" && used !== "downloads")) throw e;
          used = "newest";
          next = await fetchPage(used);
        }
        if (cancelled) return;
        hasMore = hasMoreAfter(next, asked);
        page = mergePage(page, next);
        remember(key, { page, hasMore, sort: used, at: Date.now() });
        setState({ key, page, loading: false, error: null, hasMore, sort: used });
      } catch (e) {
        if (!cancelled) setState({ key, page, loading: false, error: said(e), hasMore, sort: used });
      } finally {
        busy = false;
      }
    };
    request.current = load;
    if (!cached || Date.now() - cached.at > FRESH_MS) {
      // Stale: start over so removed faces drop out, while the old list stays on screen.
      if (cached) { page = null; hasMore = true; used = sort; }
      void load();
    }
    return () => { cancelled = true; request.current = null; };
    // The key stands for the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(() => { void request.current?.(); }, []);
  // A new query shows its own state at once (from the cache, or loading), never the last query's list.
  return { ...(state.key === key ? state : initial(key, sort)), loadMore };
}

/** "12.4k" */
export function downloads(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

/** Which of a face's watches to download: the chosen one when the face lists it, else its first. */
export function modelFor(models: string[], watchLabel: string): { model: string | undefined; fits: boolean } {
  const fits = models.some((m) => m.toUpperCase() === watchLabel.toUpperCase());
  return { model: fits ? models.find((m) => m.toUpperCase() === watchLabel.toUpperCase()) : models[0], fits };
}
