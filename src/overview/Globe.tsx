import GlobeKapsule, { type ConfigOptions, type GlobeInstance } from "globe.gl";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { GlobeMethods, GlobeProps } from "react-globe.gl";

// Same lists react-globe.gl passes to react-kapsule.
const INIT_PROP_NAMES: readonly string[] = [
  "animateIn",
  "waitForGlobeReady",
  "rendererConfig",
];
const METHOD_NAMES = [
  "pauseAnimation",
  "resumeAnimation",
  "pointOfView",
  "lights",
  "scene",
  "camera",
  "renderer",
  "postProcessingComposer",
  "controls",
  "getGlobeRadius",
  "getCoords",
  "getScreenCoords",
  "toGeoCoords",
  "toGlobeCoords",
  "globeTileEngineClearCache",
] as const satisfies readonly (keyof GlobeMethods)[];

type GlobeComp = GlobeInstance & ((element: HTMLElement) => GlobeInstance);
type KapsuleMember = ((...args: unknown[]) => unknown) | undefined;

// Called without `new`, a kapsule returns an instance that attaches to the DOM
// later, so every prop is in place before globe.gl first renders.
const createGlobe = GlobeKapsule as unknown as (config: ConfigOptions) => GlobeComp;

function member(instance: GlobeComp, name: string): KapsuleMember {
  return (instance as unknown as Record<string, KapsuleMember>)[name];
}

/**
 * Drop-in for react-globe.gl's <Globe>. Its react-kapsule wrapper builds the
 * instance in useMemo, which StrictMode calls twice in development; the spare
 * globe starts three-globe's animation loop and its layer tickers in its
 * constructor and is never destroyed, so every mount leaked a set of
 * requestAnimationFrame loops until reload. Creating the instance in an effect
 * lets StrictMode's mount → unmount → mount check destroy the first one.
 */
export const Globe = forwardRef<GlobeMethods | undefined, GlobeProps>(
  function Globe(props, ref) {
    const elementRef = useRef<HTMLDivElement>(null);
    const instanceRef = useRef<GlobeComp | null>(null);
    const appliedRef = useRef(new Map<string, unknown>());

    // Declared first so the ref is live before the globe can fire onGlobeReady.
    useImperativeHandle(
      ref,
      () =>
        Object.fromEntries(
          METHOD_NAMES.map((name) => [
            name,
            (...args: unknown[]) => {
              const instance = instanceRef.current;
              return instance ? member(instance, name)?.apply(instance, args) : undefined;
            },
          ]),
        ) as unknown as GlobeMethods,
      [],
    );

    // Create on first commit, then forward only the props that changed.
    useLayoutEffect(() => {
      const element = elementRef.current;
      if (!element) {
        return;
      }
      const applied = appliedRef.current;
      let instance = instanceRef.current;
      const created = !instance;
      if (!instance) {
        const config = Object.fromEntries(
          INIT_PROP_NAMES.filter((name) => name in props).map((name) => [
            name,
            props[name as keyof GlobeProps],
          ]),
        );
        instance = createGlobe(config);
        instanceRef.current = instance;
        applied.clear();
      }
      for (const [name, value] of Object.entries(props)) {
        if (
          INIT_PROP_NAMES.includes(name) ||
          (applied.has(name) && applied.get(name) === value)
        ) {
          continue;
        }
        applied.set(name, value);
        member(instance, name)?.call(instance, value);
      }
      if (created) {
        instance(element);
      }
    });

    useLayoutEffect(
      () => () => {
        instanceRef.current?._destructor();
        instanceRef.current = null;
      },
      [],
    );

    return <div ref={elementRef} />;
  },
);
