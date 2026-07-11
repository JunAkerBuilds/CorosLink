import { type FormEvent, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileArchive,
  KeyRound,
  LayoutGrid,
  Loader2,
  LogOut,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Watch
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceProject,
  CorosWatchfaceProjectSummary,
  CorosWatchfaceRegion,
  CorosWatchfaceShareLink,
  CorosWatchfaceStatus,
  CorosWatchfaceTheme
} from "../../electron/types";

const REGION_OPTIONS: { value: CorosWatchfaceRegion; label: string }[] = [
  { value: "eu", label: "Europe" },
  { value: "us", label: "United States" },
  { value: "cn", label: "China / Asia-Pacific" }
];
import type { CorosLinkApi } from "../coroslink-api";
import { WatchfaceCreator } from "./WatchfaceCreator";
import { WatchfaceEditor } from "./WatchfaceEditor";
import { BatteryHistoryPanel } from "./BatteryHistoryPanel";

interface WatchfacesViewProps {
  api: CorosLinkApi;
}

const DEFAULT_FIRMWARE_TYPE = "COROS W332";

export function WatchfacesView({ api }: WatchfacesViewProps) {
  const [status, setStatus] = useState<CorosWatchfaceStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState<CorosWatchfaceRegion>("us");
  const [regionTouched, setRegionTouched] = useState(false);
  const [archive, setArchive] = useState<CorosWatchfaceArchive | null>(null);
  const [editorMode, setEditorMode] = useState(false);
  const [starterArchive, setStarterArchive] =
    useState<CorosWatchfaceArchive | null>(null);
  const [projects, setProjects] = useState<CorosWatchfaceProjectSummary[]>([]);
  const [loadedProject, setLoadedProject] = useState<CorosWatchfaceProject | null>(
    null
  );
  const [name, setName] = useState("");
  const [firmwareType, setFirmwareType] = useState(DEFAULT_FIRMWARE_TYPE);
  const [backgroundImageId, setBackgroundImageId] = useState("13");
  const [language, setLanguage] = useState("en-US");
  const [maxWatchFaceVersion, setMaxWatchFaceVersion] = useState("5");
  const [themes, setThemes] = useState<CorosWatchfaceTheme[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  const [themeSearch, setThemeSearch] = useState("");
  const [shareLink, setShareLink] = useState<CorosWatchfaceShareLink | null>(
    null
  );
  const [downloadingThemeUrl, setDownloadingThemeUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "login" | "themes" | "archive" | "publish" | "project" | null
  >(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getCorosWatchfaceStatus()
      .then((nextStatus) => {
        setStatus(nextStatus);
        if (!regionTouched) {
          setRegion(nextStatus.region ?? nextStatus.suggestedRegion);
        }
      })
      .catch((caught) => setError(toErrorMessage(caught)));
  }, [api, regionTouched]);

  useEffect(() => {
    void api
      .listCorosWatchfaceProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, [api]);

  const connected = Boolean(status?.authenticated);
  const visibleThemes = themes.filter((theme) => {
    const query = themeSearch.trim().toLocaleLowerCase();
    if (!query) {
      return true;
    }
    return [theme.name, theme.id, theme.category, theme.firmwareType]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(query));
  });

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");
    setError(null);
    setNotice(null);
    try {
      const nextStatus = await api.loginCorosWatchfaces(email, password, region);
      setStatus(nextStatus);
      setPassword("");
      setNotice("COROS mobile session connected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  async function handleLogout() {
    setBusy("login");
    setError(null);
    setNotice(null);
    try {
      setStatus(await api.logoutCorosWatchfaces());
      setArchive(null);
      setStarterArchive(null);
      setLoadedProject(null);
      setShareLink(null);
      setThemes([]);
      setThemesLoaded(false);
      setNotice("COROS mobile session disconnected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleLoadThemes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("themes");
    setError(null);
    setNotice(null);
    try {
      const nextThemes = await api.listCorosWatchfaceThemes({
        firmwareType,
        language,
        maxWatchFaceVersion: Number(maxWatchFaceVersion)
      });
      setThemes(nextThemes);
      setThemesLoaded(true);
      setNotice(
        nextThemes.length === 1
          ? "Loaded 1 official COROS source template."
          : `Loaded ${nextThemes.length} official COROS source templates.`
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  async function handleDownloadTheme(theme: CorosWatchfaceTheme) {
    if (!theme.packageUrl) {
      return;
    }
    setDownloadingThemeUrl(theme.packageUrl);
    setError(null);
    setNotice(null);
    try {
      const download = await api.downloadCorosWatchfaceTheme({
        packageUrl: theme.packageUrl,
        name: theme.name
      });
      if (download.usableAsTemplate && download.archive) {
        setArchive(download.archive);
        setStarterArchive(download.archive);
        setLoadedProject(null);
        setName(theme.name);
        setShareLink(null);
        setNotice(
          `${download.message} It is selected as the starter template below.`
        );
      } else {
        setNotice(
          download.entries && download.entries.length > 0
            ? `${download.message} Contents: ${download.entries.slice(0, 8).join(", ")}${download.entries.length > 8 ? ", …" : ""}`
            : download.message
        );
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setDownloadingThemeUrl(null);
    }
  }

  async function handleChooseArchive() {
    setBusy("archive");
    setError(null);
    setNotice(null);
    try {
      const selected = await api.chooseCorosWatchfaceArchive();
      if (!selected) {
        return;
      }
      setArchive(selected);
      setStarterArchive(selected);
      setLoadedProject(null);
      setName(selected.fileName.replace(/\.(zip|dat)$/i, "") || "Custom watchface");
      setShareLink(null);
      setNotice("Archive validated. Review the template details, then publish.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleProjectSaved(saved: CorosWatchfaceProject) {
    const summary: CorosWatchfaceProjectSummary = {
      projectId: saved.projectId,
      name: saved.name,
      updatedAt: saved.updatedAt,
      sourceTemplateId: saved.sourceTemplateId
    };
    setProjects((current) => [
      summary,
      ...current.filter((project) => project.projectId !== summary.projectId)
    ]);
  }

  async function handleLoadProject(projectId: string) {
    setBusy("project");
    setError(null);
    setNotice(null);
    try {
      const project = await api.loadCorosWatchfaceProject(projectId);
      setLoadedProject(project);
      setStarterArchive(project.archive);
      setArchive(project.archive);
      setName(project.name);
      setShareLink(null);
      setNotice(`Opened project “${project.name}”.`);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteProject(projectId: string) {
    setBusy("project");
    setError(null);
    try {
      await api.deleteCorosWatchfaceProject(projectId);
      setProjects((current) =>
        current.filter((project) => project.projectId !== projectId)
      );
      setNotice("Saved watchface project deleted.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archive) {
      return;
    }
    setBusy("publish");
    setError(null);
    setNotice(null);
    try {
      const nextLink = await api.publishCorosWatchface({
        archiveId: archive.archiveId,
        name,
        firmwareType,
        backgroundImageId: Number(backgroundImageId),
        language
      });
      setShareLink(nextLink);
      setNotice("Official COROS share link created.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  async function handleCopy() {
    if (!shareLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink.url);
      setNotice("Share link copied to your clipboard.");
    } catch {
      setError("Could not copy the link. Select and copy it from the field below.");
    }
  }

  return (
    <div className="stack watchfaces-view">
      <section className="panel watchfaces-hero">
        <div>
          <p className="eyebrow">Experimental desktop hand-off</p>
          <h1>Custom Watch Faces</h1>
          <p>
            Upload a valid COROS custom-template archive, then scan the official
            COROS link on your iPhone. The iPhone app remains responsible for
            saving and sending the face to the watch.
          </p>
        </div>
        <span className={`badge ${connected ? "ready" : "warning"}`}>
          <ShieldCheck size={14} aria-hidden="true" />
          {connected ? "Mobile session ready" : "Sign in required"}
        </span>
      </section>

      {error ? <p className="watchfaces-message is-error">{error}</p> : null}
      {notice ? <p className="watchfaces-message is-success">{notice}</p> : null}

      {!connected ? (
        <section className="panel watchfaces-login-panel">
          <div className="watchfaces-panel-heading">
            <span className="watchfaces-panel-icon"><KeyRound size={20} /></span>
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Connect the mobile COROS session</h2>
            </div>
          </div>
          <p className="watchfaces-muted">
            Your password is used for this sign-in only. The resulting mobile
            session is kept in encrypted OS storage; CorosLink does not save the password.
          </p>
          <form className="watchfaces-form" onSubmit={handleLogin}>
            <label className="field">
              COROS account region
              <select
                value={region}
                onChange={(event) => {
                  setRegion(event.target.value as CorosWatchfaceRegion);
                  setRegionTouched(true);
                }}
              >
                {REGION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              COROS email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="field">
              COROS password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy !== null}>
              {busy === "login" ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              Connect COROS
            </button>
          </form>
          {status && !status.secureStorageAvailable ? (
            <p className="watchfaces-warning">
              Secure OS storage is unavailable, so this session will be cleared
              when CorosLink closes.
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <section className="panel watchfaces-session-bar">
            <div>
              <strong>Mobile session connected</strong>
              <span>Used only for custom-watchface upload and share-link creation.</span>
            </div>
            <button
              className="secondary-button danger-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void handleLogout()}
            >
              <LogOut size={16} /> Disconnect
            </button>
          </section>

          <section className="panel watchface-projects-panel">
            <div className="watchfaces-panel-heading">
              <span className="watchfaces-panel-icon"><FileArchive size={20} /></span>
              <div>
                <p className="eyebrow">Saved locally</p>
                <h2>Watchface projects</h2>
              </div>
            </div>
            <p className="watchfaces-muted">
              Open a saved project to restore its starter template, artwork,
              sprites, colors, positions, and component settings.
            </p>
            {projects.length > 0 ? (
              <div className="watchface-project-list">
                {projects.map((project) => (
                  <article
                    className={`watchface-project-card ${loadedProject?.projectId === project.projectId ? "active" : ""}`}
                    key={project.projectId}
                  >
                    <div>
                      <strong>{project.name}</strong>
                      <span>
                        Template {project.sourceTemplateId} · {new Date(project.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void handleLoadProject(project.projectId)}
                    >
                      {busy === "project" ? <Loader2 className="spin" size={14} /> : <FileArchive size={14} />}
                      Open
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Delete ${project.name}`}
                      disabled={busy !== null}
                      onClick={() => void handleDeleteProject(project.projectId)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="watchfaces-empty-themes">
                No saved projects yet. Choose a template and use Save project
                in the designer.
              </p>
            )}
          </section>

          <BatteryHistoryPanel api={api} disabled={busy !== null} />

          <section className="panel watchfaces-theme-browser">
            <div className="watchfaces-panel-heading">
              <span className="watchfaces-panel-icon"><LayoutGrid size={20} /></span>
              <div>
                <p className="eyebrow">Step 2</p>
                <h2>Choose an editable COROS template</h2>
              </div>
            </div>
            <p className="watchfaces-muted">
              Load the source templates COROS provides for this watch model,
              then use one as the foundation for the designer below.
            </p>
            <form className="watchfaces-theme-form" onSubmit={handleLoadThemes}>
              <label className="field">
                Firmware type
                <input value={firmwareType} onChange={(event) => setFirmwareType(event.target.value)} required />
              </label>
              <label className="field">
                Language
                <input value={language} pattern="[a-z]{2,3}-[A-Z]{2}" onChange={(event) => setLanguage(event.target.value)} required />
              </label>
              <label className="field">
                Max watchface version
                <input type="number" min="0" max="999" step="1" value={maxWatchFaceVersion} onChange={(event) => setMaxWatchFaceVersion(event.target.value)} required />
              </label>
              <button className="secondary-button" type="submit" disabled={busy !== null}>
                {busy === "themes" ? <Loader2 className="spin" size={16} /> : <LayoutGrid size={16} />}
                {themesLoaded ? "Refresh templates" : "Load templates"}
              </button>
            </form>

            {themesLoaded ? (
              <div className="watchfaces-theme-results">
                <div className="watchfaces-theme-results-heading">
                  <strong>{themes.length} template{themes.length === 1 ? "" : "s"} available</strong>
                  <label className="watchfaces-theme-search">
                    <Search size={15} aria-hidden="true" />
                    <input value={themeSearch} onChange={(event) => setThemeSearch(event.target.value)} placeholder="Filter templates" aria-label="Filter COROS templates" />
                  </label>
                </div>
                {visibleThemes.length > 0 ? (
                  <div className="watchfaces-theme-grid">
                    {visibleThemes.map((theme, index) => (
                      <article className="watchfaces-theme-card" key={theme.id ?? `${theme.name}-${index}`}>
                        <div className="watchfaces-theme-preview">
                          {theme.previewImageUrl ? (
                            <img
                              src={theme.previewImageUrl}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : null}
                          <Watch size={24} aria-hidden="true" />
                        </div>
                        <div className="watchfaces-theme-copy">
                          <strong title={theme.name}>{theme.name}</strong>
                          <div className="watchfaces-theme-meta">
                            {theme.category ? <span>{theme.category}</span> : null}
                            {theme.id ? <span>ID {theme.id}</span> : null}
                            {theme.watchFaceVersion !== undefined ? <span>v{theme.watchFaceVersion}</span> : null}
                            {theme.diyVersion !== undefined ? <span>DIY {theme.diyVersion}</span> : null}
                            {theme.templateType !== undefined ? <span>Type {theme.templateType}</span> : null}
                            {theme.backgroundImageId !== undefined ? <span>BG {theme.backgroundImageId}</span> : null}
                          </div>
                          {theme.packageUrl ? (
                            <button
                              className="secondary-button watchfaces-theme-download"
                              type="button"
                              disabled={busy !== null || downloadingThemeUrl !== null}
                              onClick={() => void handleDownloadTheme(theme)}
                            >
                              {downloadingThemeUrl === theme.packageUrl ? (
                                <Loader2 className="spin" size={14} />
                              ) : (
                                <Download size={14} />
                              )}
                              Use as template
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="watchfaces-empty-themes">
                    {themes.length === 0
                      ? "COROS returned no editable templates for this watch model and version."
                      : "No loaded templates match that filter."}
                  </p>
                )}
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="watchfaces-panel-heading">
              <span className="watchfaces-panel-icon"><FileArchive size={20} /></span>
              <div>
                <p className="eyebrow">Step 3</p>
                <h2>Choose a template archive</h2>
              </div>
            </div>
            <p className="watchfaces-muted">
              Select the template ZIP (or COROS .dat ZIP). CorosLink checks the
              manifest and preview before it can be uploaded.
            </p>
            <button
              className="secondary-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void handleChooseArchive()}
            >
              {busy === "archive" ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
              {archive ? "Choose another archive" : "Choose archive"}
            </button>

            {archive ? (
              <dl className="watchfaces-archive-meta">
                <div><dt>Archive</dt><dd>{archive.fileName}</dd></div>
                <div><dt>Template ID</dt><dd>{archive.sourceTemplateId}</dd></div>
                <div><dt>DIY version</dt><dd>{archive.diyVersion}</dd></div>
                <div><dt>Size</dt><dd>{formatBytes(archive.sizeBytes)}</dd></div>
              </dl>
            ) : null}
          </section>

          {starterArchive ? (
            <div className="watchface-mode-switch" role="tablist" aria-label="Design surface">
              <button
                type="button"
                role="tab"
                aria-selected={!editorMode}
                className={!editorMode ? "is-active" : ""}
                onClick={() => setEditorMode(false)}
              >
                Guided creator
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editorMode}
                className={editorMode ? "is-active" : ""}
                onClick={() => setEditorMode(true)}
              >
                Editor (beta)
              </button>
            </div>
          ) : null}

          {starterArchive && !editorMode ? (
            <WatchfaceCreator
              api={api}
              starterArchive={starterArchive}
              initialProject={loadedProject}
              disabled={busy !== null}
              onCreated={(created) => {
                setArchive(created);
                setName("My custom face");
                setShareLink(null);
              }}
              onProjectSaved={handleProjectSaved}
              onError={setError}
              onNotice={setNotice}
            />
          ) : null}

          {starterArchive && editorMode ? (
            <WatchfaceEditor
              api={api}
              starterArchive={starterArchive}
              initialDesign={loadedProject?.design}
              initialProjectId={loadedProject?.projectId}
              initialProjectName={loadedProject?.name}
              onArchiveCreated={(created) => {
                setArchive(created);
                setName("My custom face");
                setShareLink(null);
              }}
              onProjectSaved={handleProjectSaved}
              onError={setError}
              onNotice={setNotice}
            />
          ) : null}

          {archive ? (
            <section className="panel">
              <div className="watchfaces-panel-heading">
                <span className="watchfaces-panel-icon"><Send size={20} /></span>
                <div>
                  <p className="eyebrow">Step 5</p>
                  <h2>Publish an official share link</h2>
                </div>
              </div>
              <form className="watchfaces-publish-form" onSubmit={handlePublish}>
                <label className="field">
                  Watchface name
                  <input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} required />
                </label>
                <label className="field">
                  Firmware type
                  <input value={firmwareType} onChange={(event) => setFirmwareType(event.target.value)} required />
                </label>
                <label className="field">
                  Background image ID
                  <input type="number" min="0" step="1" value={backgroundImageId} onChange={(event) => setBackgroundImageId(event.target.value)} required />
                </label>
                <label className="field">
                  Language
                  <input value={language} pattern="[a-z]{2,3}-[A-Z]{2}" onChange={(event) => setLanguage(event.target.value)} required />
                </label>
                <button className="primary-button" type="submit" disabled={busy !== null}>
                  {busy === "publish" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                  Upload & create link
                </button>
              </form>
              <p className="watchfaces-muted watchfaces-form-note">
                Firmware type and background ID must match the source template.
                The defaults are from the captured W332 template request.
              </p>
            </section>
          ) : null}
        </>
      )}

      {shareLink ? (
        <section className="panel watchfaces-share-panel">
          <div className="watchfaces-panel-heading">
            <span className="watchfaces-panel-icon"><QrCode size={20} /></span>
            <div>
              <p className="eyebrow">Step 6</p>
              <h2>Open it in COROS on iPhone</h2>
            </div>
          </div>
          <div className="watchfaces-share-grid">
            <img
              className="watchfaces-qr"
              src={shareLink.qrDataUrl}
              alt="QR code for the official COROS custom-watchface share link"
              width={280}
              height={280}
            />
            <div className="watchfaces-share-copy">
              <ol>
                <li>Scan the QR code with the iPhone that has the COROS app.</li>
                <li>Open the official COROS page and save the watch face.</li>
                <li>In COROS, send it to the watch paired with that iPhone.</li>
              </ol>
              <p className="watchfaces-expiry">
                This official link expires {formatExpiry(shareLink.expiresAt)}.
              </p>
              <div className="watchfaces-share-actions">
                <button className="secondary-button" type="button" onClick={() => void handleCopy()}>
                  <Clipboard size={16} /> Copy link
                </button>
                <a className="secondary-button" href={shareLink.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Open link
                </a>
              </div>
              <input className="watchfaces-link" value={shareLink.url} readOnly aria-label="Official COROS share link" />
              <p className="watchfaces-warning">
                <Watch size={15} aria-hidden="true" /> The share link saves the face to COROS; it does not directly sideload firmware or bypass the iPhone app.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "soon" : date.toLocaleString();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Watchface request failed.";
}
