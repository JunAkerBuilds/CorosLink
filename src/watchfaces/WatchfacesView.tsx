import { WATCHFACE_TARGETS, getWatchfaceTarget } from "../../electron/watchfaceTargets";
import { drawNativeDataPreview } from "./nativeData";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  Circle,
  Clipboard,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Flame,
  History,
  KeyRound,
  Layers,
  LayoutGrid,
  Loader2,
  LogOut,
  MoreHorizontal,
  Mountain,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
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
  CommunityWatchface,
  CommunityWatchfaceDownloadProgress,
  CommunityWatchfaceGroup,
  CommunityWatchfaceOpenRequest,
  CommunityWatchfaceSort,
  CorosWatchfaceThemeCacheEntry,
  WatchModelId,
  WatchStatus
} from "../../electron/types";
import { WATCHFACE_AUTOMATION_SCENE_SCHEMA } from "../../electron/watchfaceAutomationTypes";
import type { CorosLinkApi } from "../coroslink-api";
import {
  getWatchPresentation,
  getWatchfaceDeviceProfile,
  getWatchfaceDeviceProfileByFirmware
} from "../watchModels";
import { BatteryHistoryPanel } from "./BatteryHistoryPanel";
import { DeviceInfoPanel } from "./DeviceInfoPanel";
import { WatchfaceEditor } from "./WatchfaceEditor";
import { renderDesignBackground } from "./watchfaceBackground";
import { deriveDesignDetails, toStudioOptions } from "./watchfaceCompose";
import { createWatchfaceEditorSessionId } from "./watchfaceEditorHistory";
import {
  firmwareTypeForWatchfaceArchive,
  isWatchfaceSignInRequired,
  prepareWatchfaceConversion
} from "./watchfaceConversion";
import {
  drawStudioPreview,
  detailsForPreviewResolution,
  loadStudioImage,
  pickPreviewResolution,
  pickWatchPreviewResolution
} from "./watchfaceStudio";
import { weatherPreviewDataUrl, drawWeatherTemperaturePreview } from "./weatherAssets";
import {
  clearWatchfaceAutomationEditor,
  getWatchfaceAutomationEditor,
  requireAutomationNumber,
  toWatchfaceAutomationError,
  WatchfaceAutomationError,
  type WatchfaceAutomationConversionInput,
  type WatchfaceAutomationOpenParams,
  type WatchfaceAutomationRequest
} from "./watchfaceAutomation";
import { getWatchfaceAutomationSchema } from "./watchfaceAutomationSchema";
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
import facesHeroDark from "../assets/watchfaces/hub/adventure-watch-dark-cut.webp";
import facesHeroLight from "../assets/watchfaces/hub/adventure-watch-light-cut.webp";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";
import { rememberWatchfaceFontSnapshots } from "./watchfaceFontSnapshots";
import { useCommunityWatchfaceCatalog } from "./useCommunityWatchfaceCatalog";
import {
  createTaskQueue,
  formatCachedAge,
  HubFilterSummary,
  HubHeadingUnderline,
  HubQuickFilters,
  HubResultsHeading,
  HubSearchField,
  HubSelectField,
  HubToolbar,
  useNearViewport,
  type HubChip
} from "./WatchfaceHubControls";
import "./watchfaces.css";
import "./watchfaceStudioAtelier.css";
import "./watchfaceHub.css";

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
  active: boolean;
  showDevelopmentTools: boolean;
  watchStatus: WatchStatus | null;
  communityOpenRequest:
    | (CommunityWatchfaceOpenRequest & { requestId: number })
    | null;
  onCommunityOpenRequestHandled: () => void;
}

type WatchfaceSurface = "sign-in" | "hub" | "studio";
type HubTab = "browse" | "projects" | "templates";

const WATCHFACE_HUB_TAB_PREFERENCE = defineSelectionPreference<HubTab>({
  key: "watchfaces.hubTab",
  defaultValue: "templates",
  validate: selectionIsOneOf(["browse", "projects", "templates"])
});

const WATCHFACE_CATALOG_PREFERENCE =
  defineSelectionPreference<CorosWatchfaceThemeCatalog>({
    key: "watchfaces.templateCatalog",
    defaultValue: "editable",
    validate: selectionIsOneOf(["editable", "official", "custom"])
  });

function isShortFilterValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120;
}

const COMMUNITY_MODEL_PREFERENCE = defineSelectionPreference<string>({
  key: "watchfaces.community.model",
  defaultValue: "",
  validate: isShortFilterValue
});

const COMMUNITY_STYLE_PREFERENCE = defineSelectionPreference<string>({
  key: "watchfaces.community.style",
  defaultValue: "",
  validate: isShortFilterValue
});

const COMMUNITY_SORT_PREFERENCE =
  defineSelectionPreference<CommunityWatchfaceSort>({
    key: "watchfaces.community.sort",
    defaultValue: "newest",
    validate: selectionIsOneOf(["newest", "title", "trending", "downloads"])
  });

type ProjectSortMode = "recent" | "name" | "oldest";

const PROJECT_SORT_PREFERENCE = defineSelectionPreference<ProjectSortMode>({
  key: "watchfaces.projects.sort",
  defaultValue: "recent",
  validate: selectionIsOneOf(["recent", "name", "oldest"])
});

type TemplateSortMode = "catalog" | "name" | "version";

const TEMPLATE_SORT_PREFERENCE = defineSelectionPreference<TemplateSortMode>({
  key: "watchfaces.templates.sort",
  defaultValue: "catalog",
  validate: selectionIsOneOf(["catalog", "name", "version"])
});

/** Catalog listings are served from cache and refreshed after this long. */
const THEME_CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
// Survives tab switches and catalog toggles for the life of the window.
const themeListMemory = new Map<string, CorosWatchfaceThemeCacheEntry>();

interface StudioSession {
  id: string;
  archive: CorosWatchfaceArchive;
  project?: CorosWatchfaceProject;
  initialDesign?: CorosWatchfaceDesignState;
  initialName: string;
  targetFirmwareType: string;
  targetWatchModel?: WatchModelId;
  initiallyDirty?: boolean;
}

interface WatchfaceConversionDraft {
  design: CorosWatchfaceDesignState;
  name: string;
  sourceDirty: boolean;
  sourceFirmwareType: string;
  bakeForWatch?: WatchfaceAutomationConversionInput["bakeForWatch"];
}

const DEFAULT_FIRMWARE_TYPE = "COROS W332";
const DEFAULT_MODEL_VERSION = "W332-3.1708.0";
const IS_DEVELOPMENT_BUILD = import.meta.env.DEV;
const COMMUNITY_MODEL_BY_WATCH: Partial<Record<WatchModelId, string>> = {
  "pace-4-pro": "PACE 4 Pro",
  "pace-pro": "PACE Pro",
  "pace-3": "PACE 3",
  "apex-2": "APEX 2",
  "apex-2-pro": "APEX 2 Pro",
  "vertix-2": "VERTIX 2",
  "vertix-2s": "VERTIX 2S"
};

const TEMPLATE_WATCH_OPTIONS = WATCHFACE_TARGETS;

function templateWatchModelForFirmware(firmwareType: string): WatchModelId | "" {
  const normalized = firmwareType.trim().toUpperCase();
  return (
    TEMPLATE_WATCH_OPTIONS.find(
      ({ model }) =>
        getWatchfaceDeviceProfile(model)?.firmwareType.toUpperCase() === normalized
    )?.model ?? ""
  );
}

const REGION_OPTIONS: { value: CorosWatchfaceRegion; label: string }[] = [
  { value: "eu", label: "Europe" },
  { value: "us", label: "United States" },
  { value: "cn", label: "China / Asia-Pacific" }
];

