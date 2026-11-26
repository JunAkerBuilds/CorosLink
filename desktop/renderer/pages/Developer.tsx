// Developer: sample data instead of what's on this computer, and developer mode itself. Also in the menu bar
// (C-LINK → Developer Mode, and the Developer menu).
import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Card, PageHead, Switch } from "@/components/ui";
import { changeDeveloper, readDeveloper, type DeveloperState } from "../developer";
import { replayIntro } from "../welcome";
import { navigate } from "../router";
import { startPreview } from "../updates";
import { t } from "@/lib/i18n";

// Activity screens for PACE Pro (experimental): loaded only here, and shown only where the main process allows it.
const ActivityScreens = lazy(() => import("../parts/ActivityScreens"));

export default function Developer() {
  const [state, setState] = useState<DeveloperState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void readDeveloper().then(setState); }, []);

  const change = (c: Parameters<typeof changeDeveloper>[0], then?: string) => { setBusy(true); void changeDeveloper(c, then); };

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <PageHead title={t("Developer")} />
      {!state ? null : !state.devMode ? (
        <Card pad style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Setup's "Just look around" turns sample data on without developer mode: it's turned off here. */}
          {state.sample ? (
            <Row title={t("Sample data")} detail={t("Showing the sample athlete. Turn it off to see your own data.")}>
              <Switch label={t("Sample data")} checked disabled={busy} onChange={() => change({ sample: false }, "/")} />
            </Row>
          ) : null}
          <p style={{ margin: 0 }}>{t("Developer mode is off.")}</p>
          <div><Button disabled={busy} onClick={() => change({ devMode: true })}>{t("Turn on developer mode")}</Button></div>
        </Card>
      ) : (
        <>
          <Card pad style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Row title={t("Sample data")} detail={state.sample
              ? (state.sampleItems != null
                ? t("Showing the sample athlete ({n} items). Your own data and your phones' syncing are untouched.", { n: state.sampleItems })
                : t("Showing the sample athlete. Your own data and your phones' syncing are untouched."))
              : t("Show the sample athlete instead of your data. Your data stays as it is, and phones keep syncing to it.")}>
              <Switch label={t("Sample data")} checked={state.sample} disabled={busy} onChange={(on) => change({ sample: on })} />
            </Row>
            {state.sample ? (<>
              <hr style={{ margin: 0, border: 0, borderTop: "1px solid var(--line)" }} />
              <Row title={t("Reset sample data")} detail={t("The sample athlete again, with today's dates. Changes made to the sample are lost.")}>
                <Button disabled={busy} onClick={() => change({ resetSample: true })}>{t("Reset")}</Button>
              </Row>
            </>) : null}
          </Card>
          <Suspense fallback={null}><ActivityScreens /></Suspense>
          <Card pad style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Row title={t("First-run intro")} detail={t("The intro and Bring over my CorosLink data, as a new install shows them. CLINK_INTRO=1 does the same at launch.")}>
              <Button disabled={busy} onClick={() => void replayIntro()}>{t("Show again")}</Button>
            </Row>
            <Row title={t("First-run setup")} detail={t("Walk through setup again, as on a new install. What you pick there changes your settings.")}>
              <Button onClick={() => navigate("/setup")}>{t("Run setup")}</Button>
            </Row>
            <Row title={t("Update prompt")} detail={t("A made-up update in the prompt and the account menu's Updates, to see them in a development build. Nothing is downloaded or installed.")}>
              <Button onClick={startPreview}>{t("Preview")}</Button>
            </Row>
          </Card>
          <Card pad style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Row title={t("Developer mode")} detail={t("This page, the Developer menu and the developer tools. Turning it off also turns sample data off.")}>
              <Switch label={t("Developer mode")} checked disabled={busy} onChange={() => change({ devMode: false }, "/")} />
            </Row>
          </Card>
        </>
      )}
    </main>
  );
}

function Row({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <strong style={{ fontSize: 15 }}>{title}</strong>
        <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{detail}</span>
      </div>
      {children}
    </div>
  );
}
