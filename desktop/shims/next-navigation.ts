// `next/navigation` for the desktop app, on top of the in-app router.
import { useMemo } from "react";
import { back, navigate, useLocation, useRouteParams } from "../renderer/router";

export interface AppRouter {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(href: string): void;
}

const router: AppRouter = {
  push: (href, o) => navigate(href, { scroll: o?.scroll }),
  replace: (href, o) => navigate(href, { replace: true, scroll: o?.scroll }),
  back,
  forward: () => history.forward(),
  refresh: () => navigate(location.pathname + location.search, { replace: true, scroll: false, reload: true }),
  prefetch: () => {},
};

export function useRouter(): AppRouter {
  return router;
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRouteParams() as T;
}

export function redirect(href: string): never {
  navigate(href, { replace: true });
  throw new Error(`redirect to ${href}`);
}

export function notFound(): never {
  throw new Error("not found");
}
