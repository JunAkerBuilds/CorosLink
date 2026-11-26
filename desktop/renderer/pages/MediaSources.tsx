// Media's music services (from the design's MediaSources board): Spotify, YouTube Music and Apple Music show their
// playlists and download songs into the Library; Podcasts finds shows and downloads episodes, or splits a long one
// into short parts in Audiobooks. Downloads land in the Library, ready to send to the watch.
import { useEffect, useState } from "react";
import { Button, Card, Field, Switch } from "@/components/ui";
import { createStore, useStore } from "@/data/local/store";
import { locale, msg, t } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import {
  cancelDownloads, clearDownloads, connectSource, disconnectSource, downloadEpisode, downloadSongs, MediaProblem, readDownloads,
  combineSongs, lockSpotify, readPlaylists, readShow, readSongs, readTools, searchPodcasts, setSpotifyClient, songsState, sourceStatus, splitEpisode, unlockSpotify,
  type CombinedState, type DownloadJob, type Episode, type JobLine, type Playlist, type Show, type ShowDetail, type Song, type SourceName, type SourceStatus, type Tools,
} from "../media";
import { booksTabStore } from "../mediaBooks";
import { tabStore } from "../mediaInput";
import { clock } from "../mediaRows";

const said = (e: unknown) => (e instanceof MediaProblem || e instanceof Error ? e.message : t("That didn't work."));
const LABEL: Record<SourceName, string> = { spotify: "Spotify", ytmusic: "YouTube Music", apple: "Apple Music" };
/** "Send to watch when downloaded", remembered per service. */
const toWatchStore = createStore<Partial<Record<SourceName, boolean>>>("media.toWatch", {});

/** Polls the downloads while any is waiting or working. */
export function useDownloads(): [DownloadJob[], (jobs: DownloadJob[]) => void] {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const busy = jobs.some((j) => j.state === "waiting" || j.state === "working");
  useEffect(() => {
    let live = true;
    const read = () => readDownloads().then((d) => { if (live) setJobs(d.jobs); }, () => {});
    void read();
    const timer = setInterval(read, busy ? 1000 : 4000);
    return () => { live = false; clearInterval(timer); };
  }, [busy]);
  return [jobs, setJobs];
}

export function useTools(): Tools | null {
  const [tools, setTools] = useState<Tools | null>(null);
  useEffect(() => { void readTools().then(setTools, () => {}); }, []);
  return tools;
}

export const NeedsYtDlp = () => (
  <p className="notice" role="status">{tr("Downloading songs needs yt-dlp on this computer. Install it with {command}, then open this page again.", { command: <code>brew install yt-dlp</code> })}</p>
);

/* ───────────── Spotify, YouTube Music, Apple Music ───────────── */

