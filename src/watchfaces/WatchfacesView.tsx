import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  ExternalLink,
  KeyRound,
  LayoutGrid,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  Watch,
  X
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceDesignState,
  CorosWatchfaceProject,
  CorosWatchfaceProjectSummary,
  CorosWatchfaceRegion,
  CorosWatchfaceShareLink,
  CorosWatchfaceStatus,
  CorosWatchfaceTheme,
  CorosWatchfaceThemeCatalog,
  CorosWatchfaceTemplateAsset,
  WatchModelId,
  WatchStatus
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  getWatchPresentation,
  getWatchfaceDeviceProfile,
  getWatchfaceDeviceProfileByFirmware
} from "../watchModels";
import { BatteryHistoryPanel } from "./BatteryHistoryPanel";
import { DeviceInfoPanel } from "./DeviceInfoPanel";
import { LegacyCarrierEditorPanel } from "./LegacyCarrierEditorPanel";
import { RawBinInstallerPanel } from "./RawBinInstallerPanel";
import { WatchfaceEditor } from "./WatchfaceEditor";
import { renderDesignBackground } from "./watchfaceBackground";
import { deriveDesignDetails, toStudioOptions } from "./watchfaceCompose";
import { createWatchfaceEditorSessionId } from "./watchfaceEditorHistory";
import {
  drawStudioPreview,
  detailsForPreviewResolution,
  loadStudioImage,
  pickPreviewResolution,
  pickWatchPreviewResolution
} from "./watchfaceStudio";
import { weatherPreviewUrl } from "./weatherAssets";
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
  watchStatus: WatchStatus | null;
}

type WatchfaceSurface = "sign-in" | "hub" | "studio";
type HubTab = "projects" | "templates";

interface StudioSession {
  id: string;
  archive: CorosWatchfaceArchive;
  project?: CorosWatchfaceProject;
  initialDesign?: CorosWatchfaceDesignState;
  initialName: string;
  targetFirmwareType: string;
  targetWatchModel?: WatchModelId;
}

const DEFAULT_FIRMWARE_TYPE = "COROS W332";
const DEFAULT_MODEL_VERSION = "W332-3.1708.0";
const IS_DEVELOPMENT_BUILD = import.meta.env.DEV;

const REGION_OPTIONS: { value: CorosWatchfaceRegion; label: string }[] = [
  { value: "eu", label: "Europe" },
  { value: "us", label: "United States" },
  { value: "cn", label: "China / Asia-Pacific" }
];

