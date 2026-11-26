// Studio (desktop only): the home page from the design's StudioHome board. The title row has the COROS account, Import
// and New face; "On your watch" is the chosen watch (its face slots come with the watch connection); then My faces,
// Templates (COROS's templates, official faces, your COROS faces) and Community. Everything opens as a project on this
// computer (desktop/main/watchface/studio.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Select } from "@/components/ui";
import { WATCHFACE_TARGETS, getWatchfaceTarget } from "../../watchface/watchfaceTargets";
import type { CorosWatchfaceDesignState } from "../../watchface/types";
import { FaceView } from "../parts/FaceView";
import { Icon } from "../parts/StudioIcon";
import { AccountChip, AccountDialog } from "../parts/StudioAccount";
import { CommunityTab, FitsDialog } from "../parts/StudioCommunity";
import { TemplatesTab, titleCase, type TemplateItem, type TemplateSort } from "../parts/StudioTemplates";
import { navigate } from "../router";
import {
  chooseWatch, chosenWatch, corosAccount, createProject, deleteProject, duplicateProject, edited, importProjectFile, knownProjects, listProjects,
  openCommunity, openCorosFace, projectPicture, said, StudioProblem, type AccountStatus, type CommunityFace, type CorosCatalog, type ProjectSummary,
} from "../studio";
import "./studio.css";


type Tab = "mine" | "templates" | "community";
/** Community has its own search in its toolbar. */
const SEARCH_HINT: Record<Exclude<Tab, "community">, string> = { mine: "Search your faces", templates: "Template name, ID or category" };
const watchName = (firmwareType?: string) => getWatchfaceTarget(firmwareType)?.label ?? "Watch";
/** A blank face is built on the watch's first digital template, so adding the time brings back digits, not hands. */
const blankBase = (templates: TemplateItem[]) => templates.find((t) => t.templateType === 1) ?? templates[0];
/** A new project's design until the editor sets it up from the template on first open (CorosLink's version 1). */
const UNSET = { version: 1 } as unknown as CorosWatchfaceDesignState;

