// The app: the first-run intro and setup, the shell, and the screen for the current path. It is always signed in to
// the store on this computer (desktop/main/main.ts), so there is no sign-in screen.
import { lazy, Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingPage } from "@/components/training/LoadStates";
import { t } from "@/lib/i18n";
import { findRoute, pageTitle } from "./routes";
import { navigate, ParamsContext, useLocation } from "./router";
import { readDeveloper } from "./developer";
import { INTRO_SEEN, PRIVACY_PATH, PRIVACY_SEEN, readIntro } from "./welcome";
import { markWhatsNew, SHOW_WHATS_NEW, whatsNewDue } from "./whatsNew";

// The first-run intro and the move from CorosLink: full window, before the shell, loaded only when shown.
const Intro = lazy(() => import("./pages/Intro"));
const Move = lazy(() => import("./pages/Move"));
import { useFirstRun } from "./setup";
import { SETUP_PATH } from "./setupFlow";

// First-run setup fills the window, outside the shell (pages/Setup.tsx).
const Setup = lazy(() => import("./pages/Setup"));
// What's new, over the app once a release after an update (whatsNew.ts).
const WhatsNew = lazy(() => import("./parts/WhatsNew"));

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
  const [intro, setIntro] = useState<"checking" | "pending" | "privacy" | "seen">("checking");

  // First launch: the intro comes before anything else, until the athlete goes on to the app (main/settings.ts). An
  // install from before the privacy question gets that question alone, once.
  useEffect(() => {
    void readIntro().then((s) => setIntro((now) => (now === "checking" ? (s.intro ? "pending" : s.privacy ? "privacy" : "seen") : now)));
    const seen = () => setIntro("seen");
    // Answered inside the intro, the intro still has to be left; answered in its own window, that's all there was.
    const answered = () => setIntro((now) => (now === "privacy" ? "seen" : now));
    addEventListener(INTRO_SEEN, seen);
    addEventListener(PRIVACY_SEEN, answered);
    return () => { removeEventListener(INTRO_SEEN, seen); removeEventListener(PRIVACY_SEEN, answered); };
  }, []);
  useEffect(() => {
    if (intro === "pending" && !onWelcome) navigate("/welcome", { replace: true });
    if (intro === "privacy" && !onWelcome) navigate(PRIVACY_PATH, { replace: true });
  }, [intro, onWelcome]);
  // Setup comes after the intro: it waits until the athlete has left the intro (setup.ts).
  const firstRun = useFirstRun(intro === "seen", pathname);

  // What's new: once the app itself is up (not the intro, privacy window or setup), when this release's sheet hasn't
  // shown yet; Help → What's New… (`?whats-new`) and the Developer page open it any time.
  const [whatsNew, setWhatsNew] = useState(false);
  const inApp = intro === "seen" && firstRun !== "checking" && !onWelcome && pathname !== SETUP_PATH;
  useEffect(() => {
    if (!inApp) return;
    let live = true;
    const asked = new URLSearchParams(location.search).has("whats-new");
    if (asked) navigate(pathname, { replace: true });
    void (asked ? Promise.resolve(true) : whatsNewDue()).then((due) => { if (live && due) { setWhatsNew(true); void markWhatsNew(); } });
    return () => { live = false; };
    // Asked once the app is up; later pages don't ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp]);
  useEffect(() => {
    const show = () => setWhatsNew(true);
    addEventListener(SHOW_WHATS_NEW, show);
    return () => removeEventListener(SHOW_WHATS_NEW, show);
  }, []);

  useEffect(() => { document.title = found ? pageTitle(found.route) : "C-LINK"; }, [found]);

  if (onWelcome) return <Suspense fallback={<LoadingPage label="C-LINK" />}>{pathname === "/welcome/move" ? <Move /> : <Intro />}</Suspense>;
  if (intro !== "seen") return <LoadingPage label="C-LINK" />;
  if (firstRun === "checking") return <LoadingPage label="C-LINK" />;
  if (pathname === SETUP_PATH) return <Suspense fallback={<LoadingPage label="C-LINK" />}><Setup /></Suspense>;
  if (!found) {
    return <AppShell><main className="page"><div className="notice" role="alert">{t("There is no page at {path}.", { path: pathname })}</div></main></AppShell>;
  }
  const { route, params } = found;
  const Page = route.page;
  const screen = route.layouts.reduceRight(
    (children, layout) => { const Layout = layout.default; return <Layout>{children}</Layout>; },
    <Suspense fallback={<LoadingPage label={pageTitle(route)} />}><Page key={key} /></Suspense>,
  );
  return (
    <Suspense>
      <AppShell>
        <ParamsContext value={params}>{screen}</ParamsContext>
      </AppShell>
      {/* Never mistaken for the real thing: sample data says so on every screen. */}
      {whatsNew ? <Suspense fallback={null}><WhatsNew onClose={() => setWhatsNew(false)} /></Suspense> : null}
      {sample ? <a className="dev-sample-pill" href="/developer" onClick={(e) => { e.preventDefault(); navigate("/developer"); }}>{t("Sample data")}</a> : null}
    </Suspense>
  );
}
