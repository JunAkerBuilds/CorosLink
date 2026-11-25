// The app: the first-run intro and setup, the shell, and the screen for the current path. It is always signed in to
// the store on this computer (desktop/main/main.ts), so there is no sign-in screen.
import { lazy, Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingPage } from "@/components/training/LoadStates";
import { findRoute } from "./routes";
import { navigate, ParamsContext, useLocation } from "./router";
import { readDeveloper } from "./developer";
import { INTRO_SEEN, introPending } from "./welcome";

// The first-run intro and the move from CorosLink: full window, before the shell, loaded only when shown.
const Intro = lazy(() => import("./pages/Intro"));
const Move = lazy(() => import("./pages/Move"));
import { useFirstRun } from "./setup";
import { SETUP_PATH } from "./setupFlow";

// First-run setup fills the window, outside the shell (pages/Setup.tsx).
const Setup = lazy(() => import("./pages/Setup"));

export function App() {
  const { pathname, key } = useLocation();
  const [sample, setSample] = useState(false);
  useEffect(() => {
    void readDeveloper().then(async (d) => {
      setSample(!!d?.sample);
      // Plans and workouts the page kept in its own storage move into this computer's store, once (never the sample athlete's).
      if (d && !d.sample && (await import("@/data/sync").then((s) => s.syncView()).catch(() => null))) (await import("@/data/local/fromBrowser")).moveFromBrowser();
    });
  }, []);
  const found = findRoute(pathname);
  const onWelcome = pathname === "/welcome" || pathname.startsWith("/welcome/");
  const [intro, setIntro] = useState<"checking" | "pending" | "seen">("checking");

  // First launch: the intro comes before anything else, until the athlete goes on to the app (main/settings.ts).
  useEffect(() => {
    void introPending().then((pending) => setIntro((now) => (now === "checking" ? (pending ? "pending" : "seen") : now)));
    const seen = () => setIntro("seen");
    addEventListener(INTRO_SEEN, seen);
    return () => removeEventListener(INTRO_SEEN, seen);
  }, []);
  useEffect(() => { if (intro === "pending" && !onWelcome) navigate("/welcome", { replace: true }); }, [intro, onWelcome]);
  // Setup comes after the intro: it waits until the athlete has left the intro (setup.ts).
  const firstRun = useFirstRun(intro === "seen", pathname);

  useEffect(() => { document.title = found?.route.title ?? "C-LINK"; }, [found]);

  if (onWelcome) return <Suspense fallback={<LoadingPage label="C-LINK" />}>{pathname === "/welcome/move" ? <Move /> : <Intro />}</Suspense>;
  if (intro !== "seen") return <LoadingPage label="C-LINK" />;
  if (firstRun === "checking") return <LoadingPage label="C-LINK" />;
  if (pathname === SETUP_PATH) return <Suspense fallback={<LoadingPage label="C-LINK" />}><Setup /></Suspense>;
  if (!found) {
    return <AppShell><main className="page"><div className="notice" role="alert">There is no page at {pathname}.</div></main></AppShell>;
  }
  const { route, params } = found;
  const Page = route.page;
  const screen = route.layouts.reduceRight(
    (children, layout) => { const Layout = layout.default; return <Layout>{children}</Layout>; },
    <Suspense fallback={<LoadingPage label={route.title} />}><Page key={key} /></Suspense>,
  );
  return (
    <Suspense>
      <AppShell>
        <ParamsContext value={params}>{screen}</ParamsContext>
      </AppShell>
      {/* Never mistaken for the real thing: sample data says so on every screen. */}
      {sample ? <a className="dev-sample-pill" href="/developer" onClick={(e) => { e.preventDefault(); navigate("/developer"); }}>Sample data</a> : null}
    </Suspense>
  );
}
