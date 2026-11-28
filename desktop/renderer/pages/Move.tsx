// "Bring everything with you": CorosLink's data, picked tile by tile and copied into C-LINK (main/coroslink/move.ts).
// Three stages on one screen: pick, copying (Coach runs along the track), done (with what needs the athlete and
// where CorosLink's pages went). Full window, after the intro.
import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/shell/BrandMark";
import { Button, Switch } from "@/components/ui";
import { dateText, language, locale, msg, t, tx } from "@/lib/i18n";
import { computerWord } from "../computer";
import { navigate } from "../router";
import { changeSetup } from "../setup";
import { formatBytes, leaveIntro, moveProgress, readMove, startMove, type MoveJob, type MoveSurvey, type Tile, type TileId } from "../welcome";
import "../parts/localMode.css";
import "./move.css";

type Hue = "mint" | "violet" | "gold" | "blue" | "rose";
const LOOK: Record<TileId, { hue: Hue; d: string }> = {
  acts: { hue: "mint", d: "M3 12h4l3-8 4 16 3-8h4" },
  health: { hue: "violet", d: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" },
  plans: { hue: "gold", d: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  lift: { hue: "blue", d: "M4 9v6M7.5 6.5v11M16.5 6.5v11M20 9v6M7.5 12h9" },
  coach: { hue: "mint", d: "M5 5h14v10.5h-8.5L5 20z" },
  watch: { hue: "violet", d: "M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z" },
  phones: { hue: "blue", d: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2" },
  faces: { hue: "gold", d: "M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM9.4 7.7l.8-4.2h3.6l.8 4.2M9.4 16.3l.8 4.2h3.6l.8-4.2" },
  routes: { hue: "mint", d: "M6 19a2 2 0 1 0 0-.01M18 5a2 2 0 1 0 0 .01M6 17V9a4 4 0 0 1 4-4h2M18 7v8a4 4 0 0 1-4 4h-2" },
  links: { hue: "blue", d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },
  cals: { hue: "violet", d: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  media: { hue: "rose", d: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z" },
  prefs: { hue: "gold", d: "M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.4-1.4M5.6 18.4L7 17M17 17l1.4 1.4M5.6 5.6L7 7" },
};
/** What a tile C-LINK can't take asks of the athlete once the rest is here. */
const AGAIN: Partial<Record<TileId, string>> = { watch: msg("Pair again"), phones: msg("Pair again"), links: msg("Sign in again") };
/** CorosLink's pages and where they are in C-LINK, translated where shown. */
const MAP: [string, string][] = [
  [msg("Overview"), msg("Dashboard")], ["Training Hub", msg("Activities")], [msg("Training Library"), msg("Calendar")],
  [msg("Watch Faces"), msg("Studio")], [msg("Maps"), msg("Routes")], [msg("Data"), msg("Settings")],
];

function Icon({ d, size = 18, width = 2 }: { d: string; size?: number; width?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

/** "Today, 09:12", "Yesterday, 21:14", or "Nov 3, 21:14". */
function when(iso: string | null): string {
  if (!iso) return t("Unknown");
  const at = new Date(iso), now = new Date();
  const tag = language() === "en" ? [] : locale();
  const time = at.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(at.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return t("Today, {time}", { time });
  if (days === 1) return t("Yesterday, {time}", { time });
  return t("{date}, {time}", { date: dateText(at, tag, { month: "short", day: "numeric" }), time });
}

interface TileView { state: "pick" | "wait" | "going" | "done" | "attn" | "left"; label: string; pct: number; detail: string }

function tileView(tile: Tile, job: MoveJob | null, stage: "pick" | "moving" | "done"): TileView {
  const base = { pct: 0, detail: tile.detail };
  if (stage === "pick") return { ...base, state: "pick", label: "" };
  const p = job?.tiles[tile.id];
  if (!p) {
    if (stage === "done" && !tile.ready && AGAIN[tile.id] && tile.figure !== "0" && tile.figure !== "None") return { ...base, state: "attn", label: t(AGAIN[tile.id]!) };
    return { ...base, state: "left", label: tile.ready ? t("Left out") : tile.instead === "coros" ? t("From COROS") : tx("not ready", "Not yet") };
  }
  if (p.state === "done") return { state: "done", label: `✓ ${tx("status", "Done")}`, pct: 100, detail: p.note ?? tile.detail };
  if (p.state === "attn") return { state: "attn", label: AGAIN[tile.id] ? t(AGAIN[tile.id]!) : t("Needs you"), pct: 100, detail: p.note ?? tile.detail };
  if (p.state === "failed") return { state: "attn", label: t("Didn't copy"), pct: p.pct, detail: p.note ?? tile.detail };
  if (p.state === "going") return { state: "going", label: `${p.pct}%`, pct: p.pct, detail: tile.detail };
  return { ...base, state: "wait", label: t("Waiting") };
}


/** After a move from CorosLink the app is already full of the athlete's data, so setup is not shown on top of it. */
async function movedIn(): Promise<void> {
  await changeSetup({ setupDone: true }).catch(() => undefined);
  await leaveIntro("/");
}

export default function Move() {
  const [survey, setSurvey] = useState<MoveSurvey | null | "missing">(null);
  const [on, setOn] = useState<Partial<Record<TileId, boolean>>>({});
  const [job, setJob] = useState<MoveJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** When progress was last read, for the time left. */
  const [readAt, setReadAt] = useState(0);

  useEffect(() => {
    document.title = `${t("Bring your data")} · C-LINK`;
    void readMove().then((s) => {
      if (!s?.found) { setSurvey("missing"); return; }
      setSurvey(s);
      setOn(Object.fromEntries((s.tiles ?? []).map((tile) => [tile.id, tile.on])));
      if (s.job) setJob(s.job);
    });
  }, []);
  useEffect(() => { if (survey === "missing") navigate("/welcome?scene=5", { replace: true }); }, [survey]);

  const moving = job?.stage === "moving";
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => { void moveProgress().then((j) => { if (j) { setJob(j); setReadAt(Date.now()); } }); }, 400);
    return () => clearInterval(timer);
  }, [moving]);

  const tiles = useMemo(() => (survey && survey !== "missing" ? survey.tiles ?? [] : []), [survey]);
  if (!survey || survey === "missing") return <div className="ground mx-ground" />;

  const stage: "pick" | "moving" | "done" = !job ? "pick" : job.stage;
  const picked = tiles.filter((tile) => tile.ready && on[tile.id]);
  const pickedBytes = picked.reduce((sum, tile) => sum + (survey.bytes?.[tile.id] ?? 0), 0);
  const pct = stage === "done" ? 100 : job?.pct ?? 0;
  const counts = survey.counts ?? { activities: 0, healthDays: 0, chats: 0, faces: 0 };
  const views = tiles.map((tile) => ({ tile, view: tileView(tile, job, stage) }));
  const needs = views.filter((v) => v.view.state === "attn").length;
  const brought = job ? Object.values(job.tiles).filter((tile) => tile?.state === "done").length : 0;
  const minutesLeft = (() => {
    if (!job || !pct || !readAt) return null;
    const spent = readAt - Date.parse(job.startedAt);
    return Math.max(1, Math.round((spent * (100 - pct)) / pct / 60_000));
  })();

  const start = async () => {
    setError(null);
    const started = await startMove(picked.map((tile) => tile.id)).catch(() => null);
    if (started) setJob(started);
    else setError(t("The copy didn't start. Try again."));
  };

  const coach = stage === "moving"
    ? { img: "/img/coach-search.webp", line: job?.tiles.acts?.state === "going" ? t("Packing your workouts. This is the fun part.") : t("Bringing it over. This is the fun part.") }
    : stage === "done"
      ? { img: "/img/coach-cheer.webp", line: needs ? (needs === 1 ? t("All here! One thing needs you.") : t("All here! {n} things need you.", { n: needs })) : t("All here!") }
      : { img: "/img/coach-cheer.webp", line: t("You've been busy! Leave these on and I'll bring them over.") };

  return (
    <div className="ground mx-ground">
      <div className="mx" data-stage={stage}>
        <header className="mx-top"><span className="mx-brand"><BrandMark />C-LINK</span></header>

        <section className="mx-hero" aria-labelledby="mx-title">
          <div>
            <span className="mx-kicker">{stage === "pick" ? t("From CorosLink") : stage === "moving" ? t("Moving in") : t("Moved in")}</span>
            <h1 id="mx-title">
              {stage === "pick" ? t("Bring everything") : stage === "moving" ? t("Bringing it") : t("Everything’s")}<br />
              <span>{stage === "pick" ? t("with you.") : stage === "moving" ? t("all over.") : t("here.")}</span>
            </h1>
          </div>
          {stage !== "moving" ? (<>
            <div className="mx-swap" aria-hidden="true"><span className="mx-app" data-old="">CL</span><span className="mx-dash"><i /><i /><i /></span><span className="mx-app" data-new=""><img src="/img/clink-mark.png" alt="" width={53} height={58} /></span></div>
            <div className="mx-big">
              <div><b>{counts.activities.toLocaleString(locale("en-US"))}</b><span>{t("activities")}</span></div>
              <div><b>{counts.healthDays.toLocaleString(locale("en-US"))}</b><span>{t("days of sleep and health")}</span></div>
              <div><b>{counts.chats.toLocaleString(locale("en-US"))}</b><span>{t("Coach chats")}</span></div>
              <div><b>{counts.faces.toLocaleString(locale("en-US"))}</b><span>{t("watch faces")}</span></div>
            </div>
          </>) : (<>
            <span />
            <div className="mx-track" role="status" aria-label={t("{pct}% brought over", { pct })}>
              <span className="mx-pct">{pct}%</span>
              <span className="mx-track-line"><i style={{ width: `${pct}%` }} /></span>
              <span className="mx-runner" style={{ left: `${pct}%` }}>
                <span className="mx-sprite" role="img" aria-label={t("Coach running")}><img src="/img/coach-run.webp" alt="" /></span>
              </span>
            </div>
          </>)}
        </section>

        <div className="mx-body">
          <div className="mx-grid">
            {views.map(({ tile, view }) => {
              const checked = tile.ready && !!on[tile.id];
              return (
                <div key={tile.id} className="mx-tile" data-on={stage === "pick" && checked ? "" : undefined} data-off={(stage === "pick" ? !checked : view.state === "left") ? "" : undefined} data-attn={view.state === "attn" ? "" : undefined}>
                  <div className="mx-tile-top">
                    <span className="lm-ico" data-hue={LOOK[tile.id].hue} aria-hidden="true"><Icon d={LOOK[tile.id].d} /></span>
                    {stage === "pick"
                      ? <Switch label={tile.label} checked={checked} disabled={!tile.ready} onChange={(next) => setOn((o) => ({ ...o, [tile.id]: next }))} />
                      : <span className="mx-state" data-s={view.state}>{view.label}</span>}
                  </div>
                  <strong>{tile.label}</strong>
                  <p>{view.detail}</p>
                  <div className="mx-tile-foot"><b>{tile.figure}</b></div>
                  {view.state === "going" ? <span className="lm-step-bar" aria-hidden="true"><i style={{ width: `${view.pct}%` }} /></span> : null}
                </div>
              );
            })}
          </div>

          <aside className="mx-side">
            <div className="mx-coach"><img src={coach.img} alt="" width={72} height={72} /><div className="mx-bubble" role="status">{coach.line}</div></div>
            {stage === "pick" ? (<>
              <div className="card mx-box">
                <h3>{t("Found on this {computer}", { computer: computerWord() })}</h3>
                <div className="mx-fig"><span>CorosLink</span><strong>{survey.found?.version ?? t("Installed")}</strong></div>
                <div className="mx-fig"><span>{t("Last opened")}</span><strong>{when(survey.found?.lastOpened ?? null)}</strong></div>
                {survey.found?.free != null ? <div className="mx-fig"><span>{t("Free on this {computer}", { computer: computerWord() })}</span><strong>{formatBytes(survey.found.free)}</strong></div> : null}
              </div>
              <div className="card mx-box">
                <span className="lm-done" style={{ alignSelf: "flex-start" }}><Icon d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" size={14} />{t("A copy, not a move")}</span>
                <p>{t("CorosLink's folder isn't changed. If anything looks wrong, you can still open it.")}</p>
              </div>
            </>) : stage === "moving" ? (
              <div className="card mx-box">
                <h3>{minutesLeft ? t("About {n} min left", { n: minutesLeft }) : t("Starting")}</h3>
                <p>{t("Keep using your {computer}. Leave C-LINK open until it's done; closing it pauses, nothing is lost.", { computer: computerWord() })}</p>
              </div>
            ) : (
              <div className="card mx-box">
                <h3>{t("Where things moved")}</h3>
                <div className="mx-map">
                  {MAP.map(([from, to]) => <div key={from}><span>{t(from)}</span><Icon d="M5 12h14M13 6l6 6-6 6" size={16} /><span>{t(to)}</span></div>)}
                </div>
              </div>
            )}
          </aside>
        </div>

        <div className="mx-bar">
          <div className="mx-bar-text">
            {stage === "pick" ? (<>
              <strong>{t("{n} of {total} picked", { n: picked.length, total: tiles.length })}{pickedBytes ? ` · ${formatBytes(pickedBytes)}` : ""}</strong>
              <span>{error ?? t("You can keep using your {computer} while it copies.", { computer: computerWord() })}</span>
            </>) : stage === "moving" ? (<>
              <strong>{job?.bytes ? t("Copying {size} from CorosLink", { size: formatBytes(job.bytes) }) : t("Copying your data from CorosLink")}</strong>
              <span>{t("You can keep using C-LINK while it works")}</span>
            </>) : (<>
              <strong>{!needs ? t("{n} brought over.", { n: brought }) : needs === 1 ? t("{n} brought over, 1 needs you.", { n: brought }) : t("{n} brought over, {needs} need you.", { n: brought, needs })}</strong>
              <span>{t("CorosLink is untouched if you ever need it")}</span>
            </>)}
          </div>
          <span className="mx-grow" />
          {stage === "pick" ? (<>
            <Button className="mx-btn" onClick={() => void leaveIntro("/setup")}>{t("Start fresh instead")}</Button>
            <Button variant="primary" className="mx-btn" disabled={!picked.length} onClick={() => void start()}>{t("Bring it over")}<Icon d="M5 12h14M13 6l6 6-6 6" /></Button>
          </>) : stage === "moving" ? (
            <Button className="mx-btn" onClick={() => void movedIn()}>{t("Run in the background")}</Button>
          ) : (
            <Button variant="primary" className="mx-btn" onClick={() => void movedIn()}>{t("Open Dashboard")}<Icon d="M5 12h14M13 6l6 6-6 6" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}