export function WatchfacesView({
  api,
  active,
  showDevelopmentTools,
  watchStatus,
  communityOpenRequest,
  onCommunityOpenRequestHandled
}: WatchfacesViewProps) {
  const [status, setStatus] = useState<CorosWatchfaceStatus | null>(null);
  const [surface, setSurface] = useState<WatchfaceSurface>("hub");
  const [hubTab, setHubTab] = useSelectionPreference(
    WATCHFACE_HUB_TAB_PREFERENCE
  );
  const [studioSession, setStudioSession] = useState<StudioSession | null>(null);
  const [conversionDraft, setConversionDraft] =
    useState<WatchfaceConversionDraft | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionSignInWatch, setConversionSignInWatch] = useState<WatchModelId | null>(null);
  const conversionBusyRef = useRef(false);
  const [communityProgress, setCommunityProgress] =
    useState<CommunityWatchfaceDownloadProgress | null>(null);
  const [communityConfirmFace, setCommunityConfirmFace] =
    useState<CommunityWatchface | null>(null);
  const [queuedCommunityRequest, setQueuedCommunityRequest] = useState<
    (CommunityWatchfaceOpenRequest & { requestId: number }) | null
  >(null);
  const handledCommunityRequestRef = useRef(0);
  const automationRequestHandlerRef = useRef<
    (request: WatchfaceAutomationRequest) => Promise<unknown>
  >(async () => {
    throw new Error("The watch-face hub is still loading.");
  });

  useEffect(() => {
    const unsubscribe = api.onWatchfaceAutomationRequest((request) => {
      void automationRequestHandlerRef.current(request).then(
        (result) => api.respondWatchfaceAutomation({ id: request.id, result }),
        (caught) =>
          api.respondWatchfaceAutomation({
            id: request.id,
            error: toWatchfaceAutomationError(caught)
          })
      );
    });
    api.setWatchfaceAutomationReady("hub", true);
    return () => {
      api.setWatchfaceAutomationReady("editor", false);
      api.setWatchfaceAutomationReady("hub", false);
      unsubscribe();
    };
  }, [api]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberCredentials, setRememberCredentials] = useState(true);
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
  const [themeCatalog, setThemeCatalog] = useSelectionPreference(
    WATCHFACE_CATALOG_PREFERENCE
  );
  const [watchSerial, setWatchSerial] = useState("x");
  const [modelVersion, setModelVersion] = useState(DEFAULT_MODEL_VERSION);
  const [themes, setThemes] = useState<CorosWatchfaceTheme[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  const [themesSavedAt, setThemesSavedAt] = useState<string | null>(null);
  const [themesRefreshing, setThemesRefreshing] = useState(false);
  const [themeSearch, setThemeSearch] = useState("");
  const [downloadingThemeUrl, setDownloadingThemeUrl] = useState<string | null>(
    null
  );
  const [openingThemeUrl, setOpeningThemeUrl] = useState<string | null>(null);
  const [sharingThemeId, setSharingThemeId] = useState<string | null>(null);

  const [builtArchive, setBuiltArchive] =
    useState<CorosWatchfaceArchive | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importShareUrl, setImportShareUrl] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [shareLink, setShareLink] = useState<CorosWatchfaceShareLink | null>(null);

  const [busy, setBusy] = useState<
    "login" | "themes" | "archive" | "publish" | "project" | "community" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const showStudioError = useCallback((message: string) => {
    setNotice(null);
    setError(message);
  }, []);
  const showStudioNotice = useCallback((message: string) => {
    setError(null);
    setNotice(message);
  }, []);

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
          return current;
        });
        if (!regionTouched) {
          setRegion(nextStatus.region ?? nextStatus.suggestedRegion);
        }
        if (nextStatus.savedEmail) {
          setEmail((current) => current || nextStatus.savedEmail || "");
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setStatus({
            authenticated: false,
            secureStorageAvailable: false,
            savedCredentialsAvailable: false,
            suggestedRegion: "us"
          });
          setError(toErrorMessage(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, regionTouched]);

  useEffect(
    () =>
      api.onCommunityWatchfaceDownloadProgress((progress) => {
        setCommunityProgress(progress);
      }),
    [api]
  );

  useEffect(() => {
    if (
      !communityOpenRequest ||
      handledCommunityRequestRef.current === communityOpenRequest.requestId
    ) {
      return;
    }
    handledCommunityRequestRef.current = communityOpenRequest.requestId;
    onCommunityOpenRequestHandled();
    setHubTab("browse");
    if (surface === "studio") {
      setQueuedCommunityRequest(communityOpenRequest);
      return;
    }
    setSurface("hub");
    void prepareCommunityImport(communityOpenRequest.slug, false, communityOpenRequest.model);
  }, [
    communityOpenRequest,
    onCommunityOpenRequestHandled,
    surface
  ]);

  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    void api
      .listCorosWatchfaceProjects({ includePreviews: false })
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
  const templateWatchModel = useMemo(
    () => templateWatchModelForFirmware(firmwareType),
    [firmwareType]
  );

  async function handleLogin(
    event: FormEvent<HTMLFormElement>,
    destination: "hub" | "publish" | "conversion" = "hub"
  ) {
    event.preventDefault();
    setBusy("login");
    clearMessages();
    try {
      const nextStatus = await api.loginCorosWatchfaces(
        email,
        password,
        region,
        rememberCredentials
      );
      setStatus(nextStatus);
      setPassword("");
      if (destination === "hub") setSurface("hub");
      setNotice("COROS mobile session connected.");
      if (destination === "conversion") await resumeConversionAfterLogin();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  async function handleSavedLogin(destination: "hub" | "publish" | "conversion" = "hub") {
    setBusy("login");
    clearMessages();
    try {
      const nextStatus =
        await api.loginCorosWatchfacesWithSavedCredentials(region);
      setStatus(nextStatus);
      setEmail(nextStatus.savedEmail ?? email);
      setPassword("");
      if (destination === "hub") setSurface("hub");
      setNotice("COROS mobile session connected with your saved account.");
      if (destination === "conversion") await resumeConversionAfterLogin();
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
      setThemesSavedAt(null);
      themeListMemory.clear();
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
    project?: CorosWatchfaceProject,
    transferredDesign?: CorosWatchfaceDesignState,
    initiallyDirty = false,
    automationTarget?: { firmwareType?: string; watchModel?: WatchModelId }
  ) {
    const targetFirmwareType = automationTarget?.firmwareType?.trim() ||
      firmwareTypeForWatchfaceArchive(
        archive,
        project?.firmwareType?.trim() || firmwareType
      );
    const firmwareWatchModel = templateWatchModelForFirmware(targetFirmwareType);
    const connectedProfile = watchStatus?.connected
      ? getWatchfaceDeviceProfile(watchStatus.model)
      : undefined;
    const targetWatchModel = automationTarget?.watchModel || firmwareWatchModel ||
      (connectedProfile?.firmwareType.toUpperCase() === targetFirmwareType.toUpperCase()
        ? watchStatus?.model
        : undefined);
    applyDetectedFirmwareType(targetFirmwareType);
    setStudioSession({
      id: createWatchfaceEditorSessionId(project?.projectId ?? archive.archiveId),
      archive,
      project,
      ...(transferredDesign || project?.design || archive.editableProject?.design
        ? {
            initialDesign:
              transferredDesign ?? project?.design ?? archive.editableProject?.design
          }
        : {}),
      initialName:
        (transferredDesign
          ? initialName
          : project?.name ?? archive.editableProject?.name ?? initialName
        ).trim() || "Untitled watch face",
      targetFirmwareType,
      ...(targetWatchModel ? { targetWatchModel } : {}),
      ...(initiallyDirty ? { initiallyDirty: true } : {})
    });
    setBuiltArchive(null);
    setImportOpen(false);
    setImportShareUrl("");
    setShareLink(null);
    setPublishOpen(false);
    setConversionDraft(null);
    setConversionSignInWatch(null);
    setSurface("studio");
    clearMessages();
  }

  function beginWatchConversion(
    design: CorosWatchfaceDesignState,
    name: string,
    sourceDirty: boolean,
    bakeForWatch?: WatchfaceAutomationConversionInput["bakeForWatch"]
  ) {
    if (!studioSession) return;
    setConversionSignInWatch(null);
    setConversionDraft({
      design: structuredClone(design),
      name: name.trim() || "Custom watch face",
      sourceDirty,
      sourceFirmwareType: studioSession.targetFirmwareType,
      ...(bakeForWatch ? { bakeForWatch } : {})
    });
    clearMessages();
  }

  function convertedProjectName(
    sourceName: string,
    targetFirmwareType: string
  ): string {
    const targetModel = templateWatchModelForFirmware(targetFirmwareType);
    const targetLabel = TEMPLATE_WATCH_OPTIONS.find(
      ({ model }) => model === targetModel
    )?.label;
    if (!targetLabel) return sourceName.slice(0, 80);
    let baseName = sourceName;
    let previousTarget;
    while ((previousTarget = TEMPLATE_WATCH_OPTIONS.find(option => baseName.endsWith(` (${option.label})`)))) {
      baseName = baseName.slice(0, -(` (${previousTarget.label})`.length));
    }
    const suffix = ` (${targetLabel})`;
    return `${(baseName || sourceName).slice(0, Math.max(1, 80 - suffix.length)).trimEnd()}${suffix}`;
  }

  async function openAutomatedConversion({
    design, name, targetArchive, firmwareType: requestedFirmwareType, watchModel, bakeForWatch
  }: WatchfaceAutomationConversionInput) {
    if (!studioSession || conversionBusyRef.current) throw new Error("A conversion is already in progress.");
    const target = getWatchfaceTarget(watchModel ?? requestedFirmwareType ?? targetArchive?.firmwareType);
    if (!target) throw new Error("Choose a supported destination watch.");
    if (requestedFirmwareType && target.firmwareType.toUpperCase() !== requestedFirmwareType.trim().toUpperCase()) {
      throw new Error("The destination watch and firmware do not match.");
    }
    if (target.firmwareType.toUpperCase() === studioSession.targetFirmwareType.toUpperCase()) {
      throw new Error("Choose a different destination watch.");
    }
    conversionBusyRef.current = true;
    setConversionBusy(true);
    try {
      if (bakeForWatch) {
        // Recovered official faces are rebuilt from their native tree for the
        // destination; the finished archive becomes the new project's starter.
        if (targetArchive) throw new Error("Recovered official faces convert with the destination watch's own COROS template.");
        const baked = await bakeForWatch({ firmwareType: target.firmwareType, watchModel: target.model }, name);
        const bakedName = convertedProjectName(name, target.firmwareType);
        clearWatchfaceAutomationEditor();
        api.setWatchfaceAutomationReady("editor", false);
        openStudio(baked, bakedName, undefined, undefined, true,
          { firmwareType: target.firmwareType, watchModel: target.model });
        setNotice(`Converted to ${target.label}. Your edits are baked into this new starter; keep editing and save it as a project.`);
        return { opened: true, name: bakedName, targetFirmwareType: target.firmwareType,
          omittedRawConfigEditCount: 0, appliedRawConfigEditCount: 0 };
      }
      const converted = await api.convertCorosWatchfaceArchive({
        sourceArchiveId: studioSession.archive.archiveId,
        watchModel: target.model,
        ...(targetArchive ? { targetArchiveId: targetArchive.archiveId } : {}),
        configTextEdits: design.configTextEdits
      });
      const prepared = prepareWatchfaceConversion(design, { rawEditsApplied: true, generatedAod: converted.generatedAod });
      const convertedName = convertedProjectName(name, target.firmwareType);
      clearWatchfaceAutomationEditor();
      api.setWatchfaceAutomationReady("editor", false);
      openStudio(converted.archive, convertedName, undefined, prepared.design, true,
        { firmwareType: target.firmwareType, watchModel: target.model });
      setNotice(`Converted to ${target.label}. ${target.display === "mip"
        ? "Current stays visible on MIP; your separate AOD design is retained for AMOLED."
        : converted.generatedAod ? "An editable Always-on layout was created from Current. Review it before sending."
        : "Current and Always-on layouts are preserved."}`);
      return { opened: true, name: convertedName, targetFirmwareType: target.firmwareType,
        omittedRawConfigEditCount: 0, appliedRawConfigEditCount: converted.appliedRawConfigEditCount };
    } finally {
      conversionBusyRef.current = false;
      setConversionBusy(false);
    }
  }

  async function convertToWatch(watchModel: WatchModelId) {
    if (!conversionDraft) return;
    clearMessages();
    try {
      await openAutomatedConversion({ design: conversionDraft.design, name: conversionDraft.name,
        sourceDirty: conversionDraft.sourceDirty, watchModel,
        ...(conversionDraft.bakeForWatch ? { bakeForWatch: conversionDraft.bakeForWatch } : {}) });
    } catch (caught) {
      if (isWatchfaceSignInRequired(caught)) {
        setConversionSignInWatch(watchModel);
        setPassword("");
        void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
        return;
      }
      setError(toErrorMessage(caught));
    }
  }

  async function resumeConversionAfterLogin() {
    if (!conversionSignInWatch) return;
    const watchModel = conversionSignInWatch;
    setConversionSignInWatch(null);
    await convertToWatch(watchModel);
  }

  function returnToHub() {
    setSurface("hub");
    setStudioSession(null);
    setPublishOpen(false);
    setShareLink(null);
    clearMessages();
    if (queuedCommunityRequest) {
      const { slug, model } = queuedCommunityRequest;
      setQueuedCommunityRequest(null);
      setHubTab("browse");
      queueMicrotask(() => void prepareCommunityImport(slug, false, model));
    }
  }

  async function prepareCommunityImport(
    slug: string,
    compatibilityConfirmed = false,
    model?: string
  ) {
    setBusy("community");
    setCommunityProgress(null);
    clearMessages();
    try {
      const face = await api.getCommunityWatchface(slug, model);
      const connectedModel = watchStatus?.model
        ? COMMUNITY_MODEL_BY_WATCH[watchStatus.model]
        : undefined;
      if (
        connectedModel &&
        !compatibilityConfirmed &&
        !face.models.some(
          (model) => model.toUpperCase() === connectedModel.toUpperCase()
        )
      ) {
        setCommunityConfirmFace(face);
        return;
      }
      const imported = await api.importCommunityWatchface(face.slug, model);
      setCommunityConfirmFace(null);
      openStudio(imported.archive, imported.face.title);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
      setCommunityProgress(null);
    }
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

  async function handleDuplicateProject(projectId: string) {
    setBusy("project");
    clearMessages();
    try {
      const duplicated = await api.duplicateCorosWatchfaceProject(projectId);
      handleProjectSaved(duplicated);
      setNotice(`Duplicated as “${duplicated.name}”.`);
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
      ...(saved.firmwareType ? { firmwareType: saved.firmwareType } : {}),
      ...(saved.previewDataUrl ? { previewDataUrl: saved.previewDataUrl } : {})
    };
    setProjects((current) => [
      summary,
      ...current.filter((project) => project.projectId !== summary.projectId)
    ]);
  }

  const themeQuery = useMemo(
    () => ({
      firmwareType,
      language,
      maxWatchFaceVersion: Number(maxWatchFaceVersion),
      catalog: themeCatalog,
      ...(themeCatalog !== "editable"
        ? { snCode: watchSerial.trim() || "x", modelVersion }
        : {})
    }),
    [firmwareType, language, maxWatchFaceVersion, modelVersion, themeCatalog, watchSerial]
  );
  const themeQueryKey = JSON.stringify(themeQuery);
  const themeQueryKeyRef = useRef(themeQueryKey);
  themeQueryKeyRef.current = themeQueryKey;
  const themeRequestsRef = useRef(new Set<string>());

  function showThemeList(key: string, entry: CorosWatchfaceThemeCacheEntry) {
    if (themeQueryKeyRef.current !== key) return;
    setThemes(entry.themes);
    setThemesLoaded(true);
    setThemesSavedAt(entry.savedAt);
  }

  /**
   * Stale-while-revalidate: memory, then the on-disk copy of the last listing,
   * then COROS only when the copy is old or the user asks for a refresh.
   */
  async function handleLoadThemes(
    event?: FormEvent<HTMLFormElement>,
    options: { force?: boolean } = {}
  ) {
    event?.preventDefault();
    if (!connected) {
      setError("Sign in to your COROS account before creating a watch face.");
      setNotice(null);
      setSurface("sign-in");
      return;
    }
    const key = themeQueryKey;
    const query = themeQuery;
    let shown = themeListMemory.get(key) ?? null;
    if (!shown) {
      shown = await api.readCachedCorosWatchfaceThemes(query).catch(() => null);
      if (shown) themeListMemory.set(key, shown);
    }
    if (shown) showThemeList(key, shown);
    const fresh =
      shown !== null && Date.now() - Date.parse(shown.savedAt) < THEME_CACHE_FRESH_MS;
    if ((fresh && !options.force) || themeRequestsRef.current.has(key)) return;

    themeRequestsRef.current.add(key);
    if (shown) {
      setThemesRefreshing(true);
    } else {
      setBusy("themes");
      clearMessages();
    }
    try {
      const nextThemes = await api.listCorosWatchfaceThemes(query);
      const entry = { savedAt: new Date().toISOString(), themes: nextThemes };
      themeListMemory.set(key, entry);
      showThemeList(key, entry);
      if (options.force) {
        setNotice(
          `${nextThemes.length} ${watchfaceCatalogLabel(query.catalog)}${
            nextThemes.length === 1 ? "" : "s"
          } refreshed.`
        );
      }
    } catch (caught) {
      // A cached list is still usable; only surface the failure when asked.
      if (!shown || options.force) setError(toErrorMessage(caught));
    } finally {
      themeRequestsRef.current.delete(key);
      if (shown) setThemesRefreshing(false);
      else setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  useEffect(() => {
    // Never show one catalog's list under another query's filters.
    const remembered = themeListMemory.get(themeQueryKey);
    setThemes(remembered?.themes ?? []);
    setThemesLoaded(Boolean(remembered));
    setThemesSavedAt(remembered?.savedAt ?? null);
  }, [themeQueryKey]);

  useEffect(() => {
    if (
      status === null ||
      !connected ||
      surface !== "hub" ||
      hubTab !== "templates" ||
      busy !== null
    ) {
      return;
    }
    // Advanced fields are typed, so let them settle before querying.
    const timeout = window.setTimeout(() => void handleLoadThemes(), 250);
    return () => window.clearTimeout(timeout);
  }, [busy, connected, hubTab, status, surface, themeQueryKey]);

  async function handleDownloadTheme(theme: CorosWatchfaceTheme) {
    if (!theme.packageUrl || openingThemeUrl || downloadingThemeUrl) return;
    setDownloadingThemeUrl(theme.packageUrl);
    clearMessages();
    try {
      const download = await api.downloadCorosWatchfaceTheme({
        packageUrl: theme.packageUrl,
        name: theme.name,
        firmwareType: theme.firmwareType?.trim() || firmwareType
      });
      if (themeCatalog !== "official" && download.usableAsTemplate && download.archive) {
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

  async function handleOpenOfficialTheme(theme: CorosWatchfaceTheme) {
    if (!theme.packageUrl || openingThemeUrl || downloadingThemeUrl) return;
    setOpeningThemeUrl(theme.packageUrl);
    clearMessages();
    try {
      const result = await api.downloadCorosWatchfaceTheme({
        packageUrl: theme.packageUrl,
        name: theme.name,
        firmwareType: theme.firmwareType?.trim() || firmwareType,
        templateId: theme.id,
        openInEditor: true
      });
      if (!result.usableAsTemplate || !result.archive) throw new Error(result.message);
      openStudio(result.archive, theme.name);
      setNotice(result.message);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setOpeningThemeUrl(null);
    }
  }

  async function handleShareTheme(theme: CorosWatchfaceTheme) {
    if (!connected) {
      setError("Connect your COROS account before creating a share link.");
      setNotice(null);
      return;
    }

    const templateId = theme.id?.trim();
    const sourceTemplateId = theme.sourceTemplateId?.trim();
    if (!templateId || !sourceTemplateId) {
      setError(
        "COROS did not return the source template ID for this face. Refresh My watch faces and try again."
      );
      setNotice(null);
      return;
    }

    const themeFirmwareType = theme.firmwareType?.trim() || firmwareType;
    const themeBackgroundImageId =
      theme.backgroundImageId ?? Number(backgroundImageId);
    setSharingThemeId(templateId);
    setBusy("publish");
    clearMessages();
    try {
      const nextLink = await api.createCorosWatchfaceShareLink({
        templateId,
        sourceTemplateId,
        name: theme.name,
        firmwareType: themeFirmwareType,
        backgroundImageId: themeBackgroundImageId
      });
      setBuiltArchive(null);
      setPublishName(theme.name);
      setShareLink(nextLink);
      setPublishOpen(true);
      setNotice("Your COROS share link is ready.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setSharingThemeId(null);
      setBusy(null);
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    }
  }

  /**
   * `sendNow` comes from the Studio Send panel, where the name was already
   * confirmed: upload straight away and let the dialog show the share link
   * (or sign-in first, when the account is not connected).
   */
  function openPublish(archive: CorosWatchfaceArchive, currentName: string, options?: { sendNow?: boolean }) {
    const name = currentName.trim() || studioSession?.initialName || "Untitled watch face";
    setBuiltArchive(archive);
    if (archive.firmwareType) {
      setFirmwareType(archive.firmwareType);
    }
    setPublishName(name);
    setShareLink(null);
    setPublishOpen(true);
    clearMessages();
    if (options?.sendNow && connected) {
      void publishArchive(archive, name, archive.firmwareType || firmwareType);
    }
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!builtArchive) return;
    await publishArchive(builtArchive, publishName, firmwareType);
  }

  async function publishArchive(archive: CorosWatchfaceArchive, name: string, archiveFirmwareType: string) {
    if (!connected) {
      setError("Connect your COROS account before sending this watch face.");
      setNotice(null);
      return;
    }
    if (!name.trim()) {
      setError("Enter a watch-face name before sending.");
      setNotice(null);
      return;
    }
    setBusy("publish");
    clearMessages();
    try {
      const nextLink = await api.publishCorosWatchface({
        archiveId: archive.archiveId,
        name: name.trim(),
        firmwareType: archiveFirmwareType,
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

  automationRequestHandlerRef.current = async ({ method, params }) => {
    if (method === "get_schema") {
      return {
        ...WATCHFACE_AUTOMATION_SCENE_SCHEMA,
        ...getWatchfaceAutomationSchema()
      };
    }
    if (method === "get_context") {
      const controller = getWatchfaceAutomationEditor();
      if (controller) return controller.request("get_document", params);
      return {
        surface,
        editorOpen: false,
        conversionPending: Boolean(conversionDraft)
      };
    }
    if (method === "open") {
      const input = params as WatchfaceAutomationOpenParams;
      const controller = getWatchfaceAutomationEditor();
      if (controller?.status().busy) {
        throw new WatchfaceAutomationError(
          "EDITOR_BUSY",
          "Finish the active editor gesture or import before opening another watch face."
        );
      }
      if (controller?.status().dirty) {
        if (input.saveChanges) {
          const current = controller.status();
          const saved = await controller.request("save", {
            sessionId: current.sessionId,
            baseRevision: current.revision
          });
          if (
            saved &&
            typeof saved === "object" &&
            (saved as { dirty?: unknown }).dirty === true
          ) {
            throw new WatchfaceAutomationError(
              "DIRTY_DOCUMENT",
              "New edits were made while saving. Read the document and retry."
            );
          }
        } else if (!input.discardChanges) {
          throw new WatchfaceAutomationError(
            "DIRTY_DOCUMENT",
            "The open watch face has unsaved changes. Pass saveChanges or discardChanges explicitly."
          );
        }
      }
      const project = input.project;
      const archive = input.archive ?? project?.archive;
      if (!archive?.archiveId) {
        throw new WatchfaceAutomationError(
          "INVALID_PARAMS",
          "open requires an archive or a project containing its source archive."
        );
      }
      clearWatchfaceAutomationEditor();
      api.setWatchfaceAutomationReady("editor", false);
      openStudio(
        archive,
        input.name ?? project?.name ?? archive.fileName.replace(/\.(zip|dat)$/i, ""),
        project,
        project?.design,
        false,
        {
          ...(input.firmwareType ? { firmwareType: input.firmwareType } : {}),
          ...(input.watchModel ? { watchModel: input.watchModel } : {})
        }
      );
      return {
        opening: true,
        archiveId: archive.archiveId,
        name: input.name ?? project?.name ?? archive.fileName
      };
    }
    if (method === "close") {
      const controller = getWatchfaceAutomationEditor();
      if (!controller) return { closed: false, reason: "no_open_editor" };
      const current = controller.status();
      if (current.busy) {
        throw new WatchfaceAutomationError(
          "EDITOR_BUSY",
          "Finish the active editor gesture or import before closing the watch face."
        );
      }
      if (params.sessionId !== current.sessionId) {
        throw new WatchfaceAutomationError(
          "STALE_SESSION",
          `The editor session changed. Current sessionId is ${current.sessionId}.`
        );
      }
      const baseRevision = requireAutomationNumber(
        params.baseRevision,
        "baseRevision"
      );
      if (baseRevision !== current.revision) {
        throw new WatchfaceAutomationError(
          "REVISION_CONFLICT",
          `Document revision ${baseRevision} is stale; current revision is ${current.revision}.`,
          { sessionId: current.sessionId, revision: current.revision }
        );
      }
      if (current.dirty) {
        if (params.saveChanges === true) {
          const saved = await controller.request("save", {
            sessionId: current.sessionId,
            baseRevision: current.revision
          });
          if (
            saved &&
            typeof saved === "object" &&
            (saved as { dirty?: unknown }).dirty === true
          ) {
            throw new WatchfaceAutomationError(
              "DIRTY_DOCUMENT",
              "New edits were made while saving. Read the document and retry."
            );
          }
        } else if (params.discardChanges !== true) {
          throw new WatchfaceAutomationError(
            "DIRTY_DOCUMENT",
            "The open watch face has unsaved changes. Pass saveChanges or discardChanges explicitly."
          );
        }
      }
      clearWatchfaceAutomationEditor();
      api.setWatchfaceAutomationReady("editor", false);
      returnToHub();
      return { closed: true, sessionId: current.sessionId };
    }
    const controller = getWatchfaceAutomationEditor();
    if (!controller) {
      throw new WatchfaceAutomationError(
        "EDITOR_NOT_READY",
        "Open a watch face before using editor automation methods."
      );
    }
    return controller.request(method, params);
  };

  if (surface === "studio" && studioSession) {
    return (
      <div
        className={`watchfaces-view wf-watchfaces watchface-shell watchface-shell--studio${
          active ? "" : " view-panel-hidden"
        }`}
        aria-hidden={!active}
      >
        <WatchfaceEditor
          key={studioSession.id}
          api={api}
          active={active && !conversionDraft && !conversionBusy}
          conversionBusy={conversionBusy || Boolean(conversionDraft)}
          sessionId={studioSession.id}
          starterArchive={studioSession.archive}
          targetFirmwareType={studioSession.targetFirmwareType}
          targetWatchModel={studioSession.targetWatchModel}
          initialDesign={studioSession.initialDesign}
          initialProjectId={studioSession.project?.projectId}
          initialProjectName={studioSession.project?.name ?? studioSession.initialName}
          initiallyDirty={studioSession.initiallyDirty}
          showDevelopmentTools={IS_DEVELOPMENT_BUILD && showDevelopmentTools}
          onBack={returnToHub}
          backRequestId={queuedCommunityRequest?.requestId}
          onBackCancelled={() => setQueuedCommunityRequest(null)}
          onArchiveCreated={setBuiltArchive}
          onPublish={openPublish}
          onProjectSaved={handleProjectSaved}
          onConvertTarget={beginWatchConversion}
          onAutomationConvert={openAutomatedConversion}
          onError={showStudioError}
          onNotice={showStudioNotice}
          onClearMessages={clearMessages}
        />
        {conversionDraft ? (
          <WatchfaceConversionDialog name={conversionDraft.name} sourceFirmwareType={conversionDraft.sourceFirmwareType}
            bakes={Boolean(conversionDraft.bakeForWatch)}
            busy={conversionBusy || busy === "login"} error={error}
            signIn={conversionSignInWatch ? {
              email, password, region, rememberCredentials,
              secureStorageAvailable: status?.secureStorageAvailable ?? false,
              savedCredentialsAvailable: status?.savedCredentialsAvailable ?? false,
              savedEmail: status?.savedEmail,
              loginBusy: busy === "login",
              onEmailChange: setEmail,
              onPasswordChange: setPassword,
              onRememberCredentialsChange: setRememberCredentials,
              onRegionChange: (nextRegion) => { setRegion(nextRegion); setRegionTouched(true); },
              onLogin: (event) => void handleLogin(event, "conversion"),
              onSavedLogin: () => void handleSavedLogin("conversion")
            } : undefined}
            onCancel={() => {
              if (conversionSignInWatch) { setConversionSignInWatch(null); setPassword(""); }
              else setConversionDraft(null);
              clearMessages();
            }}
            onConvert={watchModel => void convertToWatch(watchModel)} />
        ) : null}
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
            savedCredentialsAvailable={
              status?.savedCredentialsAvailable ?? false
            }
            savedEmail={status?.savedEmail}
            rememberCredentials={rememberCredentials}
            busy={busy === "publish" || busy === "login"}
            loginBusy={busy === "login"}
            onNameChange={setPublishName}
            onFirmwareTypeChange={setFirmwareType}
            onBackgroundImageIdChange={setBackgroundImageId}
            onLanguageChange={setLanguage}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onRememberCredentialsChange={setRememberCredentials}
            onRegionChange={(nextRegion) => {
              setRegion(nextRegion);
              setRegionTouched(true);
            }}
            onLogin={(event) => void handleLogin(event, "publish")}
            onSavedLogin={() => void handleSavedLogin("publish")}
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
      className={`watchfaces-view wf-watchfaces watchface-shell watchface-shell--hub${
        surface === "sign-in" ? " watchface-shell--signin" : ""
      }${active ? "" : " view-panel-hidden"}`}
      aria-hidden={!active}
    >
      {surface !== "sign-in" ? (
        <WatchFacesHeader
          accountConnected={connected}
          accountEmail={email.trim() || status?.savedEmail || null}
          connectedWatchName={connectedWatchName}
          watchStatus={watchStatus}
          statusLoading={status === null}
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
              Sign in to choose a template and create a watch face.
            </p>
            <form
              className="watchface-auth-form"
              onSubmit={(event) => void handleLogin(event)}
            >
              {status.savedCredentialsAvailable && status.savedEmail ? (
                <>
                  <div className="watchface-saved-login">
                    <div>
                      <span>Saved COROS account</span>
                      <strong>{status.savedEmail}</strong>
                      <small>
                        Creates a separate Watch Face Studio session without
                        asking for your password again.
                      </small>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void handleSavedLogin()}
                    >
                      {busy === "login" ? (
                        <Loader2 className="spin" size={16} aria-hidden="true" />
                      ) : (
                        <KeyRound size={16} aria-hidden="true" />
                      )}
                      Use saved account
                    </button>
                  </div>
                  <div className="watchface-auth-divider">
                    <span>or use another account</span>
                  </div>
                </>
              ) : null}
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
              {status.secureStorageAvailable ? (
                <label className="watchface-auth-remember">
                  <input
                    type="checkbox"
                    checked={rememberCredentials}
                    onChange={(event) =>
                      setRememberCredentials(event.target.checked)
                    }
                    disabled={busy !== null}
                  />
                  <span>
                    Save this COROS account
                    <small>
                      Stores an encrypted password digest so Training Hub and
                      Watch Face Studio can each create their own session.
                    </small>
                  </span>
                </label>
              ) : null}
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
                Browse without signing in
              </button>
            </form>
            <p className="watchface-auth-local-note">
              You can browse community faces and manage saved projects without signing in.
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
            <DeviceInfoPanel api={api} />
          ) : null}

          <WatchFacesTabs
            activeTab={hubTab}
            projectCount={projects.length}
            onChange={setHubTab}
          />

          {hubTab === "browse" ? (
            <CommunityWatchfaceBrowser
              api={api}
              connectedModel={
                watchStatus?.model
                  ? COMMUNITY_MODEL_BY_WATCH[watchStatus.model]
                  : undefined
              }
              disabled={busy !== null}
              progress={communityProgress}
              onOpen={(face, model) => void prepareCommunityImport(face.slug, false, model)}
            />
          ) : hubTab === "projects" ? (
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
              onDuplicate={(project) =>
                void handleDuplicateProject(project.projectId)
              }
              onDelete={setDeleteTarget}
              onCreate={() => setHubTab("templates")}
              onImport={() => setImportOpen(true)}
            />
          ) : (
            <TemplatesPanel
              accountConnected={connected}
              busy={busy}
              catalog={themeCatalog}
              watchModel={templateWatchModel}
              firmwareType={firmwareType}
              language={language}
              maxWatchFaceVersion={maxWatchFaceVersion}
              watchSerial={watchSerial}
              modelVersion={modelVersion}
              search={themeSearch}
              themes={themes}
              visibleThemes={visibleThemes}
              themesLoaded={themesLoaded}
              savedAt={themesSavedAt}
              refreshing={themesRefreshing}
              downloadingThemeUrl={downloadingThemeUrl}
              openingThemeUrl={openingThemeUrl}
              sharingThemeId={sharingThemeId}
              onSignIn={() => setSurface("sign-in")}
              onCatalogChange={setThemeCatalog}
              onWatchModelChange={(nextWatchModel) => {
                const profile = getWatchfaceDeviceProfile(nextWatchModel);
                if (profile) applyDetectedFirmwareType(profile.firmwareType);
              }}
              onFirmwareTypeChange={applyDetectedFirmwareType}
              onLanguageChange={setLanguage}
              onMaxVersionChange={setMaxWatchFaceVersion}
              onWatchSerialChange={setWatchSerial}
              onModelVersionChange={setModelVersion}
              onSearchChange={setThemeSearch}
              onSubmit={(event) => void handleLoadThemes(event, { force: true })}
              onRefresh={() => void handleLoadThemes(undefined, { force: true })}
              onUseTheme={(theme) => void handleDownloadTheme(theme)}
              onOpenOfficialTheme={(theme) => void handleOpenOfficialTheme(theme)}
              onShareTheme={(theme) => void handleShareTheme(theme)}
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
      {communityConfirmFace ? (
        <CommunityCompatibilityDialog
          face={communityConfirmFace}
          connectedModel={
            watchStatus?.model
              ? COMMUNITY_MODEL_BY_WATCH[watchStatus.model]
              : undefined
          }
          busy={busy === "community"}
          onCancel={() => setCommunityConfirmFace(null)}
          onConfirm={() =>
            void prepareCommunityImport(communityConfirmFace.slug, true, new URL(communityConfirmFace.downloadUrl).searchParams.get("model") ?? undefined)
          }
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
          savedCredentialsAvailable={
            status?.savedCredentialsAvailable ?? false
          }
          savedEmail={status?.savedEmail}
          rememberCredentials={rememberCredentials}
          busy={busy === "publish" || busy === "login"}
          loginBusy={busy === "login"}
          onNameChange={setPublishName}
          onFirmwareTypeChange={setFirmwareType}
          onBackgroundImageIdChange={setBackgroundImageId}
          onLanguageChange={setLanguage}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onRememberCredentialsChange={setRememberCredentials}
          onRegionChange={(nextRegion) => {
            setRegion(nextRegion);
            setRegionTouched(true);
          }}
          onLogin={(event) => void handleLogin(event, "publish")}
          onSavedLogin={() => void handleSavedLogin("publish")}
          onSubmit={handlePublish}
          onCopy={() => void handleCopy()}
          onClose={() => setPublishOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface WatchFacesHeaderProps {
  accountConnected: boolean;
  accountEmail: string | null;
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
  accountEmail,
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
          <h1>Watch Face Studio</h1>
          <p>Build a face that feels at home on your COROS watch.</p>
        </div>
      </div>
      <div className="watchface-hub-actions">
        <AccountStatusMenu
          accountConnected={accountConnected}
          accountEmail={accountEmail}
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

interface AccountStatusMenuProps {
  accountConnected: boolean;
  accountEmail: string | null;
  connectedWatchName: string | null;
  watchStatus: WatchStatus | null;
  statusLoading: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function AccountStatusMenu({
  accountConnected,
  accountEmail,
  connectedWatchName,
  watchStatus,
  statusLoading,
  busy,
  onConnect,
  onDisconnect
}: AccountStatusMenuProps) {
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
    ? "Checking account"
    : accountConnected
      ? accountEmail ?? "COROS account"
      : "Sign in to COROS";

  return (
    <div className="watchface-device-menu" ref={containerRef}>
      <button
        className={`watchface-device-trigger${
          accountConnected ? " is-connected" : " is-sign-in"
        }`}
        type="button"
        aria-label={accountConnected ? `${label}. Open account details` : label}
        aria-haspopup={accountConnected ? "dialog" : undefined}
        aria-expanded={accountConnected ? open : undefined}
        disabled={statusLoading}
        onClick={() => {
          if (!accountConnected) {
            onConnect();
            return;
          }
          setOpen((current) => !current);
        }}
      >
        {accountConnected ? (
          <span className="watchface-device-dot" aria-hidden="true" />
        ) : (
          <KeyRound className="watchface-device-sign-in-icon" size={16} aria-hidden="true" />
        )}
        {statusLoading ? (
          <span className="watchface-device-label-skeleton" aria-hidden="true" />
        ) : (
          <span title={label}>{label}</span>
        )}
        {accountConnected ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ArrowRight size={15} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div
          className="watchface-device-popover"
          role="dialog"
          aria-label="COROS account and transfer status"
        >
          <div className="watchface-device-popover-heading">
            <span className={`watchface-device-icon${accountConnected ? " is-connected" : ""}`}>
              {accountConnected ? (
                <UserRound size={18} aria-hidden="true" />
              ) : (
                <KeyRound size={18} aria-hidden="true" />
              )}
            </span>
            <div className="watchface-device-heading-copy">
              <small>COROS account</small>
              <strong>
                {accountConnected ? accountEmail ?? "Connected" : "Sign in to COROS"}
              </strong>
              <span>
                {accountConnected
                  ? "Ready to publish and send watch faces"
                  : "Sign in to create a new watch face"}
              </span>
            </div>
          </div>
          <dl className="watchface-device-details">
            <div>
              <dt>Account</dt>
              <dd className={accountConnected ? "is-online" : "is-local"}>
                <span aria-hidden="true" />
                {accountConnected ? "Connected" : "Not signed in"}
              </dd>
            </div>
            <div>
              <dt>Transfer watch</dt>
              <dd className={connectedWatchName ? "is-online" : "is-offline"}>
                <span aria-hidden="true" />
                {connectedWatchName ?? "Not connected"}
              </dd>
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
              className="watchface-device-account-action is-disconnect"
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
            >
              <LogOut size={15} aria-hidden="true" />
              <span>
                <strong>Disconnect account</strong>
                <small>Your local projects stay available</small>
              </span>
            </button>
          ) : (
            <button
              className="watchface-device-account-action"
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onConnect();
              }}
            >
              <KeyRound size={15} aria-hidden="true" />
              <span>
                <strong>Sign in to COROS</strong>
                <small>Required to create a new watch face</small>
              </span>
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
  const activeIndicator = (tab: HubTab) =>
    activeTab === tab ? (
      <span className="watchface-tab-indicator" aria-hidden="true" />
    ) : null;

  return (
    <div
      className="watchface-hub-tabs watchface-dashboard-tabs"
      role="tablist"
      aria-label="Watch-face hub"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const tabs: HubTab[] = ["templates", "projects", "browse"];
        const currentIndex = tabs.indexOf(activeTab);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextTab =
          tabs[(currentIndex + direction + tabs.length) % tabs.length]!;
        onChange(nextTab);
        window.requestAnimationFrame(() => {
          document.getElementById(`watchface-${nextTab}-tab`)?.focus();
        });
      }}
    >
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
        Create
        {activeIndicator("templates")}
      </button>
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
        My projects <span className="watchface-tab-count">{projectCount}</span>
        {activeIndicator("projects")}
      </button>
      <button
        id="watchface-browse-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === "browse"}
        aria-controls="watchface-browse-panel"
        tabIndex={activeTab === "browse" ? 0 : -1}
        className={activeTab === "browse" ? "is-active" : ""}
        onClick={() => onChange("browse")}
      >
        Community
        {activeIndicator("browse")}
      </button>
    </div>
  );
}

type CommunityQuickFilter = "all" | "trending" | "newest" | "minimal" | "data-rich" | "trail";

const COMMUNITY_QUICK_FILTERS: readonly HubChip<CommunityQuickFilter>[] = [
  { value: "all", label: "All faces", icon: LayoutGrid },
  { value: "trending", label: "Trending", icon: Flame },
  { value: "newest", label: "New", icon: Sparkles },
  { value: "minimal", label: "Minimal", icon: Circle },
  { value: "data-rich", label: "Data rich", icon: BarChart3 },
  { value: "trail", label: "Trail", icon: Mountain }
];

const COMMUNITY_SORT_LABELS: Record<CommunityWatchfaceSort, string> = {
  newest: "Newest first",
  trending: "Trending this month",
  downloads: "Most downloaded",
  title: "Name A–Z"
};

function formatDownloadCount(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

export function CommunityWatchfaceBrowser({
  api,
  connectedModel,
  disabled,
  progress,
  onOpen
}: {
  api: CorosLinkApi;
  connectedModel?: string;
  disabled: boolean;
  progress: CommunityWatchfaceDownloadProgress | null;
  onOpen: (face: CommunityWatchface, model: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [model, setModel, modelPreference] = useSelectionPreference(
    COMMUNITY_MODEL_PREFERENCE,
    connectedModel ?? ""
  );
  const [style, setStyle] = useSelectionPreference(
    COMMUNITY_STYLE_PREFERENCE
  );
  const [sort, setSort] = useSelectionPreference(COMMUNITY_SORT_PREFERENCE);
  // Like the website gallery, each moderated variant group is one card.
  const { catalog, loading, loadError, hasMore, loadMore, effectiveSort } = useCommunityWatchfaceCatalog(
    api, { q: debouncedSearch, model, style, sort, view: "designs" }
  );
  const [openGroup, setOpenGroup] = useState<CommunityWatchfaceGroup | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<CommunityWatchface | null>(null);
  const [faceModels, setFaceModels] = useState<Record<string, string>>({});

  useEffect(() => {
    setFaceModels({});
  }, [model]);

  function selectedModel(face: CommunityWatchface): string {
    return [faceModels[face.id], model, connectedModel, face.models[0]]
      .find((candidate) => candidate !== undefined && face.models.includes(candidate)) ?? "";
  }

  function modelSelector(face: CommunityWatchface) {
    return (
      <label className="watchface-community-model">
        <span>Watch type</span>
        <select
          aria-label={`Watch type for ${face.title}`}
          value={selectedModel(face)}
          disabled={disabled}
          onChange={(event) => setFaceModels((current) => ({
            ...current,
            [face.id]: event.target.value
          }))}
        >
          {face.models.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    );
  }

  const modelTouchedRef = useRef(modelPreference.restored);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!modelTouchedRef.current && connectedModel) {
      setModel(connectedModel);
    }
  }, [connectedModel]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || loading || loadError || !hasMore) return;
    // Observe inside the app's scrolling pane as well as standalone layouts.
    let root = sentinel.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { root, rootMargin: "0px 0px 400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, loadError, hasMore, loadMore]);

  const modelAvailable =
    !model ||
    !catalog ||
    catalog.facets.models.some((available) => available === model);
  const styleAvailable =
    !style ||
    !catalog ||
    catalog.facets.styles.some((available) => available.value === style);

  useEffect(() => {
    if (!modelAvailable) {
      modelTouchedRef.current = true;
      setModel("");
    }
  }, [modelAvailable, setModel]);

  useEffect(() => {
    if (!styleAvailable) {
      setStyle("");
    }
  }, [setStyle, styleAvailable]);

  const percent =
    progress?.totalBytes && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
      : null;
  // Chips are shortcuts to whole views, like the website's quick filters.
  const quickFilter: CommunityQuickFilter =
    style === "minimal" || style === "data-rich" || style === "trail"
      ? style
      : !style && sort === "trending"
        ? "trending"
        : !style && sort === "newest"
          ? "all"
          : ("" as CommunityQuickFilter);
  const styleLabel = catalog?.facets.styles.find((item) => item.value === style)?.label;
  const filtered = Boolean(debouncedSearch || model || style || sort !== "newest");
  const heading = styleLabel
    ? `${styleLabel} faces`
    : sort === "trending"
      ? "Trending faces"
      : sort === "downloads"
        ? "Most downloaded faces"
        : debouncedSearch || model
          ? "Matching faces"
          : "Published faces";
  const sortFallback = sort !== effectiveSort;
  const showGroup = (next: CommunityWatchfaceGroup | null) => {
    setOpenGroup(next);
    panelRef.current?.scrollIntoView({ block: "start" });
  };
  const renderCard = (face: CommunityWatchface) => (
    <CommunityFaceCard
      key={face.id}
      face={face}
      disabled={disabled}
      opening={progress?.slug === face.slug}
      onView={() => (isVariantGroup(face) ? showGroup(face.group!) : setSelected(face))}
      onOpen={() => onOpen(face, selectedModel(face))}
    />
  );
  const progressBanner = progress ? (
    <div className="watchface-community-progress" role="status">
      <div>
        <Loader2 className="spin" size={16} aria-hidden="true" />
        <span>
          {progress.stage === "downloading"
            ? `Downloading${percent === null ? "…" : ` ${percent}%`}`
            : progress.stage === "verifying"
              ? "Verifying reviewed package…"
              : "Opening in Studio…"}
        </span>
      </div>
      <span className="watchface-community-progress-track" aria-hidden="true">
        <i style={{ width: `${percent ?? (progress.stage === "opening" ? 100 : 65)}%` }} />
      </span>
    </div>
  ) : null;

  return (
    <div
      id="watchface-browse-panel"
      ref={panelRef}
      className="watchface-community wf-hub-browse"
      role="tabpanel"
      aria-labelledby="watchface-browse-tab"
    >
      {openGroup ? (
        <CommunityVariantsView
          api={api}
          group={openGroup}
          initialModel={model}
          disabled={disabled}
          progress={progress}
          progressBanner={progressBanner}
          onBack={() => showGroup(null)}
          onView={setSelected}
          onOpen={(face, faceModel) => onOpen(face, faceModel)}
        />
      ) : (
      <>
      <section className="wf-hub-gallery-hero" aria-labelledby="community-hero-title">
        <div className="wf-hub-gallery-hero-copy">
          <p className="wf-hub-gallery-eyebrow">The library</p>
          <h2 id="community-hero-title" className="wf-hub-hand">
            Browse{" "}
            <span>
              watch faces.
              <HubHeadingUnderline />
            </span>
          </h2>
          <p className="wf-hub-gallery-lead">
            Free, community-made designs for every COROS watch — open any of them in Studio.
          </p>
          <a
            className="wf-hub-text-link wf-hub-gallery-site"
            href="https://watchfaces.coroslink.com/gallery"
            target="_blank"
            rel="noreferrer"
          >
            Open the website <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
        <p className="wf-hub-gallery-note wf-hub-hand" aria-hidden="true">
          Pick one.<br />Make it yours.
        </p>
        <span className="wf-hub-gallery-art" aria-hidden="true">
          <img className="is-dark" src={facesHeroDark} alt="" draggable={false} />
          <img className="is-light" src={facesHeroLight} alt="" draggable={false} />
        </span>
      </section>

      <HubToolbar label="Filter community faces">
        <HubSearchField
          label="Search faces"
          value={search}
          placeholder="Face, creator, or watch model"
          onChange={setSearch}
        />
        <HubSelectField
          label="Watch model"
          icon={Watch}
          value={model}
          onChange={(value) => {
            modelTouchedRef.current = true;
            setModel(value);
          }}
        >
          <option value="">All watches</option>
          {(catalog?.facets.models ?? (connectedModel ? [connectedModel] : []))
            .map((item) => <option key={item} value={item}>{item}</option>)}
        </HubSelectField>
        <HubSelectField label="Style" icon={Palette} value={style} onChange={setStyle}>
          <option value="">All styles</option>
          {(catalog?.facets.styles ?? []).map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </HubSelectField>
        <HubSelectField
          label="Sort"
          icon={ArrowDownUp}
          value={sort}
          onChange={(value) => setSort(value as CommunityWatchfaceSort)}
        >
          {(Object.keys(COMMUNITY_SORT_LABELS) as CommunityWatchfaceSort[]).map((value) => (
            <option key={value} value={value}>{COMMUNITY_SORT_LABELS[value]}</option>
          ))}
        </HubSelectField>
      </HubToolbar>

      {progressBanner}

      <section className="wf-hub-results" aria-labelledby="community-results-title">
        <HubResultsHeading
          id="community-results-title"
          icon={sort === "trending" ? Flame : styleLabel ? Palette : Sparkles}
          title={heading}
          note={
            catalog
              ? `${catalog.pagination.total} ${catalog.pagination.total === 1 ? "design" : "designs"}`
              : undefined
          }
        >
          <HubQuickFilters
            label="Quick face filters"
            chips={COMMUNITY_QUICK_FILTERS}
            active={quickFilter}
            onChange={(value) => {
              if (value === "trending" || value === "newest" || value === "all") {
                setStyle("");
                setSort(value === "trending" ? "trending" : "newest");
              } else {
                setStyle(value);
              }
            }}
          />
        </HubResultsHeading>
        {filtered ? (
          <HubFilterSummary
            summary={[
              debouncedSearch && `“${debouncedSearch}”`,
              model,
              styleLabel,
              COMMUNITY_SORT_LABELS[effectiveSort]
            ].filter(Boolean).join(" · ")}
            onClear={() => {
              modelTouchedRef.current = true;
              setSearch("");
              setModel("");
              setStyle("");
              setSort("newest");
            }}
          />
        ) : null}
        {sortFallback ? (
          <p className="wf-hub-inline-note" role="status">
            {COMMUNITY_SORT_LABELS[sort]} isn’t available from the catalog yet, so faces are shown newest first.
          </p>
        ) : null}

        {loading && !catalog ? (
          <div className="wf-hub-grid" aria-label="Loading community watch faces" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
              <div className="wf-hub-card wf-hub-card--skeleton" key={index} />
            ))}
          </div>
        ) : loadError && !catalog ? (
          <section className="watchface-community-empty" role="alert">
            <h3>Community faces are unavailable</h3>
            <p>{loadError}</p>
            <button className="primary-button" type="button" onClick={loadMore}>
              Try again
            </button>
          </section>
        ) : catalog?.items.length ? (
          <>
            <div className="wf-hub-grid wf-hub-grid--faces">{catalog.items.map(renderCard)}</div>
            <div className="watchface-community-load-more" ref={loadMoreRef}>
              {loadError ? (
                <>
                  <span role="alert">Couldn’t load more faces. {loadError}</span>
                  <button className="secondary-button" type="button" onClick={loadMore}>Try again</button>
                </>
              ) : loading ? (
                <span role="status"><Loader2 className="spin" size={16} aria-hidden="true" /> Loading more faces…</span>
              ) : hasMore ? (
                <button className="secondary-button" type="button" onClick={loadMore}>Load more faces</button>
              ) : (
                <span role="status">
                  You’ve seen all {catalog.items.length} {catalog.items.length === 1 ? "design" : "designs"}
                </span>
              )}
            </div>
          </>
        ) : (
          <section className="watchface-community-empty">
            <Watch size={28} aria-hidden="true" />
            <h3>{sort === "trending" ? "No recent downloads for these faces" : "No faces match these filters"}</h3>
            <p>Try another watch model, style, or search.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                modelTouchedRef.current = true;
                setSearch("");
                setModel("");
                setStyle("");
                setSort("newest");
              }}
            >
              Clear filters
            </button>
          </section>
        )}
      </section>
      </>
      )}

      {selected ? (
        <div className="watchface-modal-backdrop" role="presentation">
          <section
            className="watchface-modal watchface-community-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-face-title"
          >
            <button
              className="icon-button watchface-modal-close"
              type="button"
              aria-label="Close watch-face details"
              onClick={() => setSelected(null)}
            >
              <X size={17} aria-hidden="true" />
            </button>
            <img src={selected.previewUrl} alt={`Preview of ${selected.title}`} />
            <div>
              <span className="watchface-section-kicker">{selected.tags.join(" / ")}</span>
              <h2 id="community-face-title">{selected.title}</h2>
              <p>by {selected.creatorName}</p>
              <p>{selected.description}</p>
              {modelSelector(selected)}
              <small>
                {formatCommunityBytes(selected.packageBytes)} reviewed package
                {selected.downloadCount !== undefined
                  ? ` · ${formatDownloadCount(selected.downloadCount)} downloads`
                  : ""}
              </small>
              <button
                className="primary-button"
                type="button"
                disabled={disabled}
                onClick={() => onOpen(selected, selectedModel(selected))}
              >
                <Download size={16} aria-hidden="true" /> Open in Studio
              </button>
              <a href={selected.detailUrl} target="_blank" rel="noreferrer">
                View on website <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** A catalog item standing for several variants (one card, like the website). */
function isVariantGroup(face: CommunityWatchface): boolean {
  return (face.group?.variantCount ?? 0) > 1;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The website's group page: every variant of one design, filterable by watch. */
function CommunityVariantsView({
  api,
  group,
  initialModel,
  disabled,
  progress,
  progressBanner,
  onBack,
  onView,
  onOpen
}: {
  api: CorosLinkApi;
  group: CommunityWatchfaceGroup;
  initialModel: string;
  disabled: boolean;
  progress: CommunityWatchfaceDownloadProgress | null;
  progressBanner: ReactNode;
  onBack: () => void;
  onView: (face: CommunityWatchface) => void;
  onOpen: (face: CommunityWatchface, model: string) => void;
}) {
  const [model, setModel] = useState(initialModel);
  const { catalog, loading, loadError, hasMore, loadMore } = useCommunityWatchfaceCatalog(
    api, { group: group.slug, model }
  );
  const total = catalog?.pagination.total ?? group.variantCount;
  const models = catalog?.facets.models ?? [];

  return (
    <section className="wf-hub-variants" aria-labelledby="community-variants-title">
      <button className="wf-hub-text-link wf-hub-variants-back" type="button" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" /> Browse all designs
      </button>
      <header className="wf-hub-gallery-hero wf-hub-gallery-hero--group">
        <div className="wf-hub-gallery-hero-copy">
          <p className="wf-hub-gallery-eyebrow">Watch-face group</p>
          <h2 id="community-variants-title" className="wf-hub-hand">
            <span>
              {group.name}
              <HubHeadingUnderline />
            </span>
          </h2>
          <p className="wf-hub-gallery-lead">
            Explore the variants and choose a version for your watch. Each face is credited to its contributor.
          </p>
        </div>
      </header>
      <HubToolbar label="Filter variants">
        <HubSelectField label="Watch model" icon={Watch} value={model} onChange={setModel}>
          <option value="">All watches</option>
          {models.map((item) => <option key={item} value={item}>{item}</option>)}
        </HubSelectField>
      </HubToolbar>
      {progressBanner}
      <section className="wf-hub-results" aria-labelledby="community-variants-count">
        <HubResultsHeading
          id="community-variants-count"
          icon={Layers}
          title={`${pluralize(total, "variant")}${model ? ` for ${model}` : ""}`}
        />
        {loading && !catalog ? (
          <div className="wf-hub-grid wf-hub-grid--faces" aria-busy="true" aria-label="Loading variants">
            {Array.from({ length: Math.min(8, Math.max(2, group.variantCount)) }, (_, index) => (
              <div className="wf-hub-card wf-hub-card--skeleton" key={index} />
            ))}
          </div>
        ) : loadError && !catalog ? (
          <section className="watchface-community-empty" role="alert">
            <h3>Variants are unavailable</h3>
            <p>{loadError}</p>
            <button className="primary-button" type="button" onClick={loadMore}>Try again</button>
          </section>
        ) : catalog?.items.length ? (
          <>
            <div className="wf-hub-grid wf-hub-grid--faces">
              {catalog.items.map((face) => (
                <CommunityFaceCard
                  key={face.id}
                  face={face}
                  showTitle
                  disabled={disabled}
                  opening={progress?.slug === face.slug}
                  onView={() => onView(face)}
                  onOpen={() => onOpen(face, model && face.models.includes(model) ? model : face.models[0] ?? "")}
                />
              ))}
            </div>
            {hasMore || loadError ? (
              <div className="watchface-community-load-more">
                {loadError ? <span role="alert">Couldn’t load more variants. {loadError}</span> : null}
                <button className="secondary-button" type="button" disabled={loading} onClick={loadMore}>
                  {loading ? <Loader2 className="spin" size={15} aria-hidden="true" /> : null}
                  {loadError ? "Try again" : "Load more variants"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <section className="watchface-community-empty">
            <Watch size={28} aria-hidden="true" />
            <h3>No variants for this watch yet.</h3>
            <button className="secondary-button" type="button" onClick={() => setModel("")}>
              View all variants
            </button>
          </section>
        )}
      </section>
    </section>
  );
}

function CommunityFaceCard({
  face,
  disabled,
  opening,
  showTitle = false,
  onView,
  onOpen
}: {
  face: CommunityWatchface;
  disabled: boolean;
  opening: boolean;
  /** Inside a group, the card is one variant rather than the whole group. */
  showTitle?: boolean;
  onView: () => void;
  onOpen: () => void;
}) {
  const grouped = !showTitle && isVariantGroup(face);
  return (
    <article className={`wf-hub-card wf-hub-card--community${grouped ? " is-group" : ""}`}>
      <button
        className="wf-hub-card-open"
        type="button"
        aria-label={grouped ? `View ${face.title} variants` : `View ${face.title}`}
        onClick={onView}
      >
        <span className="wf-hub-card-visual">
          <span className="watchface-project-preview wf-hub-dial is-ready">
            <img src={face.previewUrl} alt="" loading="lazy" decoding="async" draggable={false} />
          </span>
          {grouped ? (
            <span className="wf-hub-card-group-badge">
              <Layers size={12} aria-hidden="true" />
              {pluralize(face.group!.variantCount, "variant")}
            </span>
          ) : null}
          {opening ? (
            <span className="wf-hub-card-busy" aria-hidden="true">
              <Loader2 className="spin" size={20} />
            </span>
          ) : null}
        </span>
        <span className="wf-hub-card-meta">
          <strong title={face.title}>{face.title}</strong>
          <span title={face.models.join(" / ")}>
            {face.models[0] ?? "Any watch"}
            {face.models.length > 1 ? ` +${face.models.length - 1}` : ""}
          </span>
        </span>
        <span className="wf-hub-card-footer">
          <span title={`Creator: ${face.creatorName}`}>
            <UserRound size={13} aria-hidden="true" />
            {face.creatorName}
          </span>
          {face.downloadCount !== undefined ? (
            <span className="wf-hub-card-template" title={`${face.downloadCount} downloads`}>
              <Download size={12} aria-hidden="true" /> {formatDownloadCount(face.downloadCount)}
            </span>
          ) : face.tags[0] ? (
            <span className="wf-hub-card-template">{face.tags[0]}</span>
          ) : null}
        </span>
        <span className="wf-hub-card-arrow" aria-hidden="true">
          <ArrowUpRight size={16} />
        </span>
      </button>
      <div className="wf-hub-card-actions">
        {grouped ? (
          <button className="wf-hub-text-link wf-hub-card-primary" type="button" onClick={onView}>
            <Layers size={14} aria-hidden="true" />
            View variants
          </button>
        ) : (
          <button className="wf-hub-text-link" type="button" disabled={disabled} onClick={onOpen}>
            {opening ? (
              <Loader2 className="spin" size={14} aria-hidden="true" />
            ) : (
              <Pencil size={14} aria-hidden="true" />
            )}
            Open in Studio
          </button>
        )}
      </div>
    </article>
  );
}

function CommunityCompatibilityDialog({
  face,
  connectedModel,
  busy,
  onCancel,
  onConfirm
}: {
  face: CommunityWatchface;
  connectedModel?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="watchface-modal-backdrop" role="presentation">
      <section
        className="watchface-modal watchface-community-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="community-compatibility-title"
      >
        <h2 id="community-compatibility-title">Compatibility not listed</h2>
        <p>
          “{face.title}” lists {face.models.join(", ")}, not {connectedModel ?? "your connected watch"}.
          You can still inspect and edit it in Studio, but it may not work on this watch.
        </p>
        <div className="watchface-modal-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
            Open anyway
          </button>
        </div>
      </section>
    </div>
  );
}

function formatCommunityBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
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
  onDuplicate: (project: CorosWatchfaceProjectSummary) => void;
  onDelete: (project: CorosWatchfaceProjectSummary) => void;
  onCreate: () => void;
  onImport: () => void;
}

const OTHER_WATCH_LABEL = "Other watches";

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
  onDuplicate,
  onDelete,
  onCreate,
  onImport
}: ProjectsDashboardProps) {
  const [search, setSearch] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [sort, setSort] = useSelectionPreference(PROJECT_SORT_PREFERENCE);
  const modelChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      const label = projectWatchModelLabel(project) ?? OTHER_WATCH_LABEL;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) =>
        left[0] === OTHER_WATCH_LABEL ? 1 : right[0] === OTHER_WATCH_LABEL ? -1 : right[1] - left[1]
      )
      .map(([label, count]) => ({ value: label, label, count }));
  }, [projects]);
  const activeModel = modelChips.some((chip) => chip.value === modelFilter) ? modelFilter : "";
  const query = search.trim().toLocaleLowerCase();
  const shownProjects = useMemo(() => {
    const filtered = projects.filter((project) => {
      if (activeModel && (projectWatchModelLabel(project) ?? OTHER_WATCH_LABEL) !== activeModel) {
        return false;
      }
      if (!query) return true;
      return [project.name, project.sourceTemplateId, projectWatchModelLabel(project)]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
    return filtered.sort((left, right) =>
      sort === "name"
        ? left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true })
        : sort === "oldest"
          ? updatedAtValue(left.updatedAt) - updatedAtValue(right.updatedAt)
          : updatedAtValue(right.updatedAt) - updatedAtValue(left.updatedAt)
    );
  }, [activeModel, projects, query, sort]);
  const filtered = Boolean(query || activeModel);
  const renderCard = (project: CorosWatchfaceProjectSummary) => (
    <ProjectCard
      api={api}
      project={project}
      key={project.projectId}
      disabled={disabled}
      onOpen={() => onOpen(project)}
      onDuplicate={() => onDuplicate(project)}
      onDelete={() => onDelete(project)}
    />
  );

  return (
    <div
      id="watchface-projects-panel"
      className="watchface-hub-projects watchface-dashboard-projects wf-hub-browse"
      role="tabpanel"
      aria-labelledby="watchface-projects-tab"
    >
      {loading ? (
        <ProjectsDashboardSkeleton />
      ) : featuredProject ? (
        <>
          {!filtered ? (
            <>
              <ContinueDesigningCard
                api={api}
                project={featuredProject}
                projects={projects}
                disabled={disabled}
                opening={openingProject}
                onOpen={() => onOpen(featuredProject)}
                onDuplicate={() => onDuplicate(featuredProject)}
                onDelete={() => onDelete(featuredProject)}
              />
            </>
          ) : null}
          <HubToolbar label="Filter projects">
            <HubSearchField
              label="Search projects"
              value={search}
              placeholder="Project name, watch, or template"
              onChange={setSearch}
            />
            <HubSelectField
              label="Watch model"
              icon={Watch}
              value={activeModel}
              onChange={setModelFilter}
            >
              <option value="">All watches</option>
              {modelChips.map((chip) => (
                <option key={chip.value} value={chip.value}>
                  {chip.label}
                </option>
              ))}
            </HubSelectField>
            <HubSelectField
              label="Sort projects"
              icon={ArrowDownUp}
              value={sort}
              onChange={(value) => setSort(value as ProjectSortMode)}
            >
              <option value="recent">Last edited</option>
              <option value="name">Name A–Z</option>
              <option value="oldest">Oldest first</option>
            </HubSelectField>
            <button
              className="primary-button wf-hub-toolbar-action"
              type="button"
              disabled={disabled}
              onClick={onCreate}
            >
              <Plus size={16} aria-hidden="true" /> New face
            </button>
          </HubToolbar>
          <section className="wf-hub-results" aria-labelledby="projects-title">
            <HubResultsHeading
              id="projects-title"
              icon={History}
              title={
                activeModel ||
                (query ? "Matching projects" : sort === "name" ? "All projects" : "Recent projects")
              }
              note={`${shownProjects.length} ${shownProjects.length === 1 ? "project" : "projects"}`}
            >
              {modelChips.length > 1 ? (
                <HubQuickFilters
                  label="Filter by watch"
                  chips={[
                    { value: "", label: "All", icon: LayoutGrid, count: projects.length },
                    ...modelChips.slice(0, 6)
                  ]}
                  active={activeModel}
                  onChange={setModelFilter}
                />
              ) : null}
            </HubResultsHeading>
            {filtered ? (
              <HubFilterSummary
                summary={[query && `“${search.trim()}”`, activeModel].filter(Boolean).join(" · ")}
                onClear={() => {
                  setSearch("");
                  setModelFilter("");
                }}
              />
            ) : null}
            {shownProjects.length === 0 ? (
              <div className="watchface-hub-empty">
                <span aria-hidden="true"><Search size={24} /></span>
                <h4>No projects match</h4>
                <p>Try another name or watch model.</p>
              </div>
            ) : (
              <div className="wf-hub-grid">
                {shownProjects.map(renderCard)}
                {!filtered ? <CreateProjectCard disabled={disabled} onCreate={onCreate} /> : null}
              </div>
            )}
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
  projects,
  disabled,
  opening,
  onOpen,
  onDuplicate,
  onDelete
}: {
  api: CorosLinkApi;
  project: CorosWatchfaceProjectSummary;
  projects: CorosWatchfaceProjectSummary[];
  disabled: boolean;
  opening: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const model = projectWatchModelLabel(project);
  return (
    <article className="wf-hub-hero wf-hub-hero--faces" aria-labelledby="featured-project-title">
      <div className="wf-hub-hero-copy">
        <p className="wf-hub-eyebrow">Continue designing</p>
        <h2 id="featured-project-title" className="wf-hub-hero-title wf-hub-hand" title={project.name}>
          {project.name}
        </h2>
        <div className="wf-hub-chips">
          {model ? (
            <span className="wf-hub-chip">
              <Watch size={14} aria-hidden="true" /> {model}
            </span>
          ) : null}
          <span className="wf-hub-chip" title={`Template ${project.sourceTemplateId}`}>
            <Layers size={14} aria-hidden="true" /> Template {project.sourceTemplateId}
          </span>
          <span className="wf-hub-chip" title={formatExactUpdatedAt(project.updatedAt)}>
            <Clock size={14} aria-hidden="true" /> Updated {formatRelativeUpdatedAt(project.updatedAt)}
          </span>
        </div>
        <div className="wf-hub-hero-actions">
          <button
            className="primary-button wf-hub-hero-open"
            type="button"
            disabled={disabled}
            onClick={onOpen}
          >
            {opening ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : null}
            Open editor <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button
            className="wf-hub-text-link"
            type="button"
            disabled={disabled}
            onClick={onDuplicate}
          >
            <Copy size={15} aria-hidden="true" /> Duplicate
          </button>
        </div>
        <ProjectsLibraryFacts projects={projects} />
      </div>
      <p className="wf-hub-hero-note wf-hub-hand" aria-hidden="true">
        Right where<br />you left off.
        <svg viewBox="0 0 64 34" className="wf-hub-hero-note-arrow">
          <path d="M3 6 C18 2 36 4 46 14 S57 26 58 30" />
          <path d="M50 25 L58 31 L61 21" />
        </svg>
      </p>
      <div className="wf-hub-hero-stage" aria-hidden="true">
        <span className="wf-hub-hero-halo" />
        <span className="wf-hub-hero-spark is-one">✦</span>
        <span className="wf-hub-hero-spark is-two">✦</span>
        <WatchFacePreview api={api} project={project} />
      </div>
      <ProjectOverflowMenu
        projectName={project.name}
        disabled={disabled}
        onOpen={onOpen}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </article>
  );
}

/** Watch model the project's starter template targets, when the summary records one. */
function projectWatchModelLabel(project: CorosWatchfaceProjectSummary): string | null {
  if (!project.firmwareType) return null;
  const model = templateWatchModelForFirmware(project.firmwareType);
  return TEMPLATE_WATCH_OPTIONS.find((option) => option.model === model)?.label ?? null;
}

/** The site's hero facts row: bold value, muted label. */
function ProjectsLibraryFacts({ projects }: { projects: CorosWatchfaceProjectSummary[] }) {
  const models = new Set(
    projects.map(projectWatchModelLabel).filter((label): label is string => label !== null)
  );
  return (
    <ul className="wf-hub-hero-facts" aria-label="About your library">
      <li>
        <Layers size={16} aria-hidden="true" />
        <strong>{projects.length}</strong>
        <span>{projects.length === 1 ? "project" : "projects"}</span>
      </li>
      {models.size > 0 ? (
        <li>
          <Watch size={16} aria-hidden="true" />
          {models.size === 1 ? (
            <strong>{[...models][0]}</strong>
          ) : (
            <>
              <strong>{models.size}</strong>
              <span>watch models</span>
            </>
          )}
        </li>
      ) : null}
    </ul>
  );
}

function ProjectCard({
  api,
  project,
  disabled,
  onOpen,
  onDuplicate,
  onDelete
}: {
  api: CorosLinkApi;
  project: CorosWatchfaceProjectSummary;
  disabled: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const model = projectWatchModelLabel(project);
  return (
    <article className="wf-hub-card">
      <button
        className="wf-hub-card-open"
        type="button"
        aria-label={`Open ${project.name}`}
        disabled={disabled}
        onClick={onOpen}
      >
        <span className="wf-hub-card-visual">
          <WatchFacePreview api={api} project={project} />
        </span>
        <span className="wf-hub-card-meta">
          <strong title={project.name}>{project.name}</strong>
          <span>{model ?? "COROS watch face"}</span>
        </span>
        <span className="wf-hub-card-footer">
          <span title={formatExactUpdatedAt(project.updatedAt)}>
            <Clock size={13} aria-hidden="true" />
            {formatRelativeUpdatedAt(project.updatedAt)}
          </span>
          <span className="wf-hub-card-template" title={`Template ${project.sourceTemplateId}`}>
            #{project.sourceTemplateId}
          </span>
        </span>
        <span className="wf-hub-card-arrow" aria-hidden="true">
          <ArrowUpRight size={16} />
        </span>
      </button>
      <ProjectOverflowMenu
        projectName={project.name}
        disabled={disabled}
        onOpen={onOpen}
        onDuplicate={onDuplicate}
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
      className="wf-hub-create"
      type="button"
      disabled={disabled}
      onClick={onCreate}
    >
      <span className="wf-hub-create-icon" aria-hidden="true"><Plus size={22} /></span>
      <strong>Create watch face</strong>
      <span>Start from an official template</span>
    </button>
  );
}

function ProjectOverflowMenu({
  projectName,
  disabled,
  onOpen,
  onDuplicate,
  onDelete
}: {
  projectName: string;
  disabled: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
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
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onDuplicate();
            }}
          >
            <Copy size={15} aria-hidden="true" /> Duplicate
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
        <div />
        <span />
      </div>
      <div className="watchface-project-grid-skeleton">
        <div />
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

interface RenderedProjectPreviewCacheEntry {
  updatedAt: string;
  promise: Promise<string>;
}

const projectPreviewCache = new WeakMap<
  CorosLinkApi,
  Map<string, ProjectPreviewCacheEntry>
>();
const renderedProjectPreviewCache = new WeakMap<
  CorosLinkApi,
  Map<string, RenderedProjectPreviewCacheEntry>
>();
const projectThumbnailCache = new WeakMap<
  CorosLinkApi,
  Map<string, { version: string; promise: Promise<string>; url?: string }>
>();
// Rendering a missing thumbnail loads the whole project, so only one at a time.
const enqueueProjectPreviewRender = createTaskQueue(1);

function projectThumbnailVersion(project: CorosWatchfaceProjectSummary): string {
  return `${project.updatedAt}|${project.previewUpdatedAt ?? ""}`;
}

/** A thumbnail already resolved this session, for instant remounts. */
function peekProjectThumbnail(
  api: CorosLinkApi,
  project: CorosWatchfaceProjectSummary
): string | null {
  const cached = projectThumbnailCache.get(api)?.get(project.projectId);
  return cached?.version === projectThumbnailVersion(project) ? cached.url ?? null : null;
}

/** Stored thumbnail first; otherwise render one (queued) and store it. */
function loadProjectThumbnail(
  api: CorosLinkApi,
  project: CorosWatchfaceProjectSummary
): Promise<string> {
  let cache = projectThumbnailCache.get(api);
  if (!cache) {
    cache = new Map();
    projectThumbnailCache.set(api, cache);
  }
  const version = projectThumbnailVersion(project);
  const cached = cache.get(project.projectId);
  if (cached?.version === version) return cached.promise;
  const entry: { version: string; promise: Promise<string>; url?: string } = {
    version,
    promise: (async () => {
      if (project.previewUpdatedAt) {
        const stored = await api
          .loadCorosWatchfaceProjectPreview(project.projectId)
          .catch(() => null);
        if (stored) return stored;
      }
      return enqueueProjectPreviewRender(() => renderProjectPreview(api, project));
    })()
  };
  cache.set(project.projectId, entry);
  entry.promise.then(
    (url) => {
      entry.url = url;
    },
    () => {
      if (cache.get(project.projectId) === entry) cache.delete(project.projectId);
    }
  );
  return entry.promise;
}

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
  void promise.then(
    () => {
      // The design is only needed to draw the thumbnail; don't pin it.
      if (cache.get(project.projectId)?.promise === promise) cache.delete(project.projectId);
    },
    () => {
      if (cache.get(project.projectId)?.promise === promise) cache.delete(project.projectId);
    }
  );
  return promise;
}

function renderProjectPreview(
  api: CorosLinkApi,
  project: CorosWatchfaceProjectSummary
): Promise<string> {
  let cache = renderedProjectPreviewCache.get(api);
  if (!cache) {
    cache = new Map();
    renderedProjectPreviewCache.set(api, cache);
  }
  const cached = cache.get(project.projectId);
  if (cached?.updatedAt === project.updatedAt) return cached.promise;

  const promise = (async () => {
    const assetCache = new Map<string, CorosWatchfaceTemplateAsset>();
    const loadedProject = await loadProjectPreview(api, project);
    const [details] = await Promise.all([
      api.describeCorosWatchfaceTemplate(loadedProject.archive.archiveId),
      // Thumbnails of faces whose fonts are not installed use saved glyphs.
      rememberWatchfaceFontSnapshots(loadedProject.design.fontSnapshots)
    ]);
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
    const canvas = document.createElement("canvas");
    canvas.width = 416;
    canvas.height = 416;
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
    await drawStudioPreview(
      canvas,
      backgroundDataUrl,
      detailsForPreviewResolution(
        previewDetails,
        watchResolution.directory
      ),
      {
        ...toStudioOptions(loadedProject.design),
        effectResolutionScale: watchResolution.width / resolution.width,
        nativeSpriteResolutionScale: watchResolution.width / resolution.width
      },
      loadAssets
    );
    await drawNativeDataPreview(canvas, resolution.width, loadedProject.design.nativeData);
    const weather = loadedProject.design.weatherIndicator;
    if (weather?.enabled) {
      if (!loadedProject.design.nativeData?.weather_temp) await drawWeatherTemperaturePreview(canvas, resolution.width, weather);
      const url = await weatherPreviewDataUrl(resolution.width, weather.color, weather);
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
    const previewDataUrl = canvas.toDataURL("image/png");
    void api
      .cacheCorosWatchfaceProjectPreview(project.projectId, previewDataUrl)
      .catch(() => undefined);
    return previewDataUrl;
  })();

  cache.set(project.projectId, { updatedAt: project.updatedAt, promise });
  void promise.catch(() => {
    if (cache.get(project.projectId)?.promise === promise) {
      cache.delete(project.projectId);
    }
  });
  return promise;
}

function WatchFacePreview({
  api,
  project
}: {
  api: CorosLinkApi;
  project: CorosWatchfaceProjectSummary;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const known = project.previewDataUrl ?? peekProjectThumbnail(api, project);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(known);
  const [previewState, setPreviewState] = useState<ProjectPreviewState>(
    known ? "ready" : "loading"
  );
  const nearViewport = useNearViewport(containerRef);
  const version = projectThumbnailVersion(project);

  useEffect(() => {
    let cancelled = false;
    if (known) {
      setPreviewDataUrl(known);
      setPreviewState("ready");
      return;
    }
    setPreviewDataUrl(null);
    setPreviewState("loading");
    // Off-screen cards wait, so opening the tab never loads every project.
    if (!nearViewport) return;
    void loadProjectThumbnail(api, project)
      .then((url) => {
        if (cancelled) return;
        setPreviewDataUrl(url);
        setPreviewState("ready");
      })
      .catch(() => {
        if (!cancelled) setPreviewState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [api, known, nearViewport, project.projectId, version]);

  return (
    <span
      ref={containerRef}
      className={`watchface-project-preview is-${previewState}`}
      aria-busy={previewState === "loading"}
    >
      {previewDataUrl ? (
        <img
          src={previewDataUrl}
          alt={`${project.name} watch-face preview`}
          decoding="async"
          draggable={false}
        />
      ) : null}
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
  accountConnected: boolean;
  busy: "login" | "themes" | "archive" | "publish" | "project" | "community" | null;
  catalog: CorosWatchfaceThemeCatalog;
  watchModel: WatchModelId | "";
  firmwareType: string;
  language: string;
  maxWatchFaceVersion: string;
  watchSerial: string;
  modelVersion: string;
  search: string;
  themes: CorosWatchfaceTheme[];
  visibleThemes: CorosWatchfaceTheme[];
  themesLoaded: boolean;
  savedAt: string | null;
  refreshing: boolean;
  downloadingThemeUrl: string | null;
  openingThemeUrl: string | null;
  sharingThemeId: string | null;
  onSignIn: () => void;
  onCatalogChange: (catalog: CorosWatchfaceThemeCatalog) => void;
  onWatchModelChange: (model: WatchModelId) => void;
  onFirmwareTypeChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onMaxVersionChange: (value: string) => void;
  onWatchSerialChange: (value: string) => void;
  onModelVersionChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onUseTheme: (theme: CorosWatchfaceTheme) => void;
  onOpenOfficialTheme: (theme: CorosWatchfaceTheme) => void;
  onShareTheme: (theme: CorosWatchfaceTheme) => void;
}

const TEMPLATE_CATALOG_CHIPS: readonly HubChip<CorosWatchfaceThemeCatalog>[] = [
  { value: "editable", label: "Editable templates", icon: Pencil },
  { value: "official", label: "Official faces", icon: Watch },
  { value: "custom", label: "My faces", icon: UserRound }
];

const UNCATEGORIZED_TEMPLATE = "Other";

function templateCategory(theme: CorosWatchfaceTheme): string {
  return theme.category?.trim() || UNCATEGORIZED_TEMPLATE;
}

function TemplatesPanel(props: TemplatesPanelProps) {
  const [category, setCategory] = useState("");
  const [sort, setSort] = useSelectionPreference(TEMPLATE_SORT_PREFERENCE);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const theme of props.visibleThemes) {
      const name = templateCategory(theme);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) =>
        left[0] === UNCATEGORIZED_TEMPLATE ? 1 : right[0] === UNCATEGORIZED_TEMPLATE ? -1 : right[1] - left[1]
      )
      .map(([name, count]) => ({ name, count }));
  }, [props.visibleThemes]);
  const activeCategory = categories.some((item) => item.name === category) ? category : "";
  const shownThemes = useMemo(() => {
    const filtered = activeCategory
      ? props.visibleThemes.filter((theme) => templateCategory(theme) === activeCategory)
      : props.visibleThemes;
    if (sort === "catalog") return filtered;
    return [...filtered].sort((left, right) =>
      sort === "name"
        ? left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true })
        : (right.watchFaceVersion ?? -1) - (left.watchFaceVersion ?? -1)
    );
  }, [activeCategory, props.visibleThemes, sort]);
  const filtered = Boolean(props.search.trim() || activeCategory);
  const actionsBusy =
    props.busy !== null || props.downloadingThemeUrl !== null || props.openingThemeUrl !== null;
  const renderCard = (theme: CorosWatchfaceTheme, index: number) => (
    <TemplateCard
      key={theme.id ?? `${theme.name}-${index}`}
      theme={theme}
      catalog={props.catalog}
      busy={props.busy}
      actionsBusy={actionsBusy}
      downloading={props.downloadingThemeUrl === theme.packageUrl}
      opening={props.openingThemeUrl === theme.packageUrl}
      sharing={props.sharingThemeId === theme.id}
      onUse={() => props.onUseTheme(theme)}
      onOpenOfficial={() => props.onOpenOfficialTheme(theme)}
      onShare={() => props.onShareTheme(theme)}
    />
  );

  return (
    <section
      id="watchface-templates-panel"
      className="watchface-hub-section watchface-template-browser wf-hub-browse"
      role="tabpanel"
      aria-labelledby="watchface-templates-tab"
    >
      <section
        className="wf-hub-gallery-hero wf-hub-create-hero"
        aria-labelledby="watchface-create-title"
      >
        <div className="wf-hub-gallery-hero-copy">
          <p className="wf-hub-gallery-eyebrow">Watch Face Studio</p>
          <h2 id="watchface-create-title" className="wf-hub-hand">
            Start with a face.{" "}
            <span>
              Make it yours.
              <HubHeadingUnderline />
            </span>
          </h2>
          <p className="wf-hub-gallery-lead">
            {props.accountConnected
              ? "Choose a compatible design, customize every layer, then export it to your watch."
              : "Sign in to your COROS account to choose a template and start creating."}
          </p>
          <ol className="wf-hub-hero-facts wf-hub-create-steps" aria-label="Watch face creation steps">
            <li>
              <Watch size={16} aria-hidden="true" />
              <strong>Choose</strong>
              <span>a compatible base</span>
            </li>
            <li>
              <Pencil size={16} aria-hidden="true" />
              <strong>Customize</strong>
              <span>in Studio</span>
            </li>
            <li>
              <Upload size={16} aria-hidden="true" />
              <strong>Export</strong>
              <span>to your watch</span>
            </li>
          </ol>
        </div>
        <p className="wf-hub-gallery-note wf-hub-create-note wf-hub-hand" aria-hidden="true">
          Three steps.<br />No code needed.
        </p>
        <div className="wf-hub-create-stage" aria-hidden="true">
          <span className="wf-hub-hero-spark is-one">✦</span>
          <span className="wf-hub-hero-spark is-two">✦</span>
          <img src={glassFace} alt="" draggable={false} />
          <img src={preClassicFace} alt="" draggable={false} />
          <img src={kineticEnergyFace} alt="" draggable={false} />
        </div>
      </section>
      {!props.accountConnected ? (
        <section
          className="watchface-create-auth-required"
          aria-labelledby="watchface-signin-required-title"
        >
          <span aria-hidden="true"><KeyRound size={24} /></span>
          <div>
            <h3 id="watchface-signin-required-title">Sign in before you create</h3>
            <p>
              Your COROS account is required to browse starter templates and create a new watch face.
            </p>
          </div>
          <button className="primary-button" type="button" onClick={props.onSignIn}>
            <KeyRound size={16} aria-hidden="true" />
            Sign in to COROS
          </button>
        </section>
      ) : (
        <>
          <HubQuickFilters
            label="Template catalog"
            chips={TEMPLATE_CATALOG_CHIPS}
            active={props.catalog}
            onChange={props.onCatalogChange}
          />
          <form className="wf-hub-toolbar-form" onSubmit={props.onSubmit}>
            <HubToolbar label="Filter templates">
              <HubSearchField
                label="Search templates"
                value={props.search}
                placeholder="Template name, ID, or category"
                onChange={props.onSearchChange}
              />
              <HubSelectField
                label="Watch model"
                icon={Watch}
                value={props.watchModel}
                onChange={(value) => props.onWatchModelChange(value as WatchModelId)}
              >
                {props.watchModel === "" ? (
                  <option value="" disabled>
                    Custom firmware
                  </option>
                ) : null}
                {TEMPLATE_WATCH_OPTIONS.map((option) => (
                  <option key={option.model} value={option.model}>
                    {option.label}
                  </option>
                ))}
              </HubSelectField>
              <HubSelectField
                label="Sort templates"
                icon={ArrowDownUp}
                value={sort}
                onChange={(value) => setSort(value as TemplateSortMode)}
              >
                <option value="catalog">COROS order</option>
                <option value="name">Name A–Z</option>
                <option value="version">Newest format</option>
              </HubSelectField>
              <button
                className="primary-button wf-hub-toolbar-action"
                type="button"
                disabled={props.busy !== null || props.refreshing}
                onClick={props.onRefresh}
              >
                {props.busy === "themes" || props.refreshing ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <RefreshCw size={16} aria-hidden="true" />
                )}
                {props.busy === "themes" ? "Loading" : props.refreshing ? "Refreshing" : "Refresh"}
              </button>
            </HubToolbar>
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
            <div className="wf-hub-grid" aria-label="Loading templates" aria-busy="true">
              {Array.from({ length: 8 }, (_, index) => (
                <div className="wf-hub-card wf-hub-card--skeleton" key={index} />
              ))}
            </div>
          ) : props.themesLoaded ? (
            <section className="wf-hub-results" aria-labelledby="watchface-template-results-title">
              <HubResultsHeading
                id="watchface-template-results-title"
                icon={LayoutGrid}
                title={
                  activeCategory ||
                  (filtered ? "Matching templates" : watchfaceCatalogTitle(props.catalog))
                }
                note={
                  <>
                    {shownThemes.length}{" "}
                    {shownThemes.length === 1 ? "design" : "designs"}
                    {props.savedAt ? (
                      <span
                        className="wf-hub-cache-note"
                        title={`Saved ${formatExactUpdatedAt(props.savedAt)}`}
                      >
                        {props.refreshing
                          ? " · refreshing…"
                          : ` · updated ${formatCachedAge(props.savedAt)}`}
                      </span>
                    ) : null}
                  </>
                }
              >
                {categories.length > 1 ? (
                  <HubQuickFilters
                    label="Template categories"
                    chips={[
                      { value: "", label: "All", icon: LayoutGrid, count: props.visibleThemes.length },
                      ...categories.slice(0, 7).map(({ name, count }) => ({
                        value: name,
                        label: name,
                        count
                      }))
                    ]}
                    active={activeCategory}
                    onChange={setCategory}
                  />
                ) : null}
              </HubResultsHeading>
              {filtered ? (
                <HubFilterSummary
                  summary={[props.search.trim() && `“${props.search.trim()}”`, activeCategory]
                    .filter(Boolean)
                    .join(" · ")}
                  onClear={() => {
                    props.onSearchChange("");
                    setCategory("");
                  }}
                />
              ) : null}
              {shownThemes.length === 0 ? (
                <div className="watchface-hub-empty">
                  <span aria-hidden="true"><Search size={24} /></span>
                  <h4>{props.themes.length === 0 ? "No templates found" : "No matches"}</h4>
                  <p>
                    {props.themes.length === 0
                      ? "Try a different catalog or update the advanced filters."
                      : "Try a different search term or category."}
                  </p>
                </div>
              ) : (
                <div className="wf-hub-grid">{shownThemes.map(renderCard)}</div>
              )}
            </section>
          ) : (
            <div className="watchface-template-welcome">
              <span aria-hidden="true"><LayoutGrid size={26} /></span>
              <h4>Find a starting point</h4>
              <p>Browse COROS templates compatible with your watch and firmware.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TemplateCard({
  theme,
  catalog,
  busy,
  actionsBusy,
  downloading,
  opening,
  sharing,
  onUse,
  onOpenOfficial,
  onShare
}: {
  theme: CorosWatchfaceTheme;
  catalog: CorosWatchfaceThemeCatalog;
  busy: TemplatesPanelProps["busy"];
  actionsBusy: boolean;
  downloading: boolean;
  opening: boolean;
  sharing: boolean;
  onUse: () => void;
  onOpenOfficial: () => void;
  onShare: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const primary =
    catalog === "official" && theme.packageUrl
      ? { label: opening ? "Opening…" : "Open in editor", icon: Pencil, run: onOpenOfficial, active: opening }
      : catalog === "editable" && theme.packageUrl
        ? { label: "Use template", icon: ArrowRight, run: onUse, active: downloading }
        : null;
  return (
    <article className="wf-hub-card wf-hub-card--template">
      <button
        className="wf-hub-card-open"
        type="button"
        disabled={!primary || actionsBusy}
        aria-label={primary ? `${primary.label}: ${theme.name}` : theme.name}
        onClick={primary?.run}
      >
        <span className="wf-hub-card-visual">
          <span className="watchface-project-preview wf-hub-dial is-ready">
            {theme.previewImageUrl && !imageFailed ? (
              <img
                src={theme.previewImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                draggable={false}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span className="watchface-project-preview-fallback">
                <Watch size={26} aria-hidden="true" />
              </span>
            )}
          </span>
          {primary?.active ? (
            <span className="wf-hub-card-busy" aria-hidden="true">
              <Loader2 className="spin" size={20} />
            </span>
          ) : null}
        </span>
        <span className="wf-hub-card-meta">
          <strong title={theme.name}>{theme.name}</strong>
          <span>{theme.category ?? watchfaceCatalogLabel(catalog)}</span>
        </span>
        <span className="wf-hub-card-footer">
          <span>{theme.id ? `#${theme.id}` : "COROS"}</span>
          {theme.watchFaceVersion !== undefined ? (
            <span className="wf-hub-card-template">v{theme.watchFaceVersion}</span>
          ) : null}
        </span>
        {primary ? (
          <span className="wf-hub-card-arrow" aria-hidden="true">
            <ArrowUpRight size={16} />
          </span>
        ) : null}
      </button>
      {catalog === "editable" && theme.packageUrl ? (
        <div className="wf-hub-card-actions">
          <button
            className="wf-hub-text-link wf-hub-card-primary"
            type="button"
            disabled={actionsBusy}
            onClick={onUse}
          >
            {downloading ? (
              <Loader2 className="spin" size={14} aria-hidden="true" />
            ) : (
              <Pencil size={14} aria-hidden="true" />
            )}
            {downloading ? "Opening…" : "Use this template"}
          </button>
        </div>
      ) : catalog === "official" && theme.packageUrl ? (
        <div className="wf-hub-card-actions">
          <button
            className="wf-hub-text-link wf-hub-card-primary"
            type="button"
            disabled={actionsBusy}
            onClick={onOpenOfficial}
          >
            {opening ? (
              <Loader2 className="spin" size={14} aria-hidden="true" />
            ) : (
              <Pencil size={14} aria-hidden="true" />
            )}
            {opening ? "Opening…" : "Open in editor"}
          </button>
          <button className="wf-hub-text-link" type="button" disabled={actionsBusy} onClick={onUse}>
            {downloading ? (
              <Loader2 className="spin" size={14} aria-hidden="true" />
            ) : (
              <Download size={14} aria-hidden="true" />
            )}
            Download
          </button>
        </div>
      ) : catalog === "custom" ? (
        <div className="wf-hub-card-actions">
          {theme.packageUrl ? (
            <button className="wf-hub-text-link" type="button" disabled={actionsBusy} onClick={onUse}>
              {downloading ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <Download size={14} aria-hidden="true" />
              )}
              Download
            </button>
          ) : null}
          <button className="wf-hub-text-link" type="button" disabled={busy !== null} onClick={onShare}>
            {sharing ? (
              <Loader2 className="spin" size={14} aria-hidden="true" />
            ) : (
              <Share2 size={14} aria-hidden="true" />
            )}
            Share
          </button>
        </div>
      ) : !theme.packageUrl ? (
        <div className="wf-hub-card-actions">
          <span className="watchface-template-unavailable">Unavailable</span>
        </div>
      ) : null}
    </article>
  );
}

function watchfaceCatalogTitle(catalog: CorosWatchfaceThemeCatalog): string {
  return catalog === "official"
    ? "Official watch faces"
    : catalog === "custom"
      ? "My COROS faces"
      : "Editable templates";
}

interface WatchfaceSignInFormProps {
  email: string;
  password: string;
  region: CorosWatchfaceRegion;
  secureStorageAvailable: boolean;
  savedCredentialsAvailable: boolean;
  savedEmail?: string;
  rememberCredentials: boolean;
  loginBusy: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberCredentialsChange: (value: boolean) => void;
  onRegionChange: (value: CorosWatchfaceRegion) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onSavedLogin: () => void;
}

function WatchfaceSignInForm(props: WatchfaceSignInFormProps) {
  return (
    <form
      className="watchface-publish-form watchface-publish-login"
      onSubmit={props.onLogin}
    >
      {props.savedCredentialsAvailable && props.savedEmail ? (
        <>
          <div className="watchface-saved-login">
            <div>
              <span>Saved COROS account</span>
              <strong>{props.savedEmail}</strong>
              <small>
                Sign in with the account saved on this computer.
              </small>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={props.loginBusy}
              onClick={props.onSavedLogin}
            >
              {props.loginBusy ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <KeyRound size={16} aria-hidden="true" />
              )}
              Use saved account
            </button>
          </div>
          <div className="watchface-auth-divider">
            <span>or use another account</span>
          </div>
        </>
      ) : null}
      <label className="field">
        Account region
        <select
          autoFocus
          disabled={props.loginBusy}
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
          disabled={props.loginBusy}
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
          disabled={props.loginBusy}
          autoComplete="current-password"
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.target.value)}
          required
        />
      </label>
      {props.secureStorageAvailable ? (
        <label className="watchface-auth-remember">
          <input
            type="checkbox"
            checked={props.rememberCredentials}
            onChange={(event) =>
              props.onRememberCredentialsChange(event.target.checked)
            }
            disabled={props.loginBusy}
          />
          <span>
            Save this COROS account
            <small>
              Reuse it for Training Hub or future watch-face sign-ins.
            </small>
          </span>
        </label>
      ) : null}
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
  );
}

interface PublishDialogProps extends WatchfaceSignInFormProps {
  archive: CorosWatchfaceArchive | null;
  name: string;
  firmwareType: string;
  backgroundImageId: string;
  language: string;
  shareLink: CorosWatchfaceShareLink | null;
  connected: boolean;
  busy: boolean;
  onNameChange: (value: string) => void;
  onFirmwareTypeChange: (value: string) => void;
  onBackgroundImageIdChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
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
            <WatchfaceSignInForm {...props} />
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

function WatchfaceConversionDialog({ name, sourceFirmwareType, bakes, busy, error, signIn, onCancel, onConvert }: {
  name: string; sourceFirmwareType: string; bakes: boolean; busy: boolean; error: string | null;
  signIn?: WatchfaceSignInFormProps;
  onCancel: () => void; onConvert: (model: WatchModelId) => void;
}) {
  const options = WATCHFACE_TARGETS.filter(target => target.firmwareType.toUpperCase() !== sourceFirmwareType.toUpperCase());
  const [model, setModel] = useState<WatchModelId>(options[0]!.model);
  const target = getWatchfaceTarget(model)!;
  const dialog = useRef<HTMLDivElement>(null);
  const signingIn = Boolean(signIn);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLSelectElement>("select")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLButtonElement>(".wf-convert-button")?.focus();
    };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }, [signingIn]);
  return (
    <div className="watchface-modal-backdrop" role="presentation" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key === "Tab") {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)") ?? [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div ref={dialog} className="watchface-modal watchface-convert-dialog" role="dialog" aria-modal="true" aria-labelledby="watchface-convert-title" aria-busy={busy}>
        <h2 id="watchface-convert-title">{signIn ? "Sign in to COROS" : "Change watch"}</h2>
        {signIn ? (
          <>
            <p>Sign in to download support for {target.label}. Your design stays open, and conversion continues automatically.</p>
            {error ? <p role="alert">{error}</p> : null}
            <WatchfaceSignInForm {...signIn} />
            {!signIn.secureStorageAvailable ? (
              <p className="watchface-auth-warning">Secure storage is unavailable. This session will be cleared when CorosLink closes.</p>
            ) : null}
            <div className="watchface-modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Back to watch selection</button>
            </div>
          </>
        ) : (
          <>
            <p>{bakes
              ? `Bring “${name}” to another watch. This recovered official face is rebuilt from its native layout with your edits applied, then opens as a new starter you can keep editing.`
              : `Bring “${name}” to another watch. Your layout, fonts, artwork and data fields stay editable.`}</p>
            <label className="field">Destination watch
              <select value={model} disabled={busy} onChange={event => setModel(event.target.value as WatchModelId)}>
                {options.map(option => <option key={option.model} value={option.model}>{option.label}</option>)}
              </select>
            </label>
            <p className="watchface-convert-detail">{target.display === "mip"
              ? "MIP keeps Current visible at all times. Your separate Always-on design is retained for switching back to AMOLED. Colors and fine detail may look different on the watch."
              : "Current and Always-on remain separate. If your face has no Always-on layout, one is created from Current for you to edit."}</p>
            <p className="watchface-convert-detail">{target.previewSize} × {target.previewSize} preview{target.model === "apex-4" ? " · Includes 42 mm and 46 mm sizes" : ""}. First use downloads device support from COROS.</p>
            {error ? <p role="alert">{error}</p> : null}
            <div className="watchface-modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => onConvert(model)}>
                {busy ? <Loader2 className="spin" size={16} /> : <Repeat2 size={16} />}
                {busy ? "Converting…" : `Convert to ${target.label}`}
              </button>
            </div>
          </>
        )}
      </div>
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
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    : "Watch-face request failed.";
}