export function MusicSourcePanel({ name }: { name: SourceName }) {
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [combined, setCombined] = useState<CombinedState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useDownloads();
  const tools = useTools();

  const fail = (e: unknown) => { setProblem(said(e)); setBusy(false); };
  // Opens on the first playlist that has songs to show.
  const loadPlaylists = () => readPlaylists(name).then((p) => {
    setPlaylists(p.playlists);
    setPicked((x) => (x && p.playlists.some((q) => q.id === x) ? x : (p.playlists.find((q) => !q.locked && q.count !== 0) ?? p.playlists[0])?.id ?? null));
  }, (e) => {
    fail(e);
    void sourceStatus(name).then(setStatus, () => {});
  });

  useEffect(() => {
    let live = true;
    void sourceStatus(name).then((s) => {
      if (!live) return;
      setStatus(s);
      if (s.connected) void loadPlaylists();
    }, fail);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const pickedLocked = !!playlists?.find((p) => p.id === picked)?.locked;
  useEffect(() => {
    if (!picked || pickedLocked) return;
    let live = true;
    void readSongs(name, picked).then((s) => { if (live) { setSongs(s.songs); setCombined(s.combined); } }, (e) => { if (live) { setSongs([]); setCombined(null); fail(e); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, picked, pickedLocked]);

  // While songs of this playlist are downloading, their states follow along.
  const active = jobs.some((j) => j.state === "waiting" || j.state === "working");
  useEffect(() => {
    if (!picked || !active) return;
    const timer = setInterval(() => void songsState(name, picked).then((s) => { if (s.songs) setSongs(s.songs); setCombined(s.combined); }, () => {}), 1000);
    return () => clearInterval(timer);
  }, [name, picked, active]);

  const act = (work: () => Promise<SourceStatus>, then?: (s: SourceStatus) => void) => {
    setBusy(true); setProblem(null);
    void work().then((s) => { setStatus(s); setBusy(false); then?.(s); }, fail);
  };
  const connect = () => act(() => connectSource(name), (s) => { if (s.connected) void loadPlaylists(); });
  const disconnect = () => act(() => disconnectSource(name), () => { setPlaylists(null); setSongs(null); setPicked(null); });
  const toWatch = !!useStore(toWatchStore, {})[name];
  const unlock = () => {
    if (!confirm(`${t("Unlock followed playlists?")}\n\n${t("This signs in a second time as Spotify's own desktop app, which Spotify doesn't officially allow other apps to do. It's used only to read playlists you follow, and Spotify may stop it working.")}`)) return;
    act(unlockSpotify, (s) => { if (s.unlocked) { setSongs(null); void loadPlaylists(); } });
  };
  const lock = () => act(lockSpotify, () => { setSongs(null); void loadPlaylists(); });
  const download = (origins?: string[]) => {
    if (!picked) return;
    setProblem(null);
    void downloadSongs(name, picked, origins, toWatch).then(() => readDownloads().then((d) => setJobs(d.jobs)), fail);
  };

  const combine = () => {
    if (!picked) return;
    setProblem(null);
    void combineSongs(name, picked, toWatch).then(() => Promise.all([readDownloads().then((d) => setJobs(d.jobs)), songsState(name, picked).then((s) => setCombined(s.combined))]), fail);
  };

  if (!status) return problem ? <p className="notice" role="alert">{problem}</p> : null;
  const playlist = playlists?.find((p) => p.id === picked);
  const missing = songs?.filter((s) => !s.inLibrary && !(s.job && (s.job.state === "waiting" || s.job.state === "working"))) ?? [];
  const here = songs?.filter((s) => s.inLibrary).length ?? 0;
  const length = songs?.reduce((a, s) => a + (s.secs ?? 0), 0) ?? 0;
  const stateText = !songs ? t("Loading…") : !songs.length ? t("Nothing to download") : here === songs.length ? t("All in your library") : here ? t("{n} of {total} in your library", { n: here, total: songs.length }) : t("Not downloaded yet");

  return (<>
    {problem ? <p className="notice" role="alert">{problem}</p> : null}
    {!status.connected ? (
      name === "spotify" ? <SpotifySetup status={status} busy={busy} onStatus={setStatus} onConnect={connect} onProblem={setProblem} />
        : (
          <Card pad className="ms-connect">
            <h2 className="h2">{LABEL[name]}</h2>
            <p className="muted">{t("Sign in to {service} in a window of its own to see your playlists here.", { service: LABEL[name] })}</p>
            <div><Button variant="primary" disabled={busy} onClick={connect}>{busy ? t("Waiting for sign-in…") : t("Sign in to {service}", { service: LABEL[name] })}</Button></div>
          </Card>
        )
    ) : (<>
      <Card pad className="ms-account" aria-label={t("{service} account", { service: LABEL[name] })}>
        <span className="ms-account-icon" aria-hidden="true"><NoteIcon /></span>
        <div className="ms-account-text">
          <span className="ms-account-name">{LABEL[name]}<span className="ms-live"><i aria-hidden="true" />{t("Connected")}</span></span>
          <span className="muted">{[status.account, playlists ? (playlists.length === 1 ? t("1 playlist") : t("{n} playlists", { n: playlists.length })) : t("Loading…")].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="ms-account-actions">
          {name === "spotify" ? (
            <label className="ms-toggle" title={t("Reads playlists you follow by signing in as Spotify's own app")}>
              <span>{busy && !status.unlocked ? t("Waiting for sign-in…") : t("Followed playlists")}</span>
              <Switch checked={!!status.unlocked} disabled={busy} label={t("Followed playlists")} onChange={(on) => (on ? unlock() : lock())} />
            </label>
          ) : null}
          <Button onClick={() => { setProblem(null); void loadPlaylists(); if (picked) void readSongs(name, picked).then((s) => { setSongs(s.songs); setCombined(s.combined); }, fail); }}><SyncIcon />{t("Sync")}</Button>
          <Button variant="plain" className="ms-quiet" disabled={busy} onClick={disconnect}>{t("Disconnect")}</Button>
        </span>
      </Card>
      {tools && !tools.ytDlp ? <NeedsYtDlp /> : null}
      <div className="ms-grid">
        <Card className="ms-lists" aria-label={t("Playlists")}>
          <div className="ms-lists-head"><h2 className="h2">{t("Playlists")}</h2>{playlists ? <span className="muted">{playlists.length}</span> : null}</div>
          <div className="ms-lists-scroll">
            {playlists === null ? <p className="muted ms-pad">{t("Loading…")}</p> : !playlists.length ? <p className="muted ms-pad">{t("No playlists")}</p> : playlists.map((p) => (
              <button key={p.id} type="button" className="ms-list" data-locked={p.locked || undefined} aria-pressed={p.id === picked} onClick={() => { if (p.id !== picked) { setSongs(null); setCombined(null); setPicked(p.id); } }}>
                <Cover src={p.artwork} name={p.name} size={58} />
                <span className="ms-list-text">
                  <b>{p.name}</b>
                  <span>{p.followed ? (p.owner ? t("{owner}'s playlist", { owner: p.owner }) : t("Someone else's playlist")) : [p.owner, p.count != null ? (p.count === 1 ? t("1 song") : t("{n} songs", { n: p.count })) : null].filter(Boolean).join(" · ")}</span>
                </span>
                {p.locked ? <LockIcon /> : null}
              </button>
            ))}
          </div>
        </Card>
        <div className="ms-right">
          {playlist ? (
            <Card pad className="ms-hero" aria-label={t("Selected playlist")}>
              <Cover src={playlist.artwork} name={playlist.name} size={132} />
              <div className="ms-hero-text">
                <span className="muted">{t("{service} playlist", { service: LABEL[name] })}</span>
                <h2>{playlist.name}</h2>
                <span className="ms-meta">{[playlist.owner, songs ? (songs.length === 1 ? t("1 song") : t("{n} songs", { n: songs.length })) : playlist.count != null ? (playlist.count === 1 ? t("1 song") : t("{n} songs", { n: playlist.count })) : null, length ? clock(length) : null].filter(Boolean).join(" · ")}</span>
                {!playlist.locked ? <span className="ms-state" data-done={(songs && songs.length > 0 && here === songs.length) || undefined}>{stateText}</span> : null}
              </div>
              {playlist.locked ? null : (
                <div className="ms-hero-actions">
                  {songs && missing.length ? <Button variant="primary" disabled={!tools?.ytDlp} onClick={() => download()}>{missing.length === songs.length ? t("Download all") : t("Download {n}", { n: missing.length })}</Button> : null}
                  {songs && songs.length > 1 && combined ? <Combined state={combined} canDownload={!!tools?.ytDlp} onCombine={combine} /> : null}
                  {name === "spotify" ? <label className="ms-towatch"><Switch label={t("Send to watch when downloaded")} checked={toWatch} onChange={(on) => toWatchStore.set((v) => ({ ...v, [name]: on }))} />{t("Send to watch")}</label> : null}
                </div>
              )}
            </Card>
          ) : null}
          {playlist?.locked ? (
            <Card pad className="ms-locked">
              <p className="muted">{t("Spotify lets your app read only playlists you made or collaborate on. Unlock followed playlists to read this one.")}</p>
              <div><Button variant="primary" disabled={busy} onClick={unlock}>{t("Unlock followed playlists")}</Button></div>
            </Card>
          ) : playlist ? (
            <Card clip className="ms-songs" aria-label={t("Songs")}>
              {songs === null ? <p className="muted ms-empty">{t("Loading songs…")}</p>
                : songs.length ? <SongTable songs={songs} onDownload={(o) => download([o])} canDownload={!!tools?.ytDlp} />
                : <p className="muted ms-empty">{t("This playlist has no songs.")}</p>}
              <p className="ms-foot muted">{name === "ytmusic" ? t("Songs are saved from YouTube Music as MP3s.") : t("Songs are found on YouTube and saved as MP3s.")} {t("Only download music you have the right to use.")}</p>
            </Card>
          ) : <p className="muted">{t("Pick a playlist")}</p>}
        </div>
      </div>
    </>)}
    <DownloadsCard jobs={jobs} setJobs={setJobs} />
  </>);
}

function SpotifySetup({ status, busy, onStatus, onConnect, onProblem }: {
  status: SourceStatus; busy: boolean; onStatus: (s: SourceStatus) => void; onConnect: () => void; onProblem: (p: string | null) => void;
}) {
  const [clientId, setClientId] = useState(status.clientId ?? "");
  const save = () => { onProblem(null); void setSpotifyClient(clientId).then(onStatus, (e) => onProblem(said(e))); };
  return (
    <Card pad className="ms-connect">
      <h2 className="h2">Spotify</h2>
      <ol className="ms-steps">
        <li>{tr("Make an app at {site}, with Web API.", { site: <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com</a> })}</li>
        <li>{tr("Add this Redirect URI to it: {uri}", { uri: <code>{status.redirectUri}</code> })} <button type="button" className="md-link" onClick={() => void navigator.clipboard.writeText(status.redirectUri ?? "")}>{t("Copy")}</button></li>
        <li>{t("Paste its Client ID here.")}</li>
      </ol>
      <div className="ms-row">
        <Field aria-label={t("Spotify Client ID")} placeholder={t("Client ID")} value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <Button disabled={!clientId.trim() || clientId.trim() === status.clientId} onClick={save}>{t("Save")}</Button>
        <Button variant="primary" disabled={!status.clientId || busy} onClick={onConnect}>{busy ? t("Waiting for sign-in…") : t("Sign in to {service}", { service: "Spotify" })}</Button>
      </div>
      <p className="muted ms-small">{t("Spotify lets your own app read the playlists you made or collaborate on.")}</p>
    </Card>
  );
}

/** A cover from the service (through the app), or the name's first letter on a colour of its own. */
function Cover({ src, name, size }: { src: string | null | undefined; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const hue = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const style = { width: size, height: size, borderRadius: size >= 100 ? 20 : size >= 50 ? 12 : 9 };
  if (src && !failed) return <img className="ms-cover" src={src} alt="" loading="lazy" style={style} onError={() => setFailed(true)} />;
  return (
    <span className="ms-cover ms-cover-blank" aria-hidden="true" style={{ ...style, background: `linear-gradient(140deg, hsl(${hue} 55% 46%), hsl(${(hue + 40) % 360} 60% 32%))`, fontSize: size * 0.4 }}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

export function JobState({ job, inLibrary, onDownload, canDownload }: { job: JobLine | null; inLibrary: boolean; onDownload?: () => void; canDownload: boolean }) {
  if (inLibrary) return <span className="ms-pill" data-state="done">{t("In library")}</span>;
  if (job?.state === "working") return <span className="ms-pill" data-state="working">{job.progress != null ? `${Math.round(job.progress * 100)}%` : t("Downloading")}</span>;
  if (job?.state === "waiting") return <span className="ms-pill">{t("Waiting")}</span>;
  const button = onDownload && canDownload
    ? <button type="button" className="ms-get" aria-label={job?.state === "failed" ? t("Try again") : t("Download")} title={job?.state === "failed" ? t("Try again") : t("Download")} onClick={onDownload}><DownloadIcon /></button> : null;
  if (job?.state === "failed") return <><span className="ms-pill" data-state="failed" title={job.error ?? undefined}>{t("Didn't download")}</span>{button}</>;
  return <><span className="ms-pill">{t("Not downloaded")}</span>{button}</>;
}

const SONG_ROW = 60, SONG_VIEW = 10;

function SongTable({ songs, onDownload, canDownload }: { songs: Song[]; onDownload: (origin: string) => void; canDownload: boolean }) {
  const [top, setTop] = useState(0);
  const first = Math.max(0, Math.floor(top / SONG_ROW) - 4), last = Math.min(songs.length, first + SONG_VIEW + 8);
  return (
    <div className="ms-table">
      <div className="ms-tr ms-thead"><span>#</span><span /><span>{t("Title")}</span><span>{t("Album")}</span><span className="md-end">{t("Length")}</span><span className="md-end">{t("Download")}</span></div>
      <div className="ms-scroll" style={{ height: Math.min(songs.length, SONG_VIEW) * SONG_ROW }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
        <div style={{ height: songs.length * SONG_ROW, position: "relative" }}>
          {songs.slice(first, last).map((s, i) => (
            <div key={s.origin} className="ms-tr" style={{ position: "absolute", top: (first + i) * SONG_ROW, left: 0, right: 0, height: SONG_ROW }}>
              <span className="md-num">{first + i + 1}</span>
              <Cover src={s.artwork} name={s.album || s.title} size={40} />
              <span className="ms-song"><b>{s.title}</b><span>{s.artist}</span></span>
              <span className="md-cell muted">{s.album}</span>
              <span className="md-end">{clock(s.secs)}</span>
              <span className="ms-dl"><JobState job={s.job} inLibrary={s.inLibrary} onDownload={() => onDownload(s.origin)} canDownload={canDownload} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Downloads ───────────── */

export function DownloadsCard({ jobs, setJobs }: { jobs: DownloadJob[]; setJobs: (jobs: DownloadJob[]) => void }) {
  if (!jobs.length) return null;
  const active = jobs.filter((j) => j.state === "waiting" || j.state === "working");
  const recent = [...jobs].reverse().slice(0, 30);
  return (
    <Card pad className="ms-downloads" aria-label={t("Downloads")}>
      <div className="ms-main-head">
        <div><h3>{t("Downloads")}</h3><span className="muted">{active.length ? t("{n} to go", { n: active.length }) : t("Done")}</span></div>
        <span className="actions">
          {active.length ? <Button onClick={() => void cancelDownloads().then((d) => setJobs(d.jobs))}>{t("Cancel all")}</Button> : null}
          {jobs.length > active.length ? <Button variant="plain" onClick={() => void clearDownloads().then((d) => setJobs(d.jobs))}>{t("Clear finished")}</Button> : null}
        </span>
      </div>
      <ul className="ms-jobs">
        {recent.map((j) => (
          <li key={j.id}>
            <span className="md-title">{j.title}</span>
            <span className="muted md-cell">{j.artist ?? ""}</span>
            <span className="muted">{j.source}</span>
            <span className="ms-job" data-state={j.state} title={j.error ?? j.note}>
              {j.state === "working" ? (j.progress != null ? `${Math.round(j.progress * 100)}%` : t("Downloading…")) : j.state === "waiting" ? t("Waiting") : j.state === "done" ? t("In library") : j.state === "failed" ? t("Didn't download") : t("Cancelled")}
            </span>
            {j.state === "waiting" || j.state === "working" ? <button type="button" className="md-link" onClick={() => void cancelDownloads([j.id]).then((d) => setJobs(d.jobs))}>{t("Cancel")}</button> : <span />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────────── Podcasts ───────────── */

/** Part lengths offered when an episode is split like an audiobook (each part ends at a pause). */
const PARTS = [5, 10, 20, 30];
const TOPICS = [msg("Running"), msg("Cycling"), msg("Triathlon"), msg("Strength"), msg("Endurance"), msg("Nutrition"), msg("Sleep"), msg("Mindset")];
/** Shows opened lately, newest first. */
const recentStore = createStore<Show[]>("media.podcasts.recent", []);
const topicStore = createStore<string>("media.podcasts.topic", TOPICS[0]);
/** Topic searches, kept while the app is open so switching tabs doesn't search again. */
const topicShows = new Map<string, Show[]>();

const published = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(locale("en-GB"), { day: "numeric", month: "short", year: "numeric" }) : "");
const numbered = (e: Episode) => [e.season ? t("Season {n}", { n: e.season }) : null, e.number ? t("Episode {n}", { n: e.number }) : null].filter(Boolean).join(" · ");

export function PodcastsPanel() {
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState<Show[] | null>(null);
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [cutting, setCutting] = useState<string | null>(null);
  const recent = useStore(recentStore, []);
  const [jobs, setJobs] = useDownloads();
  const tools = useTools();

  const fail = (e: unknown) => { setProblem(said(e)); setBusy(false); setOpening(null); };
  const open = (id: string, offset = 0) => {
    setBusy(true); setProblem(null); setCutting(null);
    if (!offset) setOpening(id);
    void readShow(id, offset).then((r) => {
      setShow((old) => (offset && old?.id === id ? { ...r.show, page: [...old.page, ...r.show.page] } : r.show));
      setBusy(false); setOpening(null);
      if (!offset) {
        const { id: sid, title, author, artwork, genre } = r.show;
        recentStore.set((list) => [{ id: sid, title, author, artwork, genre }, ...list.filter((x) => x.id !== sid)].slice(0, 6));
      }
    }, fail);
  };
  // The first show found opens straight away.
  const search = () => {
    if (!query.trim()) return;
    setBusy(true); setProblem(null);
    void searchPodcasts(query).then((r) => {
      setShows(r.shows); setBusy(false);
      if (r.shows[0]) open(r.shows[0].id); else setShow(null);
    }, fail);
  };
  // Episode states follow their downloads.
  const active = jobs.some((j) => j.state === "waiting" || j.state === "working");
  const showId = show?.id, loaded = show?.page.length ?? 0;
  useEffect(() => {
    if (!showId || !active) return;
    const timer = setInterval(() => void readShow(showId, 0).then((r) => setShow((old) => {
      if (!old || old.id !== showId) return old;
      const fresh = new Map(r.show.page.map((e) => [e.id, e]));
      return { ...old, page: old.page.map((e) => fresh.get(e.id) ?? e) };
    }), () => {}), 1500);
    return () => clearInterval(timer);
  }, [showId, active, loaded]);
  // A click anywhere else closes the parts menu.
  useEffect(() => {
    if (!cutting) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".pc-cut")) setCutting(null); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [cutting]);

  const download = (episode: string) => {
    if (!show) return;
    setProblem(null);
    void downloadEpisode(show.id, episode).then(() => readDownloads().then((d) => setJobs(d.jobs)), fail);
  };
  /** Splits an episode into short parts in Audiobooks, where it's sent from and "I'm here" works. */
  const split = (episode: string, minutes: number) => {
    if (!show) return;
    setProblem(null); setCutting(null);
    void splitEpisode(show.id, episode, { mode: "minutes", minutes }).then(() => readShow(show.id, 0).then((r) => setShow((old) => {
      if (!old || old.id !== show.id) return old;
      const fresh = new Map(r.show.page.map((e) => [e.id, e]));
      return { ...old, page: old.page.map((e) => fresh.get(e.id) ?? e) };
    })), fail);
  };

  return (<>
    {problem ? <p className="notice" role="alert">{problem}</p> : null}
    <div className="pc">
      <Card pad className="pc-find" aria-label={t("Find a show")}>
        <div className="pc-find-head">
          <span className="pc-badge" aria-hidden="true"><PodcastIcon /></span>
          <h2 className="h2">{t("Find a show")}</h2>
        </div>
        <form className="pc-search" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <Field type="search" aria-label={t("Search podcasts")} placeholder={t("Show name or link")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy || !query.trim()}><SearchIcon />{t("Search")}</Button>
        </form>
        {shows ? (<>
          <div className="pc-shows-head"><span>{t("Shows")}</span><span className="pc-count">{shows.length}</span></div>
          {shows.length ? (
            <div className="pc-shows">
              {shows.map((s) => (
                <button key={s.id} type="button" className="pc-show" aria-pressed={s.id === show?.id} onClick={() => { if (s.id !== show?.id) open(s.id); }}>
                  <Cover src={s.artwork} name={s.title} size={44} />
                  <span className="pc-show-text"><b>{s.title}</b><span className="muted">{s.author}</span>{s.genre ? <span className="pc-genre">{s.genre}</span> : null}</span>
                  <ArrowIcon />
                </button>
              ))}
            </div>
          ) : <p className="muted pc-empty">{t("No shows by that name")}</p>}
        </>) : recent.length ? (<>
          <div className="pc-shows-head"><span>{t("Recent")}</span><button type="button" className="pc-clear" onClick={() => recentStore.set(() => [])}>{t("Clear")}</button></div>
          <div className="pc-shows">
            {recent.map((s) => (
              <button key={s.id} type="button" className="pc-show" aria-pressed={s.id === show?.id} onClick={() => { if (s.id !== show?.id) open(s.id); }}>
                <Cover src={s.artwork} name={s.title} size={40} />
                <span className="pc-show-text"><b>{s.title}</b><span className="muted">{s.author}</span></span>
                <ArrowIcon />
              </button>
            ))}
          </div>
        </>) : null}
      </Card>

      <div className="pc-right">
        {show ? (<>
          <button type="button" className="pc-back" onClick={() => { setShow(null); setCutting(null); }}><BackIcon />{t("Browse shows")}</button>
          <Card className="pc-hero" aria-label={show.title} style={show.artwork ? { ["--pc-art" as string]: `url("${show.artwork}")` } : undefined}>
            <Cover src={show.artwork} name={show.title} size={124} />
            <div className="pc-hero-text">
              <h2>{show.title}</h2>
              <span className="pc-hero-meta">{[show.author, show.episodes === 1 ? t("1 episode") : t("{n} episodes", { n: show.episodes })].filter(Boolean).join(" · ")}</span>
              {show.about ? <p className="pc-about">{show.about}</p> : null}
              <a className="pc-apple" href={`https://podcasts.apple.com/podcast/id${show.id}`} target="_blank" rel="noreferrer">{t("Open in Apple Podcasts")}<ExternalIcon /></a>
            </div>
          </Card>
          <Card className="pc-eps" aria-label={t("Episodes")}>
            {tools && !tools.ffmpeg ? <p className="muted ms-small pc-pad">{tr("Episodes that aren't MP3s need ffmpeg to convert ({command}).", { command: <code>brew install ffmpeg</code> })}</p> : null}
            <div className="pc-row pc-row-head" aria-hidden="true"><span>{t("Episode")}</span><span>{t("Published")}</span><span className="md-end">{t("Length")}</span><span>{t("Download")}</span></div>
            <ul>
              {show.page.map((e) => (
                <li key={e.id} className="pc-row">
                  <span className="pc-ep">
                    <Cover src={e.artwork ?? show.artwork} name={e.title} size={44} />
                    <span className="pc-ep-text"><span className="md-title">{e.title}</span>{numbered(e) ? <span className="muted">{numbered(e)}</span> : null}</span>
                  </span>
                  <span className="muted">{published(e.published)}</span>
                  <span className="md-end num">{clock(e.secs)}</span>
                  <span className="pc-dl">
                    <JobState job={e.job} inLibrary={e.inLibrary} onDownload={() => download(e.id)} canDownload />
                    {e.book && e.book.status !== "failed" ? (
                      <button type="button" className="ms-pill pc-book" data-state={e.book.status === "ready" ? "done" : "working"} title={t("Open in Audiobooks")}
                        onClick={() => { booksTabStore.set("books"); tabStore.set("books"); }}>
                        {e.book.status === "ready" ? t("In Audiobooks") : e.book.progress != null ? t("Splitting {pct}%", { pct: Math.round(e.book.progress * 100) }) : t("Splitting…")}
                      </button>
                    ) : tools?.ffmpeg !== false ? (
                      <span className="pc-cut">
                        <button type="button" className="ms-get" aria-label={t("Split into parts")} title={t("Split into parts")} aria-expanded={cutting === e.id} onClick={() => setCutting((c) => (c === e.id ? null : e.id))}><CutIcon /></button>
                        {cutting === e.id ? (
                          <span className="pc-cut-menu" role="menu">
                            <span className="pc-cut-title">{t("Split into parts")}</span>
                            {PARTS.filter((m) => !e.secs || e.secs > m * 60).map((m) => <button key={m} type="button" role="menuitem" onClick={() => split(e.id, m)}>{m} min</button>)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <div className="pc-foot">
              <span className="muted">{t("Showing {n} of {total} episodes · split ones go to Audiobooks", { n: show.page.length, total: show.episodes })}</span>
              {show.page.length < show.episodes ? <Button disabled={busy} onClick={() => open(show.id, show.page.length)}>{t("Load {n} more", { n: Math.min(50, show.episodes - show.page.length) })}</Button> : null}
            </div>
          </Card>
        </>) : (
          <Browse opening={opening} onOpen={(id) => open(id)} />
        )}
      </div>
    </div>
    <DownloadsCard jobs={jobs} setJobs={setJobs} />
  </>);
}

/** Shows for a few sport and health topics, as a grid of covers. */
function Browse({ opening, onOpen }: { opening: string | null; onOpen: (id: string) => void }) {
  const topic = useStore(topicStore, TOPICS[0]);
  const [attempt, setAttempt] = useState(0);
  // What the last search brought, and which topic + attempt failed: the shown state is worked out from these, so a
  // new topic or "Try again" needs no reset inside the effect.
  const [loaded, setLoaded] = useState<{ topic: string; shows: Show[] } | null>(null);
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const shows = topicShows.get(topic) ?? (loaded?.topic === topic ? loaded.shows : null);
  const failed = !shows && failedAt === `${topic}#${attempt}`;
  useEffect(() => {
    if (topicShows.has(topic)) return;
    let live = true;
    void searchPodcasts(`${topic} podcast`).then((r) => {
      topicShows.set(topic, r.shows);
      if (live) setLoaded({ topic, shows: r.shows });
    }, () => { if (live) setFailedAt(`${topic}#${attempt}`); });
    return () => { live = false; };
  }, [topic, attempt]);

  return (
    <Card pad className="pc-browse" aria-label={t("Browse shows")}>
      <div className="pc-topics" role="tablist" aria-label={t("Topics")}>
        {TOPICS.map((name) => (
          <button key={name} type="button" role="tab" className="pc-topic" aria-selected={name === topic} onClick={() => topicStore.set(() => name)}>{t(name)}</button>
        ))}
      </div>
      {failed ? (
        <div className="pc-none"><p className="muted">{t("Couldn't load shows.")}</p><Button onClick={() => setAttempt((n) => n + 1)}>{t("Try again")}</Button></div>
      ) : shows && !shows.length ? (
        <div className="pc-none"><p className="muted">{t("No shows for {topic} right now.", { topic: t(topic).toLowerCase() })}</p></div>
      ) : (
        <div className="pc-grid" aria-busy={!shows || undefined}>
          {shows ? shows.map((s) => (
            <button key={s.id} type="button" className="pc-tile" data-opening={opening === s.id || undefined} disabled={!!opening} onClick={() => onOpen(s.id)}>
              <span className="pc-tile-art"><Cover src={s.artwork} name={s.title} size={160} />{opening === s.id ? <span className="pc-tile-spin" aria-label={t("Opening")} /> : null}</span>
              <b>{s.title}</b>
              <span className="muted">{s.author}</span>
            </button>
          )) : Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="pc-tile pc-tile-ghost" aria-hidden="true"><span className="pc-tile-art" /><b /><span /></span>
          ))}
        </div>
      )}
    </Card>
  );
}

const BackIcon = () => <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
const PodcastIcon = () => <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 13a2 2 0 1 0 0-4a2 2 0 0 0 0 4zM11 21l.5-6h1l.5 6zM7.8 15.5a6 6 0 1 1 8.4 0M5 18.3a10 10 0 1 1 14 0" /></svg>;
const SearchIcon = () => <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14zM20 20l-4-4" /></svg>;
const ArrowIcon = () => <svg aria-hidden="true" className="pc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const ExternalIcon = () => <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
const CutIcon = () => <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></svg>;
const SyncIcon = () => <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" /></svg>;
const NoteIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z" /></svg>;
const DownloadIcon = () => <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;
const LockIcon = () => <svg className="ms-lock" aria-label={t("Locked")} role="img" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></svg>;

/** "Download combined MP3", and how that went: working, done (maybe with tracks left out), or failed, with a retry. */
export function Combined({ state, canDownload, onCombine }: { state: CombinedState; canDownload: boolean; onCombine: () => void }) {
  const job = state.job;
  if (job?.state === "working") return <span className="md-state">{job.progress != null ? t("Combining {pct}%", { pct: Math.round(job.progress * 100) }) : t("Combining…")}</span>;
  if (job?.state === "waiting") return <span className="md-state">{t("Combined MP3 waiting")}</span>;
  if (job?.state === "failed") return <span className="md-state ms-failed" title={job.error ?? undefined}>{t("Didn't combine")}<button type="button" className="md-link" disabled={!canDownload} onClick={onCombine}>{t("Retry")}</button></span>;
  if (job?.state === "done" && job.note) return <span className="md-state" title={job.note}><i data-on="true" />{t("Combined, some left out")}<button type="button" className="md-link" disabled={!canDownload} onClick={onCombine}>{t("Retry missing")}</button></span>;
  if (state.inLibrary) return <span className="md-state" data-on="true"><i data-on="true" />{t("Combined MP3 in library")}</span>;
  return <Button disabled={!canDownload} onClick={onCombine}>{t("Download combined MP3")}</Button>;
}
