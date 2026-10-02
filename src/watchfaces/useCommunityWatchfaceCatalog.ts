import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommunityWatchfaceCatalogPage,
  CommunityWatchfaceCatalogQuery,
  CommunityWatchfaceSort
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

interface CatalogState {
  catalog: CommunityWatchfaceCatalogPage | null;
  loading: boolean;
  loadError: string | null;
  hasMore: boolean;
  /** The sort the catalog actually used when the requested one is unsupported. */
  effectiveSort: CommunityWatchfaceSort;
}

interface CachedCatalog {
  catalog: CommunityWatchfaceCatalogPage;
  hasMore: boolean;
  effectiveSort: CommunityWatchfaceSort;
  fetchedAt: number;
}

/** Re-entering the tab within this window reuses the loaded pages. */
const CATALOG_CACHE_FRESH_MS = 5 * 60 * 1000;
const MAX_CACHED_QUERIES = 24;
const catalogCache = new Map<string, CachedCatalog>();

function rememberCatalog(key: string, entry: CachedCatalog) {
  catalogCache.delete(key);
  catalogCache.set(key, entry);
  while (catalogCache.size > MAX_CACHED_QUERIES) {
    catalogCache.delete(catalogCache.keys().next().value!);
  }
}

/** Older catalog servers only sort by newest and title. */
function isPopularitySort(sort: CommunityWatchfaceSort | undefined): boolean {
  return sort === "trending" || sort === "downloads";
}

/** Each filter selection owns its requests; late results cannot enter a new list. */
export function useCommunityWatchfaceCatalog(
  api: CorosLinkApi,
  { q, model, style, sort = "newest", view, group }: CommunityWatchfaceCatalogQuery
) {
  const key = JSON.stringify([q ?? "", model ?? "", style ?? "", sort, view ?? "", group ?? ""]);
  const [state, setState] = useState<CatalogState>(() => initialState(key, sort));
  const requestRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const cached = catalogCache.get(key);
    let catalog: CommunityWatchfaceCatalogPage | null = cached?.catalog ?? null;
    let hasMore = cached?.hasMore ?? true;
    let effectiveSort: CommunityWatchfaceSort = cached?.effectiveSort ?? sort;
    setState(initialState(key, sort));

    const request = async () => {
      if (cancelled || loading || !hasMore) return;
      loading = true;
      setState(current => ({ ...current, loading: true, loadError: null }));
      const page = (catalog?.pagination.page ?? 0) + 1;
      const fetchPage = (pageSort: CommunityWatchfaceSort) =>
        api.listCommunityWatchfaces({
          ...(q ? { q } : {}), ...(model ? { model } : {}), ...(style ? { style } : {}),
          ...(view ? { view } : {}), ...(group ? { group } : {}),
          sort: pageSort, page, pageSize: 12
        });
      try {
        let next: CommunityWatchfaceCatalogPage;
        try {
          next = await fetchPage(effectiveSort);
        } catch (error) {
          if (page !== 1 || !isPopularitySort(effectiveSort)) throw error;
          effectiveSort = "newest";
          next = await fetchPage(effectiveSort);
        }
        if (cancelled) return;
        // A changing catalog can clamp the page or repeat a face at a boundary.
        hasMore = next.items.length > 0 && next.pagination.page >= page &&
          next.pagination.page < next.pagination.pageCount;
        const items = new Map(catalog?.items.map(face => [face.id, face]));
        for (const face of next.items) items.set(face.id, face);
        catalog = { ...next, items: [...items.values()] };
        rememberCatalog(key, { catalog, hasMore, effectiveSort, fetchedAt: Date.now() });
        setState({ catalog, loading: false, loadError: null, hasMore, effectiveSort });
      } catch (error) {
        if (!cancelled) setState({
          catalog, loading: false, hasMore, effectiveSort,
          loadError: error instanceof Error ? error.message : "Could not load community faces."
        });
      } finally {
        loading = false;
      }
    };
    requestRef.current = request;
    if (!cached || Date.now() - cached.fetchedAt > CATALOG_CACHE_FRESH_MS) {
      if (cached) {
        // Stale: start over so removed faces drop out, but keep showing the old list.
        catalog = null;
        hasMore = true;
        effectiveSort = sort;
      }
      void request();
    }
    return () => {
      cancelled = true;
      requestRef.current = null;
    };
  }, [api, key]);

  const loadMore = useCallback(() => { void requestRef.current?.(); }, []);
  return { ...state, loadMore };
}

function initialState(key: string, sort: CommunityWatchfaceSort): CatalogState {
  const cached = catalogCache.get(key);
  return cached
    ? {
        catalog: cached.catalog,
        loading: false,
        loadError: null,
        hasMore: cached.hasMore,
        effectiveSort: cached.effectiveSort
      }
    : { catalog: null, loading: true, loadError: null, hasMore: false, effectiveSort: sort };
}