export default function Studio() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(knownProjects);
  const [watch, setWatch] = useState(chosenWatch);
  const [tab, setTabState] = useState<Tab>("mine");
  const [query, setQuery] = useState("");
  const [mineSort, setMineSort] = useState<"edited" | "name">("edited");
  const [templateSort, setTemplateSort] = useState<TemplateSort>("coros");
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [dialog, setDialog] = useState<"account" | "import" | null>(null);
  const [fits, setFits] = useState<{ face: CommunityFace; model?: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const target = getWatchfaceTarget(watch) ?? WATCHFACE_TARGETS[0];

  const load = useCallback(() => listProjects().then(setProjects, (e) => { setProblem(said(e)); setProjects([]); }), []);
  // The COROS session can end on COROS's side (an expired sign-in signs the app out), so the account is read again
  // whenever a call says so, when the window comes back to the front, and when the account dialog opens.
  const readAccount = useCallback(() => corosAccount().then(setAccount, () => setAccount(null)), []);
  useEffect(() => { void load(); void readAccount(); }, [load, readAccount]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") void readAccount(); };
    addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [readAccount]);
  const failed = (e: unknown) => { setProblem(said(e)); if (e instanceof StudioProblem && e.code === "signedOut") void readAccount(); };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    addEventListener("click", close);
    return () => removeEventListener("click", close);
  }, [menu]);

  const setTab = (next: Tab) => { setTabState(next); setQuery(""); };
  const pickWatch = (model: string) => { setWatch(model); chooseWatch(model); };
  const opened = (id: string) => navigate(`/studio/${id}`);
  /** Runs a step that ends in a new project, showing `id` as busy meanwhile. */
  const make = async (id: string, work: () => Promise<ProjectSummary>) => {
    setBusy(id); setProblem(null);
    try { opened((await work()).projectId); } catch (e) { failed(e); setBusy(null); }
  };
  const act = async (work: () => Promise<unknown>) => {
    setProblem(null);
    try { await work(); await load(); } catch (e) { failed(e); }
  };

  const start = (template: TemplateItem, blank: boolean, all: TemplateItem[]) => {
    const base = blank ? blankBase(all) : template;
    if (!base) return;
    void make(blank ? "blank" : base.id, () => createProject({ watch, templateId: base.id, blank, design: UNSET, name: blank ? "Blank face" : titleCase(base.name) }));
  };
  const openCoros = (catalog: CorosCatalog, face: TemplateItem) => void make(face.id, () => openCorosFace(catalog, face.id, watch, titleCase(face.name)));
  const openFromCommunity = (face: CommunityFace, model: string | undefined) => { setFits(null); void make(face.slug, () => openCommunity(face.slug, model, watch)); };
  const onImport = (f: File | undefined) => { setDialog(null); if (f) void make("import", () => importProjectFile(f, watch)); };

  const mine = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || watchName(p.firmwareType).toLowerCase().includes(q));
    return mineSort === "name" ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list;
  }, [projects, query, mineSort]);
  const latest = projects?.[0];

  return (
    <main className="page st-home">
      <div className="st-title-row">
        <h1>Studio</h1>
        <span className="st-grow" />
        <AccountChip account={account} onOpen={() => { setDialog("account"); void readAccount(); }} />
        <Button onClick={() => setDialog("import")}><Icon name="upload" size={16} />Import</Button>
        <Button variant="primary" onClick={() => setTab("templates")}><Icon name="plus" size={16} width={2.2} />New face</Button>
      </div>
      {problem ? <div className="notice" role="alert">{problem}</div> : null}

      <section className="st-watch card" aria-label="On your watch">
        <div className="st-watch-who">
          <span className="st-watch-icon"><Icon name="watch" size={26} /></span>
          <span className="st-watch-text">
            <span className="st-watch-name">
              <Select aria-label="Watch" value={target.model} onChange={(e) => pickWatch(e.target.value)} className="st-watch-select">
                {WATCHFACE_TARGETS.map((t) => <option key={t.model} value={t.model}>{t.label}</option>)}
              </Select>
              <i aria-hidden="true" />
            </span>
            <span className="st-watch-sub">Not connected over Bluetooth · {target.previewSize} × {target.previewSize} {target.display === "amoled" ? "AMOLED" : "MIP"}</span>
          </span>
        </div>
        <p className="st-watch-later">Its face slots show here once C-LINK connects to your watch over Bluetooth.</p>
      </section>

      <div className="st-tabs-row">
        <div role="tablist" aria-label="Studio sections" className="seg st-tabbar">
          {(["mine", "templates", "community"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === "mine" ? <>My faces {projects ? <span className="st-count">{projects.length}</span> : null}</> : t === "templates" ? "Templates" : "Community"}
            </button>
          ))}
        </div>
        <span className="st-grow" />
        {tab === "mine" ? (
          <label className="st-search st-home-search"><Icon name="search" size={15} />
            <input type="search" aria-label="Search" placeholder={SEARCH_HINT[tab]} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        ) : null}
        {tab === "mine" ? (
          <Select field aria-label="Sort" value={mineSort} onChange={(e) => setMineSort(e.target.value as "edited" | "name")} className="st-sort">
            <option value="edited">Last edited</option><option value="name">Name</option>
          </Select>
        ) : null}
      </div>

      {tab === "mine" ? (
        <div className="st-tab">
          {latest && !query ? (
            <section className="card st-continue" aria-label="Continue designing">
              <button type="button" className="st-stage st-continue-face" onClick={() => opened(latest.projectId)} aria-label={`Open ${latest.name}`}>
                <FaceView src={latest.previewUpdatedAt ? projectPicture(latest) : null} size={196} label={latest.name} />
              </button>
              <div className="st-continue-text">
                <span className="st-kicker">Continue where you left off</span>
                <h2>{latest.name}</h2>
                <span className="muted">{watchName(latest.firmwareType)} · edited {edited(latest.updatedAt).toLowerCase()}</span>
                <div className="actions">
                  <Button variant="primary" onClick={() => opened(latest.projectId)}>Open editor</Button>
                  <Button variant="plain" className="st-quiet" onClick={() => void act(() => duplicateProject(latest.projectId))}><Icon name="dup" size={16} />Duplicate</Button>
                </div>
              </div>
            </section>
          ) : null}
          <section className="st-section" aria-label="All projects">
            {projects?.length ? <h2 className="st-h2">All projects</h2> : null}
            <div className="st-grid">
              {!query ? (
                <button type="button" className="st-card st-new-tile" onClick={() => setTab("templates")}>
                  <span className="st-new-icon"><Icon name="plus" size={22} width={2.2} /></span><b>New face</b><span>Start from a template</span>
                </button>
              ) : null}
              {mine.map((p) => (
                <article key={p.projectId} className="st-card">
                  <button type="button" className="st-stage" onClick={() => opened(p.projectId)} aria-label={`Open ${p.name}`}>
                    <FaceView src={p.previewUpdatedAt ? projectPicture(p) : null} size={136} label={p.name} />
                  </button>
                  <div className="st-card-foot">
                    <div className="st-card-text"><h3>{p.name}</h3><span>{watchName(p.firmwareType)} · {edited(p.updatedAt)}</span></div>
                    <div className="st-menu-wrap">
                      <button type="button" className="st-icon-btn" aria-label={`Project actions for ${p.name}`} aria-expanded={menu === p.projectId}
                        onClick={(e) => { e.stopPropagation(); setMenu(menu === p.projectId ? null : p.projectId); }}><Icon name="more" /></button>
                      {menu === p.projectId ? (
                        <div className="st-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => void act(() => duplicateProject(p.projectId))}><Icon name="dup" size={16} />Duplicate</button>
                          <button type="button" role="menuitem" className="st-danger"
                            onClick={() => { if (confirm(`Delete “${p.name}”? It can't be brought back.`)) void act(() => deleteProject(p.projectId)); }}><Icon name="trash" size={16} />Delete project</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {projects && query && !mine.length ? <p className="st-hint">Nothing matches.</p> : null}
            {projects === null ? <p className="st-hint">Loading…</p> : null}
          </section>
        </div>
      ) : tab === "templates" ? (
        <TemplatesTab watch={watch} target={target} query={query} onQuery={setQuery} sort={templateSort} onSort={setTemplateSort} account={account} starting={busy}
          onSignIn={() => { setDialog("account"); void readAccount(); }} onSignedOut={() => void readAccount()} onStart={start} onOpen={openCoros} />
      ) : (
        <CommunityTab target={target} opening={busy}
          onOpen={(face, model, fitsWatch) => (fitsWatch ? openFromCommunity(face, model) : setFits({ face, model }))} />
      )}

      {dialog === "account" && account ? <AccountDialog account={account} onClose={() => setDialog(null)} onChange={setAccount} /> : null}
      {dialog === "import" ? <ImportDialog onClose={() => setDialog(null)} onFile={onImport} /> : null}
      {fits ? <FitsDialog face={fits.face} watch={target.label} onCancel={() => setFits(null)} onOpen={() => openFromCommunity(fits.face, fits.model)} /> : null}
    </main>
  );
}

/** Import: a face's ZIP, DAT or BIN, or an editable project from CorosLink, dropped or chosen. */
function ImportDialog({ onClose, onFile }: { onClose: () => void; onFile: (f: File | undefined) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="st-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-dialog st-small-dialog pop" role="dialog" aria-modal="true" aria-label="Import watch face">
        <div className="st-dialog-head"><h2>Import a watch face</h2><button type="button" className="st-icon-btn" aria-label="Close import dialog" onClick={onClose}><Icon name="close" /></button></div>
        <div className="st-dialog-stack">
          <input ref={file} type="file" accept=".zip,.dat,.bin,application/zip" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className="st-drop" data-over={over ? "" : undefined} autoFocus onClick={() => file.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}>
            <Icon name="upload" size={26} /><b>Drop a ZIP, DAT or BIN file</b><span>or click to choose one</span>
          </button>
        </div>
      </div>
    </div>
  );
}