export function WatchfacesView({ api, showDevelopmentTools, watchStatus }: WatchfacesViewProps) {
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
  const [watchSerial, setWatchSerial] = useState("x");
  const [modelVersion, setModelVersion] = useState(DEFAULT_MODEL_VERSION);
  const [themes, setThemes] = useState<CorosWatchfaceTheme[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  const [themeSearch, setThemeSearch] = useState("");
  const [downloadingThemeUrl, setDownloadingThemeUrl] = useState<string | null>(
    null
  );

  const [builtArchive, setBuiltArchive] =
    useState<CorosWatchfaceArchive | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importShareUrl, setImportShareUrl] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [shareLink, setShareLink] = useState<CorosWatchfaceShareLink | null>(null);

  const [busy, setBusy] = useState<
    "login" | "themes" | "archive" | "publish" | "project" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyDetectedFirmwareType = useCallback((nextFirmwareType: string) => {
    const normalized = nextFirmwareType.trim();
    if (!normalized) return;
    const profile = getWatchfaceDeviceProfileByFirmware(normalized);
    setFirmwareType(normalized);
    setModelVersion(profile?.modelVersion ?? "");
    setThemes([]);
    setThemesLoaded(false);
  }, []);

  useEffect(() => {
    if (!watchStatus?.connected) return;
    const profile = getWatchfaceDeviceProfile(watchStatus.model);
    if (profile) {
      applyDetectedFirmwareType(profile.firmwareType);
    }
  }, [applyDetectedFirmwareType, watchStatus?.connected, watchStatus?.model]);

  const handlePairedFirmwareTypeDetected = useCallback(
    (nextFirmwareType: string) => {
      // A physically connected watch is the strongest signal. Do not let the
      // first account-profile device switch an attached APEX 4 back to W332.
      if (
        watchStatus?.connected &&
        getWatchfaceDeviceProfile(watchStatus.model)
      ) {
        return;
      }
      applyDetectedFirmwareType(nextFirmwareType);
    },
    [applyDetectedFirmwareType, watchStatus?.connected, watchStatus?.model]
  );

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
  const watchPresentation = useMemo(
    () => getWatchPresentation(watchStatus),
    [watchStatus]
  );
  const connectedWatchName = watchStatus?.connected
    ? watchPresentation.productName ??
      watchStatus.name?.replace(/^COROS\s+/i, "") ??
      watchPresentation.displayName.replace(/^COROS\s+/i, "")
    : null;
  const featuredProject = useMemo(
    () =>
      projects.reduce<CorosWatchfaceProjectSummary | null>((latest, project) => {
        if (!latest) return project;
        return updatedAtValue(project.updatedAt) > updatedAtValue(latest.updatedAt)
          ? project
          : latest;
      }, null),
    [projects]
  );
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
    const targetFirmwareType =
      archive.firmwareType?.trim() || project?.firmwareType?.trim() || firmwareType;
    const targetWatchModel = watchStatus?.connected
      ? watchStatus.model
      : undefined;
    applyDetectedFirmwareType(targetFirmwareType);
    setStudioSession({
      id: createWatchfaceEditorSessionId(project?.projectId ?? archive.archiveId),
      archive,
      project,
      ...(project?.design || archive.editableProject?.design
        ? { initialDesign: project?.design ?? archive.editableProject?.design }
        : {}),
      initialName:
        project?.name ??
        archive.editableProject?.name ??
        (initialName.trim() || "Untitled watch face"),
      targetFirmwareType,
      ...(targetWatchModel ? { targetWatchModel } : {})
    });
    setBuiltArchive(null);
    setImportOpen(false);
    setImportShareUrl("");
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
        selected.editableProject?.name ??
          (selected.fileName.replace(/\.(zip|dat)$/i, "") ||
            "Custom watch face")
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleImportShareLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const shareUrl = importShareUrl.trim();
    if (!shareUrl) {
      setError("Paste a COROS watch-face share link.");
      setNotice(null);
      return;
    }
    setBusy("archive");
    clearMessages();
    try {
      const imported = await api.importCorosWatchfaceShareLink(shareUrl);
      openStudio(imported.archive, imported.name);
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
      sourceTemplateId: saved.sourceTemplateId,
      ...(saved.firmwareType ? { firmwareType: saved.firmwareType } : {})
    };
    setProjects((current) => [
      summary,
      ...current.filter((project) => project.projectId !== summary.projectId)
    ]);
  }

  async function handleLoadThemes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("themes");
    clearMessages();
    try {
      const nextThemes = await api.listCorosWatchfaceThemes({
        firmwareType,
        language,
        maxWatchFaceVersion: Number(maxWatchFaceVersion),
        catalog: themeCatalog,
        ...(themeCatalog !== "editable"
          ? { snCode: watchSerial.trim() || "x", modelVersion }
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
        name: theme.name,
        firmwareType: theme.firmwareType?.trim() || firmwareType
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
    if (archive.firmwareType) {
      setFirmwareType(archive.firmwareType);
    }
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
          targetFirmwareType={studioSession.targetFirmwareType}
          targetWatchModel={studioSession.targetWatchModel}
          initialDesign={studioSession.initialDesign}
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
      {surface !== "sign-in" ? (
        <WatchFacesHeader
          accountConnected={connected}
          connectedWatchName={connectedWatchName}
          watchStatus={watchStatus}
          statusLoading={status === null || watchStatus === null}
          busy={busy !== null}
          importing={busy === "archive"}
          onConnect={() => setSurface("sign-in")}
          onDisconnect={() => void handleLogout()}
          onImport={() => setImportOpen(true)}
          onCreate={() => setHubTab("templates")}
        />
      ) : null}

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
          {IS_DEVELOPMENT_BUILD && showDevelopmentTools ? (
            <>
              <DeviceInfoPanel api={api} />
              <LegacyCarrierEditorPanel api={api} />
              <RawBinInstallerPanel api={api} />
            </>
          ) : null}

          <WatchFacesTabs
            activeTab={hubTab}
            projectCount={projects.length}
            onChange={setHubTab}
          />

          {hubTab === "projects" ? (
            <ProjectsDashboard
              api={api}
              projects={projects}
              featuredProject={featuredProject}
              loading={projectsLoading}
              disabled={busy !== null}
              openingProject={busy === "project"}
              accountConnected={connected}
              onFirmwareTypeDetected={handlePairedFirmwareTypeDetected}
              onOpen={(project) => void handleLoadProject(project.projectId)}
              onDelete={setDeleteTarget}
              onCreate={() => setHubTab("templates")}
              onImport={() => setImportOpen(true)}
            />
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
              onFirmwareTypeChange={applyDetectedFirmwareType}
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
      {importOpen ? (
        <ImportWatchfaceDialog
          shareUrl={importShareUrl}
          busy={busy === "archive"}
          onShareUrlChange={setImportShareUrl}
          onChooseArchive={() => void handleChooseArchive()}
          onSubmit={handleImportShareLink}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface WatchFacesHeaderProps {
  accountConnected: boolean;
  connectedWatchName: string | null;
  watchStatus: WatchStatus | null;
  statusLoading: boolean;
  busy: boolean;
  importing: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onImport: () => void;
  onCreate: () => void;
}

function WatchFacesHeader({
  accountConnected,
  connectedWatchName,
  watchStatus,
  statusLoading,
  busy,
  importing,
  onConnect,
  onDisconnect,
  onImport,
  onCreate
}: WatchFacesHeaderProps) {
  return (
    <header className="watchface-hub-header watchface-dashboard-header">
      <div className="watchface-hub-brand">
        <span className="watchface-hub-mark" aria-hidden="true">
          <Watch size={21} />
        </span>
        <div className="watchface-hub-brand-copy">
          <h1>Watch Faces</h1>
          <p>Create, customize, and install faces for your COROS watch.</p>
        </div>
      </div>
      <div className="watchface-hub-actions">
        <DeviceStatusMenu
          accountConnected={accountConnected}
          connectedWatchName={connectedWatchName}
          watchStatus={watchStatus}
          statusLoading={statusLoading}
          busy={busy}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
        <button
          className="secondary-button watchface-header-action"
          type="button"
          disabled={busy}
          onClick={onImport}
        >
          {importing ? (
            <Loader2 className="spin" size={16} aria-hidden="true" />
          ) : (
            <Upload size={16} aria-hidden="true" />
          )}
          Import
        </button>
        <button
          className="primary-button watchface-header-action"
          type="button"
          disabled={busy}
          onClick={onCreate}
        >
          <Plus size={17} aria-hidden="true" />
          New watch face
        </button>
      </div>
    </header>
  );
}

interface DeviceStatusMenuProps {
  accountConnected: boolean;
  connectedWatchName: string | null;
  watchStatus: WatchStatus | null;
  statusLoading: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function DeviceStatusMenu({
  accountConnected,
  connectedWatchName,
  watchStatus,
  statusLoading,
  busy,
  onConnect,
  onDisconnect
}: DeviceStatusMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const label = statusLoading
    ? "Checking watch"
    : connectedWatchName
      ? `${connectedWatchName} connected`
      : "No watch connected";

  return (
    <div className="watchface-device-menu" ref={containerRef}>
      <button
        className={`watchface-device-trigger${connectedWatchName ? " is-connected" : ""}`}
        type="button"
        aria-label={`${label}. Open connection details`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={statusLoading}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="watchface-device-dot" aria-hidden="true" />
        {statusLoading ? (
          <span className="watchface-device-label-skeleton" aria-hidden="true" />
        ) : (
          <span title={label}>{label}</span>
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="watchface-device-popover" role="menu">
          <div className="watchface-device-popover-heading">
            <span className={`watchface-device-icon${connectedWatchName ? " is-connected" : ""}`}>
              <Watch size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{connectedWatchName ?? "No watch connected"}</strong>
              <span>
                {connectedWatchName
                  ? "Connected through the CorosLink watch service"
                  : "Connect a COROS watch to see it here"}
              </span>
            </div>
          </div>
          <dl className="watchface-device-details">
            <div>
              <dt>Watch</dt>
              <dd>{watchStatus?.connected ? "Connected" : "Disconnected"}</dd>
            </div>
            <div>
              <dt>COROS account</dt>
              <dd>{accountConnected ? "Connected" : "Local mode"}</dd>
            </div>
            {watchStatus?.rootPath ? (
              <div>
                <dt>Connection</dt>
                <dd title={watchStatus.rootPath}>USB storage</dd>
              </div>
            ) : null}
          </dl>
          {watchStatus?.error ? (
            <p className="watchface-device-error">{watchStatus.error}</p>
          ) : null}
          {accountConnected ? (
            <button
              className="watchface-device-account-action is-danger"
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
            >
              <LogOut size={15} aria-hidden="true" />
              Disconnect COROS account
            </button>
          ) : (
            <button
              className="watchface-device-account-action"
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onConnect();
              }}
            >
              <KeyRound size={15} aria-hidden="true" />
              Connect COROS account
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WatchFacesTabs({
  activeTab,
  projectCount,
  onChange
}: {
  activeTab: HubTab;
  projectCount: number;
  onChange: (tab: HubTab) => void;
}) {
  return (
    <div
      className="watchface-hub-tabs watchface-dashboard-tabs"
      role="tablist"
      aria-label="Watch-face hub"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const nextTab = activeTab === "projects" ? "templates" : "projects";
        onChange(nextTab);
        window.requestAnimationFrame(() => {
          document.getElementById(`watchface-${nextTab}-tab`)?.focus();
        });
      }}
    >
      <button
        id="watchface-projects-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === "projects"}
        aria-controls="watchface-projects-panel"
        tabIndex={activeTab === "projects" ? 0 : -1}
        className={activeTab === "projects" ? "is-active" : ""}
        onClick={() => onChange("projects")}
      >
        Projects <span>{projectCount}</span>
      </button>
      <button
        id="watchface-templates-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === "templates"}
        aria-controls="watchface-templates-panel"
        tabIndex={activeTab === "templates" ? 0 : -1}
        className={activeTab === "templates" ? "is-active" : ""}
        onClick={() => onChange("templates")}
      >
        Templates
      </button>
    </div>
  );
}

interface ProjectsDashboardProps {
  api: CorosLinkApi;
  projects: CorosWatchfaceProjectSummary[];
  featuredProject: CorosWatchfaceProjectSummary | null;
  loading: boolean;
  disabled: boolean;
  openingProject: boolean;
  accountConnected: boolean;
  onFirmwareTypeDetected: (firmwareType: string) => void;
  onOpen: (project: CorosWatchfaceProjectSummary) => void;
  onDelete: (project: CorosWatchfaceProjectSummary) => void;
  onCreate: () => void;
  onImport: () => void;
}

function ProjectsDashboard({
  api,
  projects,
  featuredProject,
  loading,
  disabled,
  openingProject,
  accountConnected,
  onFirmwareTypeDetected,
  onOpen,
  onDelete,
  onCreate,
  onImport
}: ProjectsDashboardProps) {
  return (
    <div
      id="watchface-projects-panel"
      className="watchface-hub-projects watchface-dashboard-projects"
      role="tabpanel"
      aria-labelledby="watchface-projects-tab"
    >
      {loading ? (
        <ProjectsDashboardSkeleton />
      ) : featuredProject ? (
        <>
          <ContinueDesigningCard
            api={api}
            project={featuredProject}
            disabled={disabled}
            opening={openingProject}
            onOpen={() => onOpen(featuredProject)}
            onDelete={() => onDelete(featuredProject)}
          />
          <section className="watchface-recent-section" aria-labelledby="projects-title">
            <div className="watchface-section-heading">
              <h2 id="projects-title">Recent projects</h2>
            </div>
            <div className="watchface-project-grid">
              {projects.map((project) => (
                <ProjectCard
                  api={api}
                  project={project}
                  key={project.projectId}
                  disabled={disabled}
                  onOpen={() => onOpen(project)}
                  onDelete={() => onDelete(project)}
                />
              ))}
              <CreateProjectCard disabled={disabled} onCreate={onCreate} />
            </div>
          </section>
        </>
      ) : (
        <section className="watchface-project-empty" aria-labelledby="watchface-empty-title">
          <span className="watchface-project-empty-icon" aria-hidden="true">
            <Watch size={26} />
          </span>
          <h2 id="watchface-empty-title">Your watch faces will appear here</h2>
          <p>
            Start with an official template or import an existing project archive.
          </p>
          <div className="watchface-project-empty-actions">
            <button className="primary-button" type="button" disabled={disabled} onClick={onCreate}>
              <Plus size={16} aria-hidden="true" /> Create watch face
            </button>
            <button className="secondary-button" type="button" disabled={disabled} onClick={onImport}>
              <Upload size={16} aria-hidden="true" /> Import archive
            </button>
          </div>
        </section>
      )}
      <BatteryHistoryPanel
        api={api}
        disabled={disabled}
        authenticated={accountConnected}
        onFirmwareTypeDetected={onFirmwareTypeDetected}
      />
    </div>
  );
}

function ContinueDesigningCard({
  api,
  project,
  disabled,
  opening,
  onOpen,
  onDelete
}: {
  api: CorosLinkApi;
  project: CorosWatchfaceProjectSummary;
  disabled: boolean;
  opening: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="watchface-featured-card">
      <span className="watchface-featured-label">Continue designing</span>
      <ProjectOverflowMenu
        projectName={project.name}
        disabled={disabled}
        onOpen={onOpen}
        onDelete={onDelete}
      />
      <div className="watchface-featured-layout">
        <div className="watchface-featured-stage">
          <WatchFacePreview api={api} project={project} />
        </div>
        <div className="watchface-featured-copy">
          <h2 title={project.name}>{project.name}</h2>
          <p>Template {project.sourceTemplateId}</p>
          <p title={formatExactUpdatedAt(project.updatedAt)}>
            Updated {formatRelativeUpdatedAt(project.updatedAt)}
          </p>
          <button
            className="primary-button watchface-featured-open"
            type="button"
            disabled={disabled}
            onClick={onOpen}
          >
            {opening ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : null}
            Open editor <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function ProjectCard({
  api,
  project,
  disabled,
  onOpen,
  onDelete
}: {
  api: CorosLinkApi;
  project: CorosWatchfaceProjectSummary;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="watchface-project-card">
      <button
        className="watchface-project-card-open"
        type="button"
        aria-label={`Open ${project.name}`}
        disabled={disabled}
        onClick={onOpen}
      >
        <span className="watchface-project-card-stage">
          <WatchFacePreview api={api} project={project} />
        </span>
        <span className="watchface-project-card-copy">
          <strong title={project.name}>{project.name}</strong>
          <span title={formatExactUpdatedAt(project.updatedAt)}>
            Updated {formatRelativeUpdatedAt(project.updatedAt)}
          </span>
          <span>Template {project.sourceTemplateId}</span>
        </span>
      </button>
      <ProjectOverflowMenu
        projectName={project.name}
        disabled={disabled}
        onOpen={onOpen}
        onDelete={onDelete}
      />
    </article>
  );
}

function CreateProjectCard({
  disabled,
  onCreate
}: {
  disabled: boolean;
  onCreate: () => void;
}) {
  return (
    <button
      className="watchface-create-card"
      type="button"
      disabled={disabled}
      onClick={onCreate}
    >
      <span aria-hidden="true"><Plus size={23} /></span>
      <strong>Create watch face</strong>
    </button>
  );
}

function ProjectOverflowMenu({
  projectName,
  disabled,
  onOpen,
  onDelete
}: {
  projectName: string;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="watchface-project-menu" ref={containerRef}>
      <button
        className="watchface-project-menu-trigger"
        type="button"
        aria-label={`Project actions for ${projectName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontal size={19} aria-hidden="true" />
      </button>
      {open ? (
        <div className="watchface-project-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onOpen();
            }}
          >
            <ArrowRight size={15} aria-hidden="true" /> Open
          </button>
          <button
            className="is-danger"
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={15} aria-hidden="true" /> Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProjectsDashboardSkeleton() {
  return (
    <div className="watchface-dashboard-skeleton" aria-label="Loading projects" aria-busy="true">
      <div className="watchface-featured-skeleton">
        <span />
        <div />
      </div>
      <div className="watchface-project-grid-skeleton">
        <div />
        <div />
        <div />
      </div>
    </div>
  );
}

type ProjectPreviewState = "loading" | "ready" | "error";

interface ProjectPreviewCacheEntry {
  updatedAt: string;
  promise: Promise<CorosWatchfaceProject>;
}

const projectPreviewCache = new WeakMap<
  CorosLinkApi,
  Map<string, ProjectPreviewCacheEntry>
>();

function loadProjectPreview(
  api: CorosLinkApi,
  project: CorosWatchfaceProjectSummary
): Promise<CorosWatchfaceProject> {
  let cache = projectPreviewCache.get(api);
  if (!cache) {
    cache = new Map();
    projectPreviewCache.set(api, cache);
  }
  const cached = cache.get(project.projectId);
  if (cached?.updatedAt === project.updatedAt) return cached.promise;
  const promise = api.loadCorosWatchfaceProject(project.projectId);
  cache.set(project.projectId, { updatedAt: project.updatedAt, promise });
  return promise;
}

function WatchFacePreview({
  api,
  project
}: {
  api: CorosLinkApi;
  project: CorosWatchfaceProjectSummary;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewState, setPreviewState] = useState<ProjectPreviewState>("loading");

  useEffect(() => {
    let cancelled = false;
    const assetCache = new Map<string, CorosWatchfaceTemplateAsset>();

    void (async () => {
      setPreviewState("loading");
      const loadedProject = await loadProjectPreview(api, project);
      const details = await api.describeCorosWatchfaceTemplate(
        loadedProject.archive.archiveId
      );
      const previewDetails = deriveDesignDetails(
        details,
        loadedProject.design
      ).previewDetails;
      const resolution = pickPreviewResolution(previewDetails);
      const watchResolution = pickWatchPreviewResolution(previewDetails);
      if (!resolution || !watchResolution) {
        throw new Error("This project has no preview resolution.");
      }
      const backgroundDataUrl = await renderDesignBackground(
        loadedProject.design,
        resolution.width
      );
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const loadAssets = async (paths: string[]) => {
        const missing = paths.filter((path) => !assetCache.has(path));
        if (missing.length > 0) {
          const assets = await api.loadCorosWatchfaceTemplateAssets(
            loadedProject.archive.archiveId,
            missing
          );
          for (const asset of assets) assetCache.set(asset.path, asset);
        }
        return paths
          .map((path) => assetCache.get(path))
          .filter((asset): asset is CorosWatchfaceTemplateAsset => Boolean(asset));
      };
      canvas.width = 416;
      canvas.height = 416;
      await drawStudioPreview(
        canvas,
        backgroundDataUrl,
        detailsForPreviewResolution(
          previewDetails,
          watchResolution.directory
        ),
        toStudioOptions(loadedProject.design),
        loadAssets
      );
      const weather = loadedProject.design.weatherIndicator;
      if (weather?.enabled) {
        const url = weatherPreviewUrl(resolution.width);
        if (url) {
          const image = await loadStudioImage(url);
          const context = canvas.getContext("2d");
          const scale = canvas.width / resolution.width;
          context?.drawImage(
            image,
            weather.x * scale,
            weather.y * scale,
            image.naturalWidth * weather.scale * scale,
            image.naturalHeight * weather.scale * scale
          );
        }
      }
      if (!cancelled) setPreviewState("ready");
    })().catch(() => {
      if (!cancelled) setPreviewState("error");
    });

    return () => {
      cancelled = true;
    };
  }, [api, project.projectId, project.updatedAt]);

  return (
    <span
      className={`watchface-project-preview is-${previewState}`}
      aria-busy={previewState === "loading"}
    >
      <canvas
        ref={canvasRef}
        role={previewState === "ready" ? "img" : undefined}
        aria-hidden={previewState !== "ready"}
        aria-label={`${project.name} watch-face preview`}
      />
      {previewState !== "ready" ? (
        <span
          className="watchface-project-preview-fallback"
          role={previewState === "error" ? "status" : undefined}
        >
          {previewState === "loading" ? (
            <span aria-hidden="true" />
          ) : (
            <>
              <Watch size={29} aria-hidden="true" />
              <small>Preview unavailable</small>
            </>
          )}
        </span>
      ) : null}
    </span>
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

      {props.busy === "themes" && !props.themesLoaded ? (
        <div
          className="watchface-template-skeleton-grid"
          aria-label="Loading templates"
          aria-busy="true"
        >
          <div />
          <div />
          <div />
        </div>
      ) : props.themesLoaded ? (
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

function ImportWatchfaceDialog({
  shareUrl,
  busy,
  onShareUrlChange,
  onChooseArchive,
  onSubmit,
  onClose
}: {
  shareUrl: string;
  busy: boolean;
  onShareUrlChange: (value: string) => void;
  onChooseArchive: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <div className="watchface-modal-backdrop" role="presentation">
      <section
        className="watchface-modal watchface-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watchface-import-title"
        aria-describedby="watchface-import-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <button
          className="icon-button watchface-modal-close"
          type="button"
          aria-label="Close import dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
        <h2 id="watchface-import-title">Import watch face</h2>
        <p id="watchface-import-description">
          Open a local DIY archive or paste an official COROS watch-face share link.
        </p>

        <button
          className="secondary-button watchface-import-file"
          type="button"
          disabled={busy}
          onClick={onChooseArchive}
        >
          <Upload size={16} aria-hidden="true" />
          Choose ZIP or DAT archive
        </button>

        <div className="watchface-import-divider" aria-hidden="true">
          <span>or import from COROS</span>
        </div>

        <form className="watchface-import-link-form" onSubmit={onSubmit}>
          <label className="field">
            COROS share link
            <input
              type="url"
              value={shareUrl}
              placeholder="https://faq.coros.com/share/watchface?..."
              disabled={busy}
              onChange={(event) => onShareUrlChange(event.target.value)}
              autoFocus
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={busy || !shareUrl.trim()}
          >
            {busy ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            Import into Studio
          </button>
        </form>
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

function updatedAtValue(value: string): number {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 0 : date.valueOf();
}

function formatRelativeUpdatedAt(value: string, now = Date.now()): string {
  const timestamp = updatedAtValue(value);
  if (timestamp === 0) return "recently";
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(timestamp).getFullYear() === new Date(now).getFullYear()
      ? undefined
      : "numeric"
  });
}

function formatExactUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Update time unavailable"
    : `Updated ${date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      })}`;
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
