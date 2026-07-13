import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  FileArchive,
  KeyRound,
  LayoutGrid,
  Loader2,
  LogOut,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Watch,
  X
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceProject,
  CorosWatchfaceProjectSummary,
  CorosWatchfaceRegion,
  CorosWatchfaceShareLink,
  CorosWatchfaceStatus,
  CorosWatchfaceTheme,
  CorosWatchfaceThemeCatalog
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { BatteryHistoryPanel } from "./BatteryHistoryPanel";
import { DeviceInfoPanel } from "./DeviceInfoPanel";
import { LegacyCarrierEditorPanel } from "./LegacyCarrierEditorPanel";
import { RawBinInstallerPanel } from "./RawBinInstallerPanel";
import { WatchfaceEditor } from "./WatchfaceEditor";
import { createWatchfaceEditorSessionId } from "./watchfaceEditorHistory";
import arcFace from "../assets/watchfaces/arc.png";
import colorHalftoneFace from "../assets/watchfaces/color-halftone.png";
import copperStateFace from "../assets/watchfaces/copper-state.png";
import dashboardFace from "../assets/watchfaces/dashboard.png";
import dawnFace from "../assets/watchfaces/dawn.png";
import fearlessFace from "../assets/watchfaces/fearless.png";
import glassFace from "../assets/watchfaces/glass.png";
import goFishingFace from "../assets/watchfaces/go-fishing.png";
import gridlineFace from "../assets/watchfaces/gridline.png";
import kineticEnergyFace from "../assets/watchfaces/kinetic-energy.png";
import lilyFace from "../assets/watchfaces/lily.png";
import markFace from "../assets/watchfaces/mark.png";
import multidataElevFace from "../assets/watchfaces/multidata-elev.png";
import planetFace from "../assets/watchfaces/planet.png";
import preClassicFace from "../assets/watchfaces/pre-classic.png";
import snowingFace from "../assets/watchfaces/snowing.png";
import "./watchfaces.css";

const AUTH_WATCH_FACE_PREVIEWS = [
  preClassicFace,
  multidataElevFace,
  kineticEnergyFace,
  goFishingFace,
  gridlineFace,
  planetFace,
  lilyFace,
  colorHalftoneFace,
  dashboardFace,
  dawnFace,
  markFace,
  copperStateFace,
  glassFace,
  fearlessFace,
  arcFace,
  snowingFace
] as const;

interface WatchfacesViewProps {
  api: CorosLinkApi;
  showDevelopmentTools: boolean;
}

type WatchfaceSurface = "sign-in" | "hub" | "studio";
type HubTab = "projects" | "templates";

interface StudioSession {
  id: string;
  archive: CorosWatchfaceArchive;
  project?: CorosWatchfaceProject;
  initialName: string;
}

const DEFAULT_FIRMWARE_TYPE = "COROS W332";
const DEFAULT_MODEL_VERSION = "W332-3.1708.0";
const IS_DEVELOPMENT_BUILD = import.meta.env.DEV;

const REGION_OPTIONS: { value: CorosWatchfaceRegion; label: string }[] = [
  { value: "eu", label: "Europe" },
  { value: "us", label: "United States" },
  { value: "cn", label: "China / Asia-Pacific" }
];

