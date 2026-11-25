// `next/dynamic` for the desktop app: React.lazy with the loading placeholder in a Suspense boundary.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;

export default function dynamic<P extends object>(load: Loader<P>, options: { ssr?: boolean; loading?: () => ReactNode } = {}): ComponentType<P> {
  const Lazy = lazy(async () => {
    const mod = await load();
    return "default" in mod ? mod : { default: mod };
  });
  const Fallback = options.loading;
  return function Dynamic(props: P) {
    return <Suspense fallback={Fallback ? <Fallback /> : null}><Lazy {...props} /></Suspense>;
  };
}
