import { useCallback, useEffect, useRef, useState } from "react";
import type { CommunityWatchfaceCatalogPage, CommunityWatchfaceCatalogQuery } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

interface CatalogState {
  catalog: CommunityWatchfaceCatalogPage | null;
  loading: boolean;
  loadError: string | null;
  hasMore: boolean;
}

const INITIAL_STATE: CatalogState = { catalog: null, loading: true, loadError: null, hasMore: false };

/** Each filter selection owns its requests; late results cannot enter a new list. */
export function useCommunityWatchfaceCatalog(
  api: CorosLinkApi,
  { q, model, style, sort }: CommunityWatchfaceCatalogQuery
) {
  const [state, setState] = useState<CatalogState>(INITIAL_STATE);
  const requestRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let catalog: CommunityWatchfaceCatalogPage | null = null;
    let hasMore = true;
    setState(INITIAL_STATE);

    const request = async () => {
      if (cancelled || loading || !hasMore) return;
      loading = true;
      setState(current => ({ ...current, loading: true, loadError: null }));
      const page = (catalog?.pagination.page ?? 0) + 1;
      try {
        const next = await api.listCommunityWatchfaces({
          ...(q ? { q } : {}), ...(model ? { model } : {}), ...(style ? { style } : {}),
          sort, page, pageSize: 12
        });
        if (cancelled) return;
        // A changing catalog can clamp the page or repeat a face at a boundary.
        hasMore = next.items.length > 0 && next.pagination.page >= page &&
          next.pagination.page < next.pagination.pageCount;
        const items = new Map(catalog?.items.map(face => [face.id, face]));
        for (const face of next.items) items.set(face.id, face);
        catalog = { ...next, items: [...items.values()] };
        setState({ catalog, loading: false, loadError: null, hasMore });
      } catch (error) {
        if (!cancelled) setState({
          catalog, loading: false, hasMore,
          loadError: error instanceof Error ? error.message : "Could not load community faces."
        });
      } finally {
        loading = false;
      }
    };
    requestRef.current = request;
    void request();
    return () => {
      cancelled = true;
      requestRef.current = null;
    };
  }, [api, q, model, style, sort]);

  const loadMore = useCallback(() => { void requestRef.current?.(); }, []);
  return { ...state, loadMore };
}