export function WatchfacesView({ api, showDevelopmentTools }: WatchfacesViewProps) {
  const [status, setStatus] = useState<CorosWatchfaceStatus | null>(null);
  const [surface, setSurface] = useState<WatchfaceSurface>("sign-in");
  const [hubTab, setHubTab] = useState<HubTab>("projects");
  const [studioSession, setStudioSession] = useState<StudioSession | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState<CorosWatchfaceRegion>("us");
  const [regionTouched, setRegionTouched] = useState(false);

  const [projects, setProjects] = useState<CorosWatchfaceProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] =
    useState<CorosWatchfaceProjectSummary | null>(null);

  const [firmwareType, setFirmwareType] = useState(DEFAULT_FIRMWARE_TYPE);
  const [backgroundImageId, setBackgroundImageId] = useState("13");
  const [language, setLanguage] = useState("en-US");
  const [maxWatchFaceVersion, setMaxWatchFaceVersion] = useState("5");
  const [themeCatalog, setThemeCatalog] =
    useState<CorosWatchfaceThemeCatalog>("editable");
  const [watchSerial, setWatchSerial] = useState("");
  const [modelVersion, setModelVersion] = useState(DEFAULT_MODEL_VERSION);
  const [themes, setThemes] = useState<CorosWatchfaceTheme[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  const [themeSearch, setThemeSearch] = useState("");
  const [downloadingThemeUrl, setDownloadingThemeUrl] = useState<string | null>(
    null
  );

  const [builtArchive, setBuiltArchive] =
    useState<CorosWatchfaceArchive | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [shareLink, setShareLink] = useState<CorosWatchfaceShareLink | null>(null);

  const [busy, setBusy] = useState<
    "login" | "themes" | "archive" | "publish" | "project" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getCorosWatchfaceStatus()
      .then((nextStatus) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setSurface((current) => {
          if (nextStatus.authenticated && current === "sign-in") return "hub";
          if (!nextStatus.authenticated && current === "sign-in") return "sign-in";
          return current;
        });
        if (!regionTouched) {
          setRegion(nextStatus.region ?? nextStatus.suggestedRegion);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setStatus({
            authenticated: false,
            secureStorageAvailable: false,
            suggestedRegion: "us"
          });
          setSurface("sign-in");
          setError(toErrorMessage(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, regionTouched]);

  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    void api
      .listCorosWatchfaceProjects()
      .then((nextProjects) => {
        if (!cancelled) setProjects(nextProjects);
      })
      .catch((caught) => {
        if (!cancelled) setError(toErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const connected = Boolean(status?.authenticated);
  const visibleThemes = useMemo(() => {
    const query = themeSearch.trim().toLocaleLowerCase();
    if (!query) return themes;
    return themes.filter((theme) =>
      [theme.name, theme.id, theme.category, theme.firmwareType]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query))
    );
  }, [themeSearch, themes]);

  async function handleLogin(
    event: FormEvent<HTMLFormElement>,
    destination: "hub" | "publish" = "hub"
  ) {
    event.preventDefault();
    setBusy("login");
    clearMessages();
    try {
      const nextStatus = await api.loginCorosWatchfaces(email, password, region);
      setStatus(nextStatus);
      setPassword("");
      if (destination === "hub") setSurface("hub");
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
    clearMessages();
    try {
      const nextStatus = await api.logoutCorosWatchfaces();
      setStatus(nextStatus);
      setSurface("hub");
      setStudioSession(null);
      setBuiltArchive(null);
      setShareLink(null);
      setPublishOpen(false);
      setThemes([]);
      setThemesLoaded(false);
      setNotice("COROS disconnected. You can keep working locally.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function openStudio(
    archive: CorosWatchfaceArchive,
    initialName: string,
    project?: CorosWatchfaceProject
  ) {
    setStudioSession({
      id: createWatchfaceEditorSessionId(project?.projectId ?? archive.archiveId),
      archive,
      project,
      initialName: initialName.trim() || "Untitled watch face"
    });
    setBuiltArchive(null);
    setShareLink(null);
    setPublishOpen(false);
    setSurface("studio");
    clearMessages();
  }

  function returnToHub() {
    setSurface("hub");
    setStudioSession(null);
    setPublishOpen(false);
    setShareLink(null);
    clearMessages();
  }

  async function handleChooseArchive() {
    setBusy("archive");
    clearMessages();
    try {
      const selected = await api.chooseCorosWatchfaceArchive();
      if (!selected) return;
      openStudio(
        selected,
        selected.fileName.replace(/\.(zip|dat)$/i, "") || "Custom watch face"
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleLoadProject(projectId: string) {
    setBusy("project");
    clearMessages();
    try {
      const project = await api.loadCorosWatchfaceProject(projectId);
      openStudio(project.archive, project.name, project);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteProject() {
    if (!deleteTarget) return;
    setBusy("project");
    clearMessages();
    try {
      await api.deleteCorosWatchfaceProject(deleteTarget.projectId);
      setProjects((current) =>
        current.filter((project) => project.projectId !== deleteTarget.projectId)
      );
      setDeleteTarget(null);
      setNotice("Watch-face project deleted.");
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

  async function handleLoadThemes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (themeCatalog !== "editable" && !watchSerial.trim()) {
      setError("Enter the watch serial number under Advanced filters.");
      setNotice(null);
      return;
    }
    setBusy("themes");
    clearMessages();
    try {
      const nextThemes = await api.listCorosWatchfaceThemes({
        firmwareType,
        language,
        maxWatchFaceVersion: Number(maxWatchFaceVersion),
        catalog: themeCatalog,
        ...(themeCatalog !== "editable"
          ? { snCode: watchSerial, modelVersion }
          : {})
      });
      setThemes(nextThemes);
      setThemesLoaded(true);
      setNotice(
        `${nextThemes.length} ${watchfaceCatalogLabel(themeCatalog)}${
          nextThemes.length === 1 ? "" : "s"
        } loaded.`
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  async function handleDownloadTheme(theme: CorosWatchfaceTheme) {
    if (!theme.packageUrl) return;
    setDownloadingThemeUrl(theme.packageUrl);
    clearMessages();
    try {
      const download = await api.downloadCorosWatchfaceTheme({
        packageUrl: theme.packageUrl,
        name: theme.name
      });
      if (download.usableAsTemplate && download.archive) {
        openStudio(download.archive, theme.name);
      } else {
        setNotice(
          download.entries?.length
            ? `${download.message} Contents: ${download.entries.slice(0, 8).join(", ")}${
                download.entries.length > 8 ? ", …" : ""
              }`
            : download.message
        );
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setDownloadingThemeUrl(null);
    }
  }

  function openPublish(archive: CorosWatchfaceArchive, currentName: string) {
    setBuiltArchive(archive);
    setPublishName(currentName.trim() || studioSession?.initialName || "Untitled watch face");
    setShareLink(null);
    setPublishOpen(true);
    clearMessages();
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!builtArchive) return;
    if (!connected) {
      setError("Connect your COROS account before sending this watch face.");
      setNotice(null);
      return;
    }
    if (!publishName.trim()) {
      setError("Enter a watch-face name before sending.");
      setNotice(null);
      return;
    }
    setBusy("publish");
    clearMessages();
    try {
      const nextLink = await api.publishCorosWatchface({
        archiveId: builtArchive.archiveId,
        name: publishName.trim(),
        firmwareType,
        backgroundImageId: Number(backgroundImageId),
        language
      });
      setShareLink(nextLink);
      setNotice("Your COROS share link is ready.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  async function handleCopy() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink.url);
      setNotice("Share link copied.");
    } catch {
      setError("Could not copy the link. Select and copy it from the field.");
    }
  }

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  if (surface === "studio" && studioSession) {
    return (
      <div className="watchfaces-view wf-watchfaces watchface-shell watchface-shell--studio">
        <WatchfaceEditor
          key={studioSession.id}
          api={api}
          sessionId={studioSession.id}
          starterArchive={studioSession.archive}
          initialDesign={studioSession.project?.design}
          initialProjectId={studioSession.project?.projectId}
          initialProjectName={studioSession.project?.name ?? studioSession.initialName}
          onBack={returnToHub}
          onArchiveCreated={setBuiltArchive}
          onPublish={openPublish}
          onProjectSaved={handleProjectSaved}
          onError={setError}
          onNotice={setNotice}
        />
        <ToastRegion error={error} notice={notice} onDismiss={clearMessages} />
        {publishOpen ? (
          <PublishDialog
            archive={builtArchive}
            name={publishName}
            firmwareType={firmwareType}
            backgroundImageId={backgroundImageId}
            language={language}
            shareLink={shareLink}
            connected={connected}
            email={email}
            password={password}
            region={region}
            secureStorageAvailable={status?.secureStorageAvailable ?? false}
            busy={busy === "publish" || busy === "login"}
            loginBusy={busy === "login"}
            onNameChange={setPublishName}
            onFirmwareTypeChange={setFirmwareType}
            onBackgroundImageIdChange={setBackgroundImageId}
            onLanguageChange={setLanguage}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onRegionChange={(nextRegion) => {
              setRegion(nextRegion);
              setRegionTouched(true);
            }}
            onLogin={(event) => void handleLogin(event, "publish")}
            onSubmit={handlePublish}
            onCopy={() => void handleCopy()}
            onClose={() => setPublishOpen(false)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`watchfaces-view wf-watchfaces watchface-shell watchface-shell--hub ${
        surface === "sign-in" ? "watchface-shell--signin" : ""
      }`}
    >
      <header className="watchface-hub-header">
        <div className="watchface-hub-brand">
          <span className="watchface-hub-mark" aria-hidden="true">
            <Watch size={22} />
          </span>
          <div>
            <h1>Watch Faces</h1>
          </div>
        </div>
        {connected ? (
          <div className="watchface-hub-account">
            <span className="watchface-hub-connected">
              <Check size={14} aria-hidden="true" /> Connected
            </span>
            <button
              className="secondary-button watchface-hub-disconnect"
              type="button"
              disabled={busy !== null}
              onClick={() => void handleLogout()}
            >
              <LogOut size={16} aria-hidden="true" /> Disconnect
            </button>
          </div>
        ) : (
          <div className="watchface-hub-account">
            <span className="watchface-hub-auth-status">
              <ShieldCheck size={16} aria-hidden="true" /> Local mode
            </span>
            {surface === "hub" ? (
              <button
                className="secondary-button watchface-hub-connect"
                type="button"
                disabled={busy !== null}
                onClick={() => setSurface("sign-in")}
              >
                <KeyRound size={16} aria-hidden="true" /> Connect COROS
              </button>
            ) : null}
          </div>
        )}
      </header>

      <ToastRegion error={error} notice={notice} onDismiss={clearMessages} />

      {status === null ? (
        <main className="watchface-auth watchface-auth--loading" aria-busy="true">
          <div className="watchface-auth-skeleton" />
          <div className="watchface-auth-skeleton watchface-auth-skeleton--short" />
        </main>
      ) : surface === "sign-in" ? (
        <main className="watchface-auth">
          <WatchFaceStudioShowcase />
          <section className="watchface-auth-intro">
            <div className="watchface-auth-kicker">
              <Watch size={17} aria-hidden="true" />
              Watch Face Studio
            </div>
            <h2>
              Design it.{" "}
              <span className="watchface-auth-highlight">
                Wear it.
              </span>
            </h2>
            <p>
              Choose a face, edit every detail, and preview it before sending.
            </p>
          </section>
          <section className="watchface-auth-card" aria-labelledby="watchface-login-title">
            <span className="watchface-auth-icon" aria-hidden="true">
              <KeyRound size={20} />
            </span>
            <h2 id="watchface-login-title">Sign in to COROS</h2>
            <p>
              Sign in when you want to send a watch face to COROS.
            </p>
            <form
              className="watchface-auth-form"
              onSubmit={(event) => void handleLogin(event)}
            >
              <label className="field">
                Region
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
                Email
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={busy !== null}>
                {busy === "login" ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <KeyRound size={16} aria-hidden="true" />
                )}
                Sign in
              </button>
              <button
                className="secondary-button watchface-auth-skip"
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setSurface("hub");
                  clearMessages();
                }}
              >
                Continue without signing in
              </button>
            </form>
            <p className="watchface-auth-local-note">
              You can pick templates, edit them, and save your work without signing in.
            </p>
            {!status.secureStorageAvailable ? (
              <p className="watchface-auth-warning">
                Your sign-in will be removed when you close CorosLink.
              </p>
            ) : null}
          </section>
        </main>
      ) : (
        <main className="watchface-hub-main">
          <section className="watchface-hub-intro">
            <div>
              <h2>Pick up where you left off.</h2>
              <p>Open a saved project or start with a watch-face template.</p>
            </div>
          </section>

          {IS_DEVELOPMENT_BUILD && showDevelopmentTools ? (
            <>
              <DeviceInfoPanel api={api} />
              <LegacyCarrierEditorPanel api={api} />
              <RawBinInstallerPanel api={api} />
            </>
          ) : null}

          <div className="watchface-hub-toolbar">
            <div
              className="watchface-hub-tabs"
              role="tablist"
              aria-label="Watch-face hub"
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const nextTab = hubTab === "projects" ? "templates" : "projects";
                  setHubTab(nextTab);
                  window.requestAnimationFrame(() => {
                    document
                      .getElementById(`watchface-${nextTab}-tab`)
                      ?.focus();
                  });
                }
              }}
            >
              <button
                id="watchface-projects-tab"
                type="button"
                role="tab"
                aria-selected={hubTab === "projects"}
                aria-controls="watchface-projects-panel"
                tabIndex={hubTab === "projects" ? 0 : -1}
                className={hubTab === "projects" ? "is-active" : ""}
                onClick={() => setHubTab("projects")}
              >
                <FileArchive size={16} aria-hidden="true" /> Projects
                <span>{projects.length}</span>
              </button>
              <button
                id="watchface-templates-tab"
                type="button"
                role="tab"
                aria-selected={hubTab === "templates"}
                aria-controls="watchface-templates-panel"
                tabIndex={hubTab === "templates" ? 0 : -1}
                className={hubTab === "templates" ? "is-active" : ""}
                onClick={() => setHubTab("templates")}
              >
                <LayoutGrid size={16} aria-hidden="true" /> Templates
              </button>
            </div>
            <div className="watchface-hub-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy !== null}
                onClick={() => void handleChooseArchive()}
              >
                {busy === "archive" ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Upload size={16} aria-hidden="true" />
                )}
                Open archive
              </button>
            </div>
          </div>

          {hubTab === "projects" ? (
            <div
              id="watchface-projects-panel"
              className="watchface-hub-projects"
              role="tabpanel"
              aria-labelledby="watchface-projects-tab"
            >
              <section className="watchface-hub-section" aria-labelledby="projects-title">
                <div className="watchface-hub-section-heading">
                  <div>
                    <h3 id="projects-title">Recent projects</h3>
                    <p>Everything you saved locally, newest first.</p>
                  </div>
                </div>
                {projectsLoading ? (
                  <div className="watchface-project-skeletons" aria-label="Loading projects">
                    <div />
                    <div />
                    <div />
                  </div>
                ) : projects.length > 0 ? (
                  <div className="watchface-project-list">
                    {projects.map((project) => (
                      <article className="watchface-project-row" key={project.projectId}>
                        <button
                          className="watchface-project-open"
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void handleLoadProject(project.projectId)}
                        >
                          <span className="watchface-project-icon" aria-hidden="true">
                            <Watch size={20} />
                          </span>
                          <span className="watchface-project-copy">
                            <strong>{project.name}</strong>
                            <span>
                              Template {project.sourceTemplateId}. Updated {formatUpdatedAt(project.updatedAt)}
                            </span>
                          </span>
                          <span className="watchface-project-cta">
                            {busy === "project" ? (
                              <Loader2 className="spin" size={15} aria-hidden="true" />
                            ) : (
                              <ArrowRight size={15} aria-hidden="true" />
                            )}
                            Open
                          </span>
                        </button>
                        <button
                          className="icon-button watchface-project-delete"
                          type="button"
                          aria-label={`Delete ${project.name}`}
                          disabled={busy !== null}
                          onClick={() => setDeleteTarget(project)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="watchface-hub-empty">
                    <span aria-hidden="true"><FileArchive size={24} /></span>
                    <h4>No projects yet</h4>
                    <p>Choose a template to create your first watch face.</p>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => setHubTab("templates")}
                    >
                      Browse templates
                    </button>
                  </div>
                )}
              </section>
              <BatteryHistoryPanel
                api={api}
                disabled={busy !== null}
                authenticated={connected}
              />
            </div>
          ) : (
            <TemplatesPanel
              busy={busy}
              catalog={themeCatalog}
              firmwareType={firmwareType}
              language={language}
              maxWatchFaceVersion={maxWatchFaceVersion}
              watchSerial={watchSerial}
              modelVersion={modelVersion}
              search={themeSearch}
              themes={themes}
              visibleThemes={visibleThemes}
              themesLoaded={themesLoaded}
              downloadingThemeUrl={downloadingThemeUrl}
              onCatalogChange={(nextCatalog) => {
                setThemeCatalog(nextCatalog);
                setThemes([]);
                setThemesLoaded(false);
              }}
              onFirmwareTypeChange={setFirmwareType}
              onLanguageChange={setLanguage}
              onMaxVersionChange={setMaxWatchFaceVersion}
              onWatchSerialChange={setWatchSerial}
              onModelVersionChange={setModelVersion}
              onSearchChange={setThemeSearch}
              onSubmit={handleLoadThemes}
              onUseTheme={(theme) => void handleDownloadTheme(theme)}
            />
          )}
        </main>
      )}

      {deleteTarget ? (
        <ConfirmDeleteDialog
          project={deleteTarget}
          busy={busy === "project"}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDeleteProject()}
        />
      ) : null}
    </div>
  );
}

interface TemplatesPanelProps {
  busy: "login" | "themes" | "archive" | "publish" | "project" | null;
  catalog: CorosWatchfaceThemeCatalog;
  firmwareType: string;
  language: string;
  maxWatchFaceVersion: string;
  watchSerial: string;
  modelVersion: string;
  search: string;
  themes: CorosWatchfaceTheme[];
  visibleThemes: CorosWatchfaceTheme[];
  themesLoaded: boolean;
  downloadingThemeUrl: string | null;
  onCatalogChange: (catalog: CorosWatchfaceThemeCatalog) => void;
  onFirmwareTypeChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onMaxVersionChange: (value: string) => void;
  onWatchSerialChange: (value: string) => void;
  onModelVersionChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUseTheme: (theme: CorosWatchfaceTheme) => void;
}

function TemplatesPanel(props: TemplatesPanelProps) {
  return (
    <section
      id="watchface-templates-panel"
      className="watchface-hub-section watchface-template-browser"
      role="tabpanel"
      aria-labelledby="watchface-templates-tab"
    >
      <div className="watchface-hub-section-heading">
        <div>
          <h3>Template library</h3>
          <p>Choose a compatible base, then make it yours in Studio.</p>
        </div>
      </div>
      <form className="watchface-template-controls" onSubmit={props.onSubmit}>
        <label className="field">
          Catalog
          <select
            value={props.catalog}
            onChange={(event) =>
              props.onCatalogChange(event.target.value as CorosWatchfaceThemeCatalog)
            }
          >
            <option value="editable">Editable templates</option>
            <option value="official">Official watch faces</option>
            <option value="custom">My custom watch faces</option>
          </select>
        </label>
        <label className="watchface-template-search">
          <span className="sr-only">Search loaded templates</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search templates"
          />
        </label>
        <button className="primary-button" type="submit" disabled={props.busy !== null}>
          {props.busy === "themes" ? (
            <Loader2 className="spin" size={16} aria-hidden="true" />
          ) : (
            <Search size={16} aria-hidden="true" />
          )}
          {props.themesLoaded ? "Refresh" : "Browse"}
        </button>
        <details className="watchface-template-advanced">
          <summary>Advanced filters</summary>
          <div className="watchface-template-advanced-grid">
            <label className="field">
              Firmware type
              <input
                value={props.firmwareType}
                onChange={(event) => props.onFirmwareTypeChange(event.target.value)}
                required
              />
            </label>
            <label className="field">
              Language
              <input
                value={props.language}
                pattern="[a-z]{2,3}-[A-Z]{2}"
                onChange={(event) => props.onLanguageChange(event.target.value)}
                required
              />
            </label>
            <label className="field">
              Maximum version
              <input
                type="number"
                min="0"
                max="999"
                step="1"
                value={props.maxWatchFaceVersion}
                onChange={(event) => props.onMaxVersionChange(event.target.value)}
                required
              />
            </label>
            {props.catalog !== "editable" ? (
              <>
                <label className="field">
                  Watch serial number
                  <input
                    value={props.watchSerial}
                    onChange={(event) => props.onWatchSerialChange(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  Model version
                  <input
                    value={props.modelVersion}
                    onChange={(event) => props.onModelVersionChange(event.target.value)}
                  />
                </label>
              </>
            ) : null}
          </div>
        </details>
      </form>

      {props.themesLoaded ? (
        <div className="watchface-template-results">
          <div className="watchface-template-results-count">
            <strong>{props.visibleThemes.length}</strong>
            <span>
              {props.visibleThemes.length === 1 ? "result" : "results"}
              {props.search.trim() ? ` of ${props.themes.length}` : ""}
            </span>
          </div>
          {props.visibleThemes.length > 0 ? (
            <div className="watchface-template-grid">
              {props.visibleThemes.map((theme, index) => (
                <article
                  className="watchface-template-card"
                  key={theme.id ?? `${theme.name}-${index}`}
                >
                  <div className="watchface-template-preview">
                    {theme.previewImageUrl ? (
                      <img
                        src={theme.previewImageUrl}
                        alt={`${theme.name} preview`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    <Watch size={26} aria-hidden="true" />
                  </div>
                  <div className="watchface-template-copy">
                    <strong title={theme.name}>{theme.name}</strong>
                    <div className="watchface-template-meta">
                      {theme.category ? <span>{theme.category}</span> : null}
                      {theme.id ? <span>ID {theme.id}</span> : null}
                      {theme.watchFaceVersion !== undefined ? (
                        <span>v{theme.watchFaceVersion}</span>
                      ) : null}
                    </div>
                    {theme.packageUrl ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={props.busy !== null || props.downloadingThemeUrl !== null}
                        onClick={() => props.onUseTheme(theme)}
                      >
                        {props.downloadingThemeUrl === theme.packageUrl ? (
                          <Loader2 className="spin" size={14} aria-hidden="true" />
                        ) : (
                          <Download size={14} aria-hidden="true" />
                        )}
                        {props.catalog === "editable" ? "Use template" : "Download"}
                      </button>
                    ) : (
                      <span className="watchface-template-unavailable">Unavailable</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="watchface-hub-empty">
              <span aria-hidden="true"><Search size={24} /></span>
              <h4>{props.themes.length === 0 ? "No templates found" : "No matches"}</h4>
              <p>
                {props.themes.length === 0
                  ? "Try a different catalog or update the advanced filters."
                  : "Try a different search term."}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="watchface-template-welcome">
          <span aria-hidden="true"><LayoutGrid size={26} /></span>
          <h4>Find a starting point</h4>
          <p>Browse COROS templates compatible with your watch and firmware.</p>
        </div>
      )}
    </section>
  );
}

interface PublishDialogProps {
  archive: CorosWatchfaceArchive | null;
  name: string;
  firmwareType: string;
  backgroundImageId: string;
  language: string;
  shareLink: CorosWatchfaceShareLink | null;
  connected: boolean;
  email: string;
  password: string;
  region: CorosWatchfaceRegion;
  secureStorageAvailable: boolean;
  busy: boolean;
  loginBusy: boolean;
  onNameChange: (value: string) => void;
  onFirmwareTypeChange: (value: string) => void;
  onBackgroundImageIdChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRegionChange: (value: CorosWatchfaceRegion) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCopy: () => void;
  onClose: () => void;
}

function PublishDialog(props: PublishDialogProps) {
  return (
    <div className="watchface-modal-backdrop" role="presentation">
      <section
        className="watchface-modal watchface-publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watchface-publish-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !props.busy) props.onClose();
        }}
      >
        <button
          className="icon-button watchface-modal-close"
          type="button"
          aria-label="Close Send to COROS"
          disabled={props.busy}
          onClick={props.onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
        {props.shareLink ? (
          <>
            <div className="watchface-publish-heading">
              <span className="watchface-publish-icon is-success" aria-hidden="true">
                <Check size={20} />
              </span>
              <h2 id="watchface-publish-title">{props.name}</h2>
              <p>Scan with the iPhone that has your COROS app.</p>
            </div>
            <div className="watchface-share-result">
              <img
                className="watchface-share-qr"
                src={props.shareLink.qrDataUrl}
                alt="QR code for the official COROS watch-face link"
                width={260}
                height={260}
              />
              <div className="watchface-share-details">
                <p>
                  In COROS, save this face and send it to the watch paired with
                  your iPhone.
                </p>
                <p className="watchface-share-expiry">
                  Link expires {formatExpiry(props.shareLink.expiresAt)}.
                </p>
                <div className="watchface-share-actions">
                  <button className="secondary-button" type="button" onClick={props.onCopy}>
                    <Clipboard size={16} aria-hidden="true" /> Copy link
                  </button>
                  <a
                    className="primary-button"
                    href={props.shareLink.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} aria-hidden="true" /> Open link
                  </a>
                </div>
                <input
                  className="watchface-share-link"
                  value={props.shareLink.url}
                  readOnly
                  aria-label="Official COROS share link"
                />
              </div>
            </div>
          </>
        ) : !props.connected ? (
          <>
            <div className="watchface-publish-heading">
              <span className="watchface-publish-icon" aria-hidden="true">
                <KeyRound size={20} />
              </span>
              <h2 id="watchface-publish-title">{props.name}</h2>
              <p>Connect your COROS account to send this watch face.</p>
            </div>
            <form
              className="watchface-publish-form watchface-publish-login"
              onSubmit={props.onLogin}
            >
              <label className="field">
                Account region
                <select
                  autoFocus
                  value={props.region}
                  onChange={(event) =>
                    props.onRegionChange(event.target.value as CorosWatchfaceRegion)
                  }
                >
                  {REGION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Email
                <input
                  type="email"
                  autoComplete="username"
                  value={props.email}
                  onChange={(event) => props.onEmailChange(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={props.password}
                  onChange={(event) => props.onPasswordChange(event.target.value)}
                  required
                />
              </label>
              <button
                className="primary-button watchface-publish-submit"
                type="submit"
                disabled={props.loginBusy}
              >
                {props.loginBusy ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <KeyRound size={16} aria-hidden="true" />
                )}
                Connect and continue
              </button>
            </form>
            <p className="watchface-publish-auth-note">
              The archive is already built and stays open if you close this window.
              Your password is only used to create the COROS upload session.
            </p>
            {!props.secureStorageAvailable ? (
              <p className="watchface-auth-warning">
                Secure storage is unavailable. This session will be cleared when
                CorosLink closes.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="watchface-publish-heading">
              <span className="watchface-publish-icon" aria-hidden="true">
                <Send size={20} />
              </span>
              <h2 id="watchface-publish-title">{props.name}</h2>
              <p>Upload the current design and create its official COROS link.</p>
            </div>
            <form className="watchface-publish-form" onSubmit={props.onSubmit}>
              <label className="field">
                Watch-face name
                <input
                  autoFocus
                  value={props.name}
                  minLength={1}
                  maxLength={80}
                  onChange={(event) => props.onNameChange(event.target.value)}
                  required
                />
              </label>
              <details className="watchface-publish-settings">
                <summary>Upload settings</summary>
                <div className="watchface-publish-settings-grid">
                  <label className="field">
                    Firmware type
                    <input
                      value={props.firmwareType}
                      onChange={(event) => props.onFirmwareTypeChange(event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    Background ID
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={props.backgroundImageId}
                      onChange={(event) => props.onBackgroundImageIdChange(event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    Language
                    <input
                      value={props.language}
                      pattern="[a-z]{2,3}-[A-Z]{2}"
                      onChange={(event) => props.onLanguageChange(event.target.value)}
                      required
                    />
                  </label>
                </div>
              </details>
              <button
                className="primary-button watchface-publish-submit"
                type="submit"
                disabled={props.busy || !props.archive}
              >
                {props.busy ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Send size={16} aria-hidden="true" />
                )}
                Send to COROS
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function ConfirmDeleteDialog({
  project,
  busy,
  onCancel,
  onConfirm
}: {
  project: CorosWatchfaceProjectSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="watchface-modal-backdrop" role="presentation">
      <section
        className="watchface-modal watchface-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="watchface-delete-title"
        aria-describedby="watchface-delete-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <span className="watchface-delete-icon" aria-hidden="true">
          <Trash2 size={20} />
        </span>
        <h2 id="watchface-delete-title">Delete “{project.name}”?</h2>
        <p id="watchface-delete-description">
          This removes the locally saved project. It cannot be undone.
        </p>
        <div className="watchface-modal-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="secondary-button danger-button" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
            Delete project
          </button>
        </div>
      </section>
    </div>
  );
}

function WatchFaceStudioShowcase() {
  return (
    <div className="watchface-auth-gallery" aria-hidden="true">
      {AUTH_WATCH_FACE_PREVIEWS.map((src, index) => (
        <div
          className={`watchface-auth-gallery-runner watchface-auth-gallery-runner--${index % 3}`}
          key={src}
          style={{
            "--face-index": index,
            "--face-slot": Math.floor(index / 3),
            "--face-delay": `${Math.floor(index / 3) * -6.1 - (index % 3) * 1.2}s`,
            "--face-scale": 0.76 + ((index + 1) % 3) * 0.1
          } as CSSProperties}
        >
          <div className="watchface-auth-gallery-face">
            <img src={src} alt="" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ToastRegion({
  error,
  notice,
  onDismiss
}: {
  error: string | null;
  notice: string | null;
  onDismiss: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div
      className={`watchface-toast ${error ? "is-error" : "is-success"}`}
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span aria-hidden="true">
        {error ? <X size={16} /> : <Check size={16} />}
      </span>
      <p>{error ?? notice}</p>
      <button className="icon-button" type="button" aria-label="Dismiss message" onClick={onDismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "recently";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function watchfaceCatalogLabel(catalog: CorosWatchfaceThemeCatalog): string {
  switch (catalog) {
    case "official":
      return "official watch face";
    case "custom":
      return "custom watch face";
    default:
      return "editable template";
  }
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "soon" : date.toLocaleString();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Watch-face request failed.";
}
