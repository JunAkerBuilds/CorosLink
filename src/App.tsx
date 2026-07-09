import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BatteryFull,
  CheckCircle2,
  Download,
  ExternalLink,
  Feather,
  FolderOpen,
  HardDrive,
  Home,
  Link,
  ListMusic,
  LogIn,
  LogOut,
  Loader2,
  Music,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Watch,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DownloadJob,
  DownloadQueueItem,
  LocalTrack,
  SpotifyConfig,
  SpotifyPlaylist,
  SpotifyPlaylistTrack,
  SpotifyStatus,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubAnalytics,
  TrainingHubDailyHealthSummary,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubSleepSummary,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout,
  WatchStatus,
  WatchTrack,
  AppUpdateSnapshot,
  YouTubeMusicPlaylist,
  YouTubeMusicSong,
  YouTubeMusicStatus,
  AppleMusicPlaylist,
  AppleMusicStatus,
  AppleMusicTrack,
} from "../electron/types";
import { TRAINING_HUB_EXPORT_FORMATS } from "../electron/types";
import { buildTrainingHubSnapshot } from "./training/parsers";
import { fetchTrainingDashboard, fetchUpcomingWorkouts } from "./training/api";
import { TRAINING_HEATMAP_DAYS } from "./training/chartConfig";
import { recentTrainingHubDateList } from "./training/formatters";
import { TrainingHubView } from "./training/TrainingHubView";
import type { TrainingHubSnapshot } from "./training/types";
import type { CorosLinkApi } from "./coroslink-api";
import { AppUpdateControls } from "./components/AppUpdateControls";
import {
  AppSidebar,
  createInitialSidebarExpanded,
} from "./components/AppSidebar";
import { ResourcesMenu } from "./components/ResourcesMenu";
import { StartupViewMenu } from "./components/StartupViewMenu";
import { ThemeToggle } from "./theme/ThemeToggle";
import { WatchConnectionSmokeControls } from "./components/WatchConnectionSmokeControls";
import type { PrimaryView } from "./navigation/primaryNav";
import {
  getPrimaryViewLabel,
  readStartupView,
  saveStartupView,
} from "./navigation/startupView";
import { MapsView } from "./maps/MapsView";
import { CalendarView } from "./calendar/CalendarView";
import { DataView } from "./data/DataView";
import { ChatView } from "./chat/ChatView";
import {
  LibrarySyncLayout,
  LocalLibraryPanel,
  WatchLibraryPanel,
} from "./media/LibraryPanels";
import {
  countPendingTransfers,
  isLocalTrackOnWatch,
} from "./media/libraryUtils";
import { trackAvatarColor, trackInitial } from "./media/trackAvatar";
import { useTimeOfDayGreeting } from "./hooks/useTimeOfDayGreeting";
import {
  getWatchPresentation,
  type WatchFeatureIcon,
  type WatchPresentation,
} from "./watchModels";
import appLogo from "../build/icon.png";

type View = PrimaryView;
type MediaTab =
  | "library"
  | "youtube"
  | "youtube-music"
  | "spotify"
  | "apple-music";

const YOUTUBE_HOME_URL = "https://www.youtube.com/";
const YOUTUBE_DOWNLOAD_CONSOLE_PREFIX = "__COROSLINK_YOUTUBE_DOWNLOAD__";
const APPLE_MUSIC_SELECTED_PLAYLIST_STORAGE_KEY =
  "coroslink.appleMusic.selectedPlaylistId";

let appleMusicSelectedPlaylistIdMemory = "";
let appleMusicDetailCacheMemory: Record<string, AppleMusicPlaylist> = {};

interface YouTubeDownloadItem {
  url: string;
  title?: string;
}

export default function App() {
  const api: CorosLinkApi | undefined = window.corosLink;
  const [activeView, setActiveView] = useState<View>(readStartupView);
  const [startupView, setStartupView] = useState<View>(readStartupView);
  const [sidebarExpanded, setSidebarExpanded] = useState(
    createInitialSidebarExpanded,
  );
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(max-width: 720px)").matches;
  });
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachPrefill, setCoachPrefill] = useState<string | null>(null);
  const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
  const [activeMediaTab, setActiveMediaTab] = useState<MediaTab>("library");
  const [watchStatus, setWatchStatus] = useState<WatchStatus | null>(null);
  const [downloads, setDownloads] = useState<LocalTrack[]>([]);
  const [spotifyConfig, setSpotifyConfig] = useState<SpotifyConfig>({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
  });
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(
    null,
  );
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>(
    [],
  );
  const [selectedSpotifyPlaylistId, setSelectedSpotifyPlaylistId] =
    useState<string>("");
  const [spotifyTracks, setSpotifyTracks] = useState<SpotifyPlaylistTrack[]>(
    [],
  );
  const [youtubeUrl, setYoutubeUrl] = useState(YOUTUBE_HOME_URL);
  const [youtubeInput, setYoutubeInput] = useState("");
  const [youtubeCurrentUrl, setYoutubeCurrentUrl] = useState(YOUTUBE_HOME_URL);
  const [youtubeTitle, setYoutubeTitle] = useState("YouTube");
  const [youtubeJobs, setYoutubeJobs] = useState<DownloadJob[]>([]);
  const [youtubeMusicStatus, setYoutubeMusicStatus] =
    useState<YouTubeMusicStatus | null>(null);
  const [youtubeMusicPlaylists, setYoutubeMusicPlaylists] = useState<
    YouTubeMusicPlaylist[]
  >([]);
  const [selectedYouTubeMusicPlaylistId, setSelectedYouTubeMusicPlaylistId] =
    useState("");
  const [youtubeMusicHeadersRaw, setYoutubeMusicHeadersRaw] = useState("");
  const completedJobIdsRef = useRef<Set<string>>(new Set());
  const mcpAutoConnectAttemptedRef = useRef(false);
  const [trainingHubStatus, setTrainingHubStatus] =
    useState<TrainingHubStatus | null>(null);
  const [trainingHubEmail, setTrainingHubEmail] = useState("");
  const [trainingHubPassword, setTrainingHubPassword] = useState("");
  const [trainingHubRemember, setTrainingHubRemember] = useState(true);
  const [trainingHubActivities, setTrainingHubActivities] = useState<
    TrainingHubActivity[]
  >([]);
  const [trainingHubAnalytics, setTrainingHubAnalytics] =
    useState<TrainingHubAnalytics | null>(null);
  const [trainingHubDashboard, setTrainingHubDashboard] =
    useState<TrainingHubDashboard | null>(null);
  const [trainingHubDailyMetrics, setTrainingHubDailyMetrics] =
    useState<TrainingHubDailyMetrics | null>(null);
  const [trainingHubSportTypes, setTrainingHubSportTypes] = useState<
    TrainingHubSportType[]
  >([]);
  const [trainingHubUpcomingWorkouts, setTrainingHubUpcomingWorkouts] =
    useState<TrainingHubUpcomingWorkout[]>([]);
  const [trainingHubActivityDetail, setTrainingHubActivityDetail] =
    useState<TrainingHubActivityDetail | null>(null);
  const [selectedTrainingHubActivity, setSelectedTrainingHubActivity] =
    useState<TrainingHubActivity | null>(null);
  const [trainingHubSleepData, setTrainingHubSleepData] =
    useState<TrainingHubSleepSummary | null>(null);
  const [trainingHubDailyHealthData, setTrainingHubDailyHealthData] =
    useState<TrainingHubDailyHealthSummary | null>(null);
  const [sleepConnecting, setSleepConnecting] = useState(false);
  const [url, setUrl] = useState("");
  const [autoTransfer, setAutoTransfer] = useState(true);
  const autoTransferRef = useRef(autoTransfer);
  const watchConnectedRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<string[]>([]);
  const [appUpdateSnapshot, setAppUpdateSnapshot] = useState<AppUpdateSnapshot>(
    {
      supported: false,
      currentVersion: "0.0.0",
      status: "idle",
      autoCheck: true,
      autoDownload: true,
    },
  );

  useEffect(() => {
    if (!api) {
      return;
    }

    void api.getAppUpdateStatus().then(setAppUpdateSnapshot);
    return api.onAppUpdateStatus(setAppUpdateSnapshot);
  }, [api]);

  // Tag the document with the host OS so the header can clear the macOS
  // traffic lights that overlay it.
  useEffect(() => {
    document.documentElement.dataset.platform = api?.platform ?? "";
  }, [api]);

  useEffect(() => {
    if (!api?.onWindowFullscreenChange) {
      return;
    }

    const syncFullscreen = (fullscreen: boolean) => {
      if (fullscreen) {
        document.documentElement.dataset.windowFullscreen = "true";
      } else {
        delete document.documentElement.dataset.windowFullscreen;
      }
    };

    void api.isWindowFullscreen?.().then(syncFullscreen);
    return api.onWindowFullscreenChange(syncFullscreen);
  }, [api]);

  useEffect(() => {
    autoTransferRef.current = autoTransfer;
  }, [autoTransfer]);

  useEffect(() => {
    watchConnectedRef.current = Boolean(watchStatus?.connected);
  }, [watchStatus?.connected]);

  const refreshAll = useCallback(async () => {
    if (!api) {
      return;
    }

    try {
      const [watch, localDownloads] = await Promise.all([
        api.getWatchStatus(),
        api.listDownloads(),
      ]);
      setWatchStatus(watch);
      setDownloads(localDownloads);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }, [api]);

  const refreshSpotify = useCallback(async () => {
    if (!api) {
      return;
    }

    const [config, status] = await Promise.all([
      api.getSpotifyConfig(),
      api.getSpotifyStatus(),
    ]);
    setSpotifyConfig(config);
    setSpotifyStatus(status);

    if (status.authenticated) {
      const playlists = await api.listSpotifyPlaylists();
      setSpotifyPlaylists(playlists);
      setSelectedSpotifyPlaylistId(
        (current) => current || playlists[0]?.id || "",
      );
    } else {
      setSpotifyPlaylists([]);
      setSelectedSpotifyPlaylistId("");
      setSpotifyTracks([]);
    }
  }, [api]);

  const refreshYouTubeMusic = useCallback(async () => {
    if (!api) {
      return;
    }

    const [status, library] = await Promise.all([
      api.getYouTubeMusicStatus(),
      api.listYouTubeMusicLibrary(),
    ]);
    setYoutubeMusicStatus(status);
    setYoutubeMusicPlaylists(library.playlists);
    setSelectedYouTubeMusicPlaylistId(
      (current) => current || library.playlists[0]?.id || "",
    );
  }, [api]);

  const clearTrainingHubData = useCallback(() => {
    setTrainingHubActivities([]);
    setTrainingHubAnalytics(null);
    setTrainingHubDashboard(null);
    setTrainingHubDailyMetrics(null);
    setTrainingHubSportTypes([]);
    setTrainingHubUpcomingWorkouts([]);
    setTrainingHubActivityDetail(null);
    setSelectedTrainingHubActivity(null);
    setTrainingHubSleepData(null);
    setTrainingHubDailyHealthData(null);
  }, []);

  const loadTrainingHubData = useCallback(async () => {
    if (!api) {
      return;
    }

    const dateList = recentTrainingHubDateList(TRAINING_HEATMAP_DAYS);
    const [
      activitiesResult,
      analyticsResult,
      dashboardResult,
      dailyResult,
      sportTypesResult,
      upcomingResult,
      sleepResult,
      dailyHealthResult,
    ] = await Promise.allSettled([
      api.listTrainingHubActivities(1, 50),
      api.getTrainingAnalytics(),
      fetchTrainingDashboard(api),
      api.getDailyMetrics(dateList),
      api.getSportTypeMap(),
      fetchUpcomingWorkouts(api, 14),
      api.getTrainingSleepData(14),
      api.getTrainingDailyHealthData(1),
    ]);

    if (activitiesResult.status === "fulfilled") {
      setTrainingHubActivities(activitiesResult.value);
    } else {
      setTrainingHubActivities([]);
    }

    setTrainingHubAnalytics(
      analyticsResult.status === "fulfilled" ? analyticsResult.value : null,
    );
    setTrainingHubDashboard(
      dashboardResult.status === "fulfilled" ? dashboardResult.value : null,
    );
    setTrainingHubDailyMetrics(
      dailyResult.status === "fulfilled" ? dailyResult.value : null,
    );
    setTrainingHubSportTypes(
      sportTypesResult.status === "fulfilled" ? sportTypesResult.value : [],
    );
    setTrainingHubUpcomingWorkouts(
      upcomingResult.status === "fulfilled" ? upcomingResult.value : [],
    );
    setTrainingHubSleepData(
      sleepResult.status === "fulfilled" ? sleepResult.value : null,
    );
    setTrainingHubDailyHealthData(
      dailyHealthResult.status === "fulfilled" ? dailyHealthResult.value : null,
    );

    const failures = [
      activitiesResult,
      analyticsResult,
      dashboardResult,
      dailyResult,
      sportTypesResult,
      upcomingResult,
    ]
      .filter((result) => result.status === "rejected")
      .map((result) => toErrorMessage(result.reason));

    const allFailed = [
      activitiesResult,
      analyticsResult,
      dashboardResult,
      dailyResult,
      sportTypesResult,
      upcomingResult,
    ].every((result) => result.status === "rejected");

    if (allFailed) {
      throw new Error(failures[0] ?? "Training Hub data could not be loaded.");
    }
  }, [api]);

  const ensureTrainingHubMcp = useCallback(async () => {
    if (!api || mcpAutoConnectAttemptedRef.current) {
      return;
    }

    const mcpStatus = await api.getCorosMcpStatus();
    if (mcpStatus.connected && mcpStatus.authorized) {
      return;
    }

    mcpAutoConnectAttemptedRef.current = true;
    setSleepConnecting(true);

    try {
      await api.connectCorosMcp();
    } catch {
      // Sleep panel degrades gracefully when MCP is unavailable.
    } finally {
      setSleepConnecting(false);
    }
  }, [api]);

  const refreshTrainingHub = useCallback(async () => {
    if (!api) {
      return;
    }

    const status = await api.getTrainingHubStatus();
    setTrainingHubStatus(status);

    if (status.email) {
      setTrainingHubEmail(status.email);
    }
    setTrainingHubRemember(status.rememberCredentials ?? true);

    if (status.authenticated) {
      await ensureTrainingHubMcp();
      await loadTrainingHubData();
    } else {
      clearTrainingHubData();
    }
  }, [
    api,
    clearTrainingHubData,
    ensureTrainingHubMcp,
    loadTrainingHubData,
  ]);

  const handleTrainingHubActivityDetail = useCallback(
    async (activity: TrainingHubActivity) => {
      if (!api) {
        return;
      }

      setBusy(`training-detail:${activity.activityId}`);
      setError(null);
      setMessage(null);
      setSelectedTrainingHubActivity(activity);

      try {
        setTrainingHubActivityDetail(
          await api.getTrainingHubActivityDetail(
            activity.activityId,
            activity.sportType,
            activity,
          ),
        );
      } catch (caught) {
        setError(toErrorMessage(caught));
      } finally {
        setBusy(null);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!api || trainingHubActivities.length === 0) {
      return;
    }

    const selectedId = selectedTrainingHubActivity?.activityId;
    if (
      selectedId &&
      trainingHubActivities.some(
        (activity) => activity.activityId === selectedId,
      )
    ) {
      return;
    }

    void handleTrainingHubActivityDetail(trainingHubActivities[0]);
  }, [
    api,
    trainingHubActivities,
    selectedTrainingHubActivity?.activityId,
    handleTrainingHubActivityDetail,
  ]);

  useEffect(() => {
    if (!api) {
      return;
    }

    void refreshAll();
    void refreshSpotify().catch((caught) => {
      setError(toErrorMessage(caught));
    });
    void refreshYouTubeMusic().catch((caught) => {
      setError(toErrorMessage(caught));
    });
    void refreshTrainingHub().catch((caught) => {
      setError(toErrorMessage(caught));
    });

    const interval = window.setInterval(() => {
      void refreshAll();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [
    api,
    refreshAll,
    refreshSpotify,
    refreshTrainingHub,
    refreshYouTubeMusic,
  ]);

  // The main process lifts credentials out of the embedded music.youtube.com
  // session and notifies us once ytmusicapi has stored them (or if that failed).
  useEffect(() => {
    if (!api) {
      return;
    }
    return api.onYouTubeMusicAuthCaptured((result) => {
      if (!result.status) {
        setError(result.error);
        return;
      }
      setYoutubeMusicStatus(result.status);
      setMessage("YouTube Music connected.");
      void refreshYouTubeMusic().catch((caught) =>
        setError(toErrorMessage(caught)),
      );
    });
  }, [api, refreshYouTubeMusic]);

  useEffect(() => {
    if (!api) {
      return;
    }

    void api
      .listYouTubeJobs()
      .then((jobs: DownloadJob[]) => {
        for (const job of jobs) {
          if (job.status === "completed") {
            completedJobIdsRef.current.add(job.id);
          }
        }
        setYoutubeJobs(jobs);
      })
      .catch(() => undefined);

    return api.onYouTubeJobsUpdate((jobs: DownloadJob[]) => {
      const newlyCompleted = jobs.filter(
        (job) =>
          job.status === "completed" && !completedJobIdsRef.current.has(job.id),
      );
      const hasNewlyCompleted = newlyCompleted.length > 0;

      for (const job of jobs) {
        if (job.status === "completed") {
          completedJobIdsRef.current.add(job.id);
        }
      }

      setYoutubeJobs(jobs);

      if (hasNewlyCompleted) {
        void refreshAll();

        if (autoTransferRef.current && watchConnectedRef.current && api) {
          void (async () => {
            let transferred = 0;
            for (const job of newlyCompleted) {
              for (const track of job.tracks) {
                await api.transferLocalTrack(track.id);
                transferred += 1;
              }
            }

            if (transferred > 0) {
              setMessage(`${transferred} track(s) downloaded and transferred.`);
              await refreshAll();
            }
          })();
        }
      }
    });
  }, [api, refreshAll]);

  useEffect(() => {
    if (!api || !selectedSpotifyPlaylistId || !spotifyStatus?.authenticated) {
      return;
    }

    void loadSpotifyPlaylist(selectedSpotifyPlaylistId);
  }, [api, selectedSpotifyPlaylistId, spotifyStatus?.authenticated]);

  const storage = useMemo(() => {
    if (!watchStatus?.connected) {
      return null;
    }

    const trackBytes =
      watchStatus.tracks.reduce((total, track) => total + track.sizeBytes, 0) ??
      0;
    const presentation = getWatchPresentation(watchStatus);
    const totalBytes =
      watchStatus.totalBytes ?? presentation.fallbackBytes ?? 0;

    if (totalBytes <= 0) {
      return null;
    }

    const usedBytes = watchStatus.usedBytes ?? trackBytes;
    return {
      totalBytes,
      usedBytes,
      freeBytes: watchStatus.freeBytes,
      percent: Math.min(100, Math.round((usedBytes / totalBytes) * 100)),
      capacityLabel: presentation.capacityLabel ?? "Storage unavailable",
    };
  }, [watchStatus]);

  async function handleRefresh() {
    setBusy("refresh");
    setError(null);
    try {
      await Promise.all([
        refreshAll(),
        refreshSpotify(),
        refreshTrainingHub(),
        refreshYouTubeMusic(),
      ]);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleCheckForUpdates() {
    if (!api) {
      return;
    }

    setBusy("update-check");
    setError(null);
    try {
      const snapshot = await api.checkForAppUpdates();
      setAppUpdateSnapshot(snapshot);

      if (snapshot.status === "not-available") {
        setMessage("You're on the latest version.");
      } else if (snapshot.status === "error") {
        setError(snapshot.error ?? "Could not check for updates.");
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleInstallUpdate() {
    void api
      ?.quitAndInstallUpdate()
      .then((result) => {
        if (result?.installMethod === "manual") {
          setMessage(
            "Opened the GitHub download page. Install the new build over CorosLink in Applications.",
          );
        }
      })
      .catch((caught) => {
        setError(toErrorMessage(caught));
      });
  }

  async function handleDownloadUpdate() {
    if (!api) {
      return;
    }

    setBusy("update-download");
    setError(null);
    try {
      const snapshot = await api.downloadAppUpdate();
      setAppUpdateSnapshot(snapshot);

      if (snapshot.status === "error") {
        setError(snapshot.error ?? "Could not download the update.");
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdatePreferencesChange(prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }) {
    if (!api) {
      return;
    }

    try {
      const snapshot = await api.setUpdatePreferences(prefs);
      setAppUpdateSnapshot(snapshot);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function loadSpotifyPlaylist(playlistId: string) {
    if (!api) {
      return;
    }

    setBusy(`spotify-load:${playlistId}`);
    setError(null);

    try {
      const tracks = await api.listSpotifyPlaylistTracks(playlistId);
      setSpotifyTracks(tracks);
    } catch (caught) {
      setError(toErrorMessage(caught));
      setSpotifyTracks([]);
    } finally {
      setBusy(null);
    }
  }

  async function handleSpotifyConfigSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api) {
      return;
    }

    setBusy("spotify-config");
    setError(null);
    setMessage(null);

    try {
      const status = await api.saveSpotifyConfig(spotifyConfig);
      setSpotifyStatus(status);
      setMessage("Spotify settings saved.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleYouTubeMusicAuthSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!api) {
      return;
    }

    setBusy("youtube-music-auth");
    setError(null);
    setMessage(null);

    try {
      const status = await api.saveYouTubeMusicAuth(youtubeMusicHeadersRaw);
      setYoutubeMusicStatus(status);
      setYoutubeMusicHeadersRaw("");
      setMessage("YouTube Music headers saved.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSpotifyLogin() {
    if (!api) {
      return;
    }

    setBusy("spotify-login");
    setError(null);
    setMessage(null);

    try {
      const status = await api.loginSpotify();
      setSpotifyStatus(status);
      setMessage("Spotify account connected.");
      await refreshSpotify();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSpotifyLogout() {
    if (!api) {
      return;
    }

    setBusy("spotify-logout");
    setError(null);
    setMessage(null);

    try {
      setSpotifyStatus(await api.logoutSpotify());
      setSpotifyPlaylists([]);
      setSpotifyTracks([]);
      setSelectedSpotifyPlaylistId("");
      setMessage("Spotify account disconnected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleYouTubeMusicLogout() {
    if (!api) {
      return;
    }

    setBusy("youtube-music-logout");
    setError(null);
    setMessage(null);

    try {
      // Clear the stored credentials *and* the persisted browser session so the
      // webview doesn't stay signed in and silently reconnect.
      const [status] = await Promise.all([
        api.logoutYouTubeMusic(),
        api.resetYouTubeMusicBrowserSession(),
      ]);
      setYoutubeMusicStatus(status);
      setYoutubeMusicPlaylists([]);
      setSelectedYouTubeMusicPlaylistId("");
      setMessage("YouTube Music disconnected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSyncYouTubeMusicLibrary() {
    if (!api) {
      return;
    }

    setBusy("youtube-music-sync");
    setError(null);
    setMessage(null);

    try {
      const result = await api.syncYouTubeMusicLibrary();
      setYoutubeMusicStatus(result.status);
      setYoutubeMusicPlaylists(result.playlists);
      setSelectedYouTubeMusicPlaylistId(
        (current) => current || result.playlists[0]?.id || "",
      );
      setMessage(
        `Synced ${result.songs.length} song(s) and ${result.playlists.length} playlist(s) from YouTube Music.`,
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleQueueYouTubeMusicSong(song: YouTubeMusicSong) {
    if (!song.videoUrl) {
      setError("This YouTube Music song did not include a video URL.");
      return;
    }

    await handleYouTubeDownload({
      url: song.videoUrl,
      title: [song.artistName, song.songTitle].filter(Boolean).join(" - "),
    });
  }

  async function handleRetryYouTubeMusicSong(
    song: YouTubeMusicSong,
    jobId: string,
  ) {
    if (!api) {
      return;
    }

    try {
      setYoutubeJobs(await api.clearYouTubeJob(jobId));
    } catch {
      // The job may already be gone; re-queue regardless.
    }

    await handleQueueYouTubeMusicSong(song);
  }

  async function handleQueueYouTubeMusicPlaylist(
    playlist: YouTubeMusicPlaylist,
  ) {
    const queue = playlist.songs
      .filter((song) => song.videoUrl)
      .map((song) => ({
        url: song.videoUrl as string,
        title: [song.artistName, song.songTitle].filter(Boolean).join(" - "),
      }));

    if (queue.length === 0) {
      setError("This YouTube Music playlist did not include video URLs.");
      return;
    }

    await handleYouTubeDownload(queue);
  }

  function handleOpenYouTubeMusicSong(song: YouTubeMusicSong) {
    if (!song.videoUrl) {
      setError("This YouTube Music song did not include a video URL.");
      return;
    }

    setYoutubeUrl(song.videoUrl);
    setYoutubeInput(song.videoUrl);
    openMediaTab("youtube");
  }

  async function handleTrainingHubLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api) {
      return;
    }

    setBusy("training-login");
    setError(null);
    setMessage(null);

    try {
      const status = await api.loginTrainingHub(
        trainingHubEmail,
        trainingHubPassword,
        trainingHubRemember,
      );
      setTrainingHubStatus(status);
      setTrainingHubPassword("");
      setMessage("COROS Training Hub connected.");
      await loadTrainingHubData();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setTrainingHubPassword("");
      setBusy(null);
    }
  }

  async function handleTrainingHubReconnect() {
    if (!api) {
      return;
    }

    setBusy("training-reconnect");
    setError(null);
    setMessage(null);

    try {
      const status = await api.reconnectTrainingHub();
      setTrainingHubStatus(status);
      setMessage("COROS Training Hub reconnected.");
      await loadTrainingHubData();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainingHubLogout() {
    if (!api) {
      return;
    }

    setBusy("training-logout");
    setError(null);
    setMessage(null);

    try {
      setTrainingHubStatus(await api.logoutTrainingHub());
      clearTrainingHubData();
      setMessage("COROS Training Hub disconnected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainingHubRefresh() {
    setBusy("training-refresh");
    setError(null);
    setMessage(null);

    try {
      await refreshTrainingHub();
      setMessage("COROS Training Hub data refreshed.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainingHubExport(
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType,
  ) {
    if (!api) {
      return;
    }

    const format = TRAINING_HUB_EXPORT_FORMATS.find(
      (item) => item.fileType === fileType,
    );

    setBusy(`training-file:${activity.activityId}:${fileType}`);
    setError(null);
    setMessage(null);

    try {
      const result = await api.exportTrainingHubActivityFile(
        activity.activityId,
        activity.sportType,
        fileType,
        activity.name,
      );

      if (result.saved) {
        setMessage(
          `Saved ${format?.label ?? "activity"} file to ${result.filePath}.`,
        );
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
      const status = await api.getTrainingHubStatus();
      setTrainingHubStatus(status);
      if (!status.authenticated) {
        clearTrainingHubData();
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api) {
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const jobs = await api.enqueueYouTubeDownloads([{ url: trimmedUrl }]);
      if (jobs.length === 0) {
        setMessage("That download is already queued.");
        return;
      }

      setUrl("");
      setMessage(
        autoTransfer && watchStatus?.connected
          ? "Download queued. Tracks will auto-transfer when ready."
          : "Download queued.",
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handleYouTubeVisit(visitUrl: string, title?: string) {
    if (!api || !isYouTubeUrl(visitUrl)) {
      return;
    }

    try {
      await api.recordYouTubeVisit(visitUrl, title);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handleYouTubeDownload(
    items: YouTubeDownloadItem | YouTubeDownloadItem[],
  ) {
    if (!api) {
      return;
    }

    const queue = (Array.isArray(items) ? items : [items]).filter((item) =>
      item.url.trim(),
    );

    if (queue.length === 0) {
      return;
    }

    if (typeof api.enqueueYouTubeDownloads !== "function") {
      setError(
        "Background downloads aren't loaded yet. Fully quit and restart the app — the Electron process needs a restart to pick up the new download queue.",
      );
      return;
    }

    setError(null);

    try {
      const jobs = await api.enqueueYouTubeDownloads(queue);
      if (jobs.length === 0) {
        setMessage("Those downloads are already queued.");
        return;
      }
      setMessage(
        `Queued ${jobs.length} download${jobs.length === 1 ? "" : "s"}. Keep browsing — they run in the background.`,
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handleCancelYouTubeJob(id: string) {
    if (!api) {
      return;
    }

    try {
      setYoutubeJobs(await api.cancelYouTubeJob(id));
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handleClearYouTubeJob(id: string) {
    if (!api) {
      return;
    }

    try {
      setYoutubeJobs(await api.clearYouTubeJob(id));
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handleClearCompletedYouTubeJobs() {
    if (!api) {
      return;
    }

    try {
      setYoutubeJobs(await api.clearCompletedYouTubeJobs());
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handleTransfer(id: string) {
    if (!api) {
      return;
    }

    setBusy(`transfer:${id}`);
    setError(null);
    setMessage(null);

    try {
      await api.transferLocalTrack(id);
      setMessage("Track transferred to the watch.");
      await refreshAll();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleTransferAll() {
    if (!api) {
      return;
    }

    const watchConnected = Boolean(watchStatus?.connected);
    const watchTracks = watchStatus?.tracks ?? [];
    const pending = downloads.filter(
      (track) => !isLocalTrackOnWatch(track, watchTracks, watchConnected),
    );
    if (pending.length === 0) {
      return;
    }

    setBusy("transfer-all");
    setError(null);
    setMessage(null);

    try {
      for (const track of pending) {
        await api.transferLocalTrack(track.id);
      }
      setMessage(`${pending.length} track(s) transferred to the watch.`);
      await refreshAll();
    } catch (caught) {
      setError(toErrorMessage(caught));
      await refreshAll();
    } finally {
      setBusy(null);
    }
  }

  async function handleTransferDownloads(tracks: LocalTrack[]) {
    if (!api || tracks.length === 0) {
      return;
    }

    if (!watchStatus?.connected) {
      setError("Connect your watch before transferring tracks.");
      return;
    }

    const watchTracks = watchStatus.tracks ?? [];
    const pending = tracks.filter(
      (track) => !isLocalTrackOnWatch(track, watchTracks, true),
    );
    if (pending.length === 0) {
      return;
    }

    setBusy("transfer-selected");
    setError(null);
    setMessage(null);

    try {
      for (const track of pending) {
        await api.transferLocalTrack(track.id);
      }
      setMessage(
        pending.length === 1
          ? "Track transferred to the watch."
          : `${pending.length} selected tracks transferred to the watch.`,
      );
      await refreshAll();
    } catch (caught) {
      setError(toErrorMessage(caught));
      await refreshAll();
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteWatchTrack(track: WatchTrack) {
    if (!api || !window.confirm(`Delete "${track.name}" from the watch?`)) {
      return;
    }

    setBusy(`delete-watch:${track.relativePath}`);
    setError(null);
    setMessage(null);

    try {
      await api.deleteWatchTrack(track.relativePath);
      await refreshAll();
      setMessage("Track deleted from the watch.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteWatchTracks(tracks: WatchTrack[]) {
    if (!api || tracks.length === 0) {
      return;
    }

    const prompt =
      tracks.length === 1
        ? `Delete "${tracks[0].name}" from the watch?`
        : `Delete ${tracks.length} tracks from the watch?`;

    if (!window.confirm(prompt)) {
      return;
    }

    setBusy("delete-watch-bulk");
    setError(null);
    setMessage(null);

    try {
      for (const track of tracks) {
        await api.deleteWatchTrack(track.relativePath);
      }

      await refreshAll();
      setMessage(
        tracks.length === 1
          ? "Track deleted from the watch."
          : `${tracks.length} tracks deleted from the watch.`,
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteDownload(track: LocalTrack) {
    if (!api || !window.confirm(`Delete "${track.title}" locally?`)) {
      return;
    }

    setBusy(`delete-local:${track.id}`);
    setError(null);
    setMessage(null);

    try {
      setDownloads(await api.deleteDownload(track.id, true));
      setMessage("Local track deleted.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteDownloads(tracks: LocalTrack[]) {
    if (!api || tracks.length === 0) {
      return;
    }

    const prompt =
      tracks.length === 1
        ? `Delete "${tracks[0].title}" locally?`
        : `Delete ${tracks.length} tracks locally?`;

    if (!window.confirm(prompt)) {
      return;
    }

    setBusy("delete-local-bulk");
    setError(null);
    setMessage(null);

    try {
      let nextDownloads = downloads;

      for (const track of tracks) {
        nextDownloads = await api.deleteDownload(track.id, true);
      }

      setDownloads(nextDownloads);
      setMessage(
        tracks.length === 1
          ? "Local track deleted."
          : `${tracks.length} tracks deleted.`,
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const isOverviewDashboard = activeView === "overview";
  const trainingHubSnapshot = useMemo<TrainingHubSnapshot | null>(() => {
    if (
      !trainingHubAnalytics &&
      !trainingHubDashboard &&
      !trainingHubDailyMetrics
    ) {
      return null;
    }

    return buildTrainingHubSnapshot(
      trainingHubAnalytics,
      trainingHubDashboard,
      trainingHubDailyMetrics,
      trainingHubSleepData,
      trainingHubDailyHealthData,
    );
  }, [
    trainingHubAnalytics,
    trainingHubDashboard,
    trainingHubDailyMetrics,
    trainingHubSleepData,
    trainingHubDailyHealthData,
  ]);

  function openMediaTab(tab: MediaTab) {
    setActiveView("media");
    setActiveMediaTab(tab);
  }

  function handleStartupViewChange(view: View) {
    setStartupView(view);
    saveStartupView(view);
    setMessage(
      `Startup view set to ${getPrimaryViewLabel(view)}. It will open on next launch.`,
    );
  }

  const { toasts, dismissToast } = useToaster(
    message,
    error ?? watchStatus?.error ?? null,
  );

  return (
    <div className="app">
      <header className="app-header app-header--slim">
        <div className="app-header-end">
          <ThemeToggle />
          <StartupViewMenu
            value={startupView}
            onChange={handleStartupViewChange}
          />
          <ResourcesMenu />
          <AppUpdateControls
            snapshot={appUpdateSnapshot}
            busy={busy === "update-check"}
            downloading={busy === "update-download"}
            onCheck={() => void handleCheckForUpdates()}
            onDownload={() => void handleDownloadUpdate()}
            onInstall={handleInstallUpdate}
            onPreferencesChange={handleUpdatePreferencesChange}
          />
          <WatchConnectionSmokeControls
            api={api}
            onWatchStatusChange={setWatchStatus}
            onError={setError}
          />
          <div
            className={`watch-status-chip${watchStatus?.connected ? " connected" : ""}`}
            title={watchStatus?.rootPath ?? "No watch volume found"}
          >
            <StatusDot connected={Boolean(watchStatus?.connected)} />
            <span>
              {watchStatus?.connected
                ? (watchStatus.name ?? "Connected")
                : "No watch"}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Refresh watch and library"
            onClick={handleRefresh}
            disabled={busy === "refresh" || !api}
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
              className={busy === "refresh" ? "spin" : ""}
            />
          </button>
        </div>
      </header>

      <div className="app-body">
        <AppSidebar
          activeView={activeView}
          onChange={setActiveView}
          coachBusy={coachBusy}
          appLogo={appLogo}
          expanded={sidebarExpanded}
          onExpandedChange={setSidebarExpanded}
          overlayOpen={sidebarOverlayOpen}
          onOverlayOpenChange={setSidebarOverlayOpen}
        />

        <main
          className={[
            "content",
            isOverviewDashboard && "content-overview",
            (activeView === "media" || activeView === "coach") && "content-fill",
          ]
            .filter(Boolean)
            .join(" ")}
        >
        {!api ? (
          <BridgeMissing />
        ) : (
          <>
            {activeView === "overview" ? (
              <MediaOverviewTab
                url={url}
                setUrl={setUrl}
                autoTransfer={autoTransfer}
                setAutoTransfer={setAutoTransfer}
                downloads={downloads}
                watchStatus={watchStatus}
                storage={storage}
                watchConnected={Boolean(watchStatus?.connected)}
                busy={busy}
                jobs={youtubeJobs}
                onDownload={handleDownload}
                onCancelJob={handleCancelYouTubeJob}
                onClearJob={handleClearYouTubeJob}
                onClearCompletedJobs={handleClearCompletedYouTubeJobs}
                onTransfer={handleTransfer}
                onDeleteDownload={handleDeleteDownload}
                onOpenLibrary={() => openMediaTab("library")}
                onOpenYouTube={() => openMediaTab("youtube")}
                onOpenSpotify={() => openMediaTab("spotify")}
              />
            ) : null}
            {activeView === "media" ? (
              <MediaView
                activeTab={activeMediaTab}
                onTabChange={setActiveMediaTab}
              >
                {activeMediaTab === "library" ? (
                  <MediaLibraryTab
                    downloads={downloads}
                    watchStatus={watchStatus}
                    watchConnected={Boolean(watchStatus?.connected)}
                    busy={busy}
                    lastOutput={lastOutput}
                    onTransfer={handleTransfer}
                    onTransferAll={handleTransferAll}
                    onTransferDownloads={handleTransferDownloads}
                    onDeleteDownload={handleDeleteDownload}
                    onDeleteDownloads={handleDeleteDownloads}
                    onDeleteWatchTrack={handleDeleteWatchTrack}
                    onDeleteWatchTracks={handleDeleteWatchTracks}
                  />
                ) : activeMediaTab === "youtube" ? (
                  <YouTubeBrowserView
                    browserUrl={youtubeUrl}
                    setBrowserUrl={setYoutubeUrl}
                    input={youtubeInput}
                    setInput={setYoutubeInput}
                    currentUrl={youtubeCurrentUrl}
                    setCurrentUrl={setYoutubeCurrentUrl}
                    title={youtubeTitle}
                    setTitle={setYoutubeTitle}
                    jobs={youtubeJobs}
                    onVisit={handleYouTubeVisit}
                    onDownload={handleYouTubeDownload}
                    onCancelJob={handleCancelYouTubeJob}
                    onClearJob={handleClearYouTubeJob}
                    onClearCompletedJobs={handleClearCompletedYouTubeJobs}
                  />
                ) : activeMediaTab === "youtube-music" ? (
                  <YouTubeMusicView
                    status={youtubeMusicStatus}
                    playlists={youtubeMusicPlaylists}
                    selectedPlaylistId={selectedYouTubeMusicPlaylistId}
                    headersRaw={youtubeMusicHeadersRaw}
                    busy={busy}
                    jobs={youtubeJobs}
                    onHeadersChange={setYoutubeMusicHeadersRaw}
                    onAuthSubmit={handleYouTubeMusicAuthSubmit}
                    onLogout={handleYouTubeMusicLogout}
                    onSync={handleSyncYouTubeMusicLibrary}
                    onSelectPlaylist={setSelectedYouTubeMusicPlaylistId}
                    onQueuePlaylist={handleQueueYouTubeMusicPlaylist}
                    onQueueSong={handleQueueYouTubeMusicSong}
                    onRetrySong={handleRetryYouTubeMusicSong}
                    onOpenSong={handleOpenYouTubeMusicSong}
                  />
                ) : activeMediaTab === "spotify" ? (
                  <SpotifySyncView
                    config={spotifyConfig}
                    status={spotifyStatus}
                    playlists={spotifyPlaylists}
                    selectedPlaylistId={selectedSpotifyPlaylistId}
                    tracks={spotifyTracks}
                    busy={busy}
                    onConfigChange={setSpotifyConfig}
                    onConfigSubmit={handleSpotifyConfigSubmit}
                    onLogin={handleSpotifyLogin}
                    onLogout={handleSpotifyLogout}
                    onSelectPlaylist={setSelectedSpotifyPlaylistId}
                    onRefresh={refreshSpotify}
                    onMessage={setMessage}
                    onError={setError}
                  />
                ) : (
                  <AppleMusicView onMessage={setMessage} onError={setError} />
                )}
              </MediaView>
            ) : null}
            {activeView === "maps" ? (
              <MapsView
                api={api}
                watchStatus={watchStatus}
                onWatchStatusChange={setWatchStatus}
                onMessage={setMessage}
                onError={setError}
              />
            ) : null}
            {activeView === "training" ? (
              <TrainingHubView
                api={api}
                status={trainingHubStatus}
                email={trainingHubEmail}
                password={trainingHubPassword}
                remember={trainingHubRemember}
                activities={trainingHubActivities}
                upcomingWorkouts={trainingHubUpcomingWorkouts}
                snapshot={trainingHubSnapshot}
                sportTypes={trainingHubSportTypes}
                activityDetail={trainingHubActivityDetail}
                selectedActivity={selectedTrainingHubActivity}
                busy={busy}
                sleepConnecting={sleepConnecting}
                onEmailChange={setTrainingHubEmail}
                onPasswordChange={setTrainingHubPassword}
                onRememberChange={setTrainingHubRemember}
                onLogin={handleTrainingHubLogin}
                onReconnect={handleTrainingHubReconnect}
                onLogout={handleTrainingHubLogout}
                onRefresh={handleTrainingHubRefresh}
                onLoadDetail={handleTrainingHubActivityDetail}
                onExportFile={handleTrainingHubExport}
              />
            ) : null}
            {activeView === "data" ? (
              <DataView
                api={api}
                status={trainingHubStatus}
                onOpenTraining={() => setActiveView("training")}
              />
            ) : null}
            {activeView === "calendar" ? (
              <CalendarView
                api={api}
                status={trainingHubStatus}
                sportTypes={trainingHubSportTypes}
                refreshToken={calendarRefreshToken}
                onMessage={setMessage}
                onError={setError}
                onOpenTraining={() => setActiveView("training")}
                onOpenCoach={(prompt) => {
                  setCoachPrefill(prompt);
                  setActiveView("coach");
                }}
              />
            ) : null}
            <div
              className={[
                "content-coach-panel",
                activeView !== "coach" && "view-panel-hidden",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-hidden={activeView !== "coach"}
            >
              <ChatView
                api={api}
                onError={setError}
                onPlanUploaded={() => {
                  void loadTrainingHubData();
                  setCalendarRefreshToken((token) => token + 1);
                }}
                onActivityChange={setCoachBusy}
                pendingPrompt={coachPrefill}
                onPendingPromptConsumed={() => setCoachPrefill(null)}
              />
            </div>
          </>
        )}
      </main>
      </div>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

interface MediaViewProps {
  activeTab: MediaTab;
  onTabChange: (tab: MediaTab) => void;
  children: ReactNode;
}

function MediaView({ activeTab, onTabChange, children }: MediaViewProps) {
  const tabs: Array<{ id: MediaTab; label: string; icon: ReactNode }> = [
    {
      id: "library",
      label: "Library",
      icon: <Music size={16} aria-hidden="true" />,
    },
    {
      id: "youtube",
      label: "YouTube Browser",
      icon: <Link size={16} aria-hidden="true" />,
    },
    {
      id: "youtube-music",
      label: "YouTube Music",
      icon: <YouTubeMusicBrandIcon size={16} />,
    },
    {
      id: "spotify",
      label: "Spotify",
      icon: <ListMusic size={16} aria-hidden="true" />,
    },
    {
      id: "apple-music",
      label: "Apple Music",
      icon: <AppleBrandIcon size={16} />,
    },
  ];

  return (
    <>
      <div className="media-tabs-shell">
        <nav className="media-tabs" aria-label="Media sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                activeTab === tab.id ? "media-tab active" : "media-tab"
              }
              onClick={() => onTabChange(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      {children}
    </>
  );
}

interface StorageRingProps {
  percent: number;
  usedBytes: number;
}

function StorageRing({ percent, usedBytes }: StorageRingProps) {
  const [isReady, setIsReady] = useState(false);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (percent / 100) * circumference;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`storage-ring${isReady ? " is-ready" : ""}`}
      aria-label={`${percent}% storage used`}
    >
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <circle className="storage-ring-track" cx="64" cy="64" r={radius} />
        <circle
          className="storage-ring-progress"
          cx="64"
          cy="64"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={isReady ? targetOffset : circumference}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="storage-ring-label">
        <strong>{percent}%</strong>
        <span>{formatBytes(usedBytes)} used</span>
      </div>
    </div>
  );
}

interface MetricTileProps {
  label: string;
  value: string | number;
  detail: string;
  icon?: ReactNode;
  onClick?: () => void;
}

function MetricTile({ label, value, detail, icon, onClick }: MetricTileProps) {
  const content = (
    <>
      {icon ? <div className="metric-tile-icon">{icon}</div> : null}
      <p className="eyebrow">{label}</p>
      <strong className="metric-value">{value}</strong>
      <span>{detail}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="metric-tile metric-tile-button"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <section className="metric-tile">{content}</section>;
}

const WATCH_FEATURE_ICONS: Record<
  WatchFeatureIcon,
  (props: { size?: number }) => ReactNode
> = {
  display: ({ size = 17 }) => <Sparkles size={size} aria-hidden="true" />,
  weight: ({ size = 17 }) => <Feather size={size} aria-hidden="true" />,
  battery: ({ size = 17 }) => <BatteryFull size={size} aria-hidden="true" />,
};

function ProductHero({ presentation }: { presentation: WatchPresentation }) {
  const productName = presentation.productName ?? presentation.displayName;

  return (
    <section className="dashboard-hero dashboard-hero--product panel">
      <div className="dashboard-hero-copy">
        <span className="dashboard-hero-brand">COROS</span>
        <h2 className="dashboard-hero-model">{productName}</h2>
        {presentation.tagline ? (
          <p className="dashboard-hero-tagline">{presentation.tagline}</p>
        ) : null}
        {presentation.features && presentation.features.length > 0 ? (
          <ul className="dashboard-hero-features">
            {presentation.features.map((feature) => {
              const Icon = WATCH_FEATURE_ICONS[feature.icon];
              return (
                <li key={feature.label}>
                  <span className="dashboard-hero-feature-icon">
                    <Icon size={16} />
                  </span>
                  {feature.label}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {presentation.heroImage ? (
        <img
          src={presentation.heroImage}
          alt={presentation.heroAlt ?? ""}
          className="dashboard-hero-image"
        />
      ) : null}
    </section>
  );
}

interface RecentTrackListProps {
  tracks: LocalTrack[];
  busy: string | null;
  watchConnected: boolean;
  onTransfer: (id: string) => void;
  onDeleteDownload: (track: LocalTrack) => void;
}

function RecentTrackList({
  tracks,
  busy,
  watchConnected,
  onTransfer,
  onDeleteDownload,
}: RecentTrackListProps) {
  if (tracks.length === 0) {
    return <EmptyState title="No recent downloads" />;
  }

  return (
    <div className="recent-list">
      {tracks.map((track) => (
        <div key={track.id} className="recent-row">
          <div
            className="track-avatar"
            style={{ backgroundColor: trackAvatarColor(track.title) }}
            aria-hidden="true"
          >
            {trackInitial(track.title)}
          </div>
          <div className="recent-row-info">
            <strong>{track.title}</strong>
            <span>
              {formatBytes(track.sizeBytes)} · {formatDate(track.createdAt)}
            </span>
          </div>
          <span className={track.transferredAt ? "badge ready" : "badge"}>
            {track.transferredAt ? "Synced" : "Local"}
          </span>
          <div className="row-actions">
            <button
              className="icon-button"
              type="button"
              title="Transfer to watch"
              disabled={!watchConnected || busy === `transfer:${track.id}`}
              onClick={() => onTransfer(track.id)}
            >
              {busy === `transfer:${track.id}` ? (
                <Loader2 className="spin" size={17} aria-hidden="true" />
              ) : (
                <Upload size={17} aria-hidden="true" />
              )}
            </button>
            <button
              className="icon-button danger"
              type="button"
              title="Delete local track"
              disabled={busy === `delete-local:${track.id}`}
              onClick={() => onDeleteDownload(track)}
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface MediaOverviewTabProps {
  url: string;
  setUrl: (value: string) => void;
  autoTransfer: boolean;
  setAutoTransfer: (value: boolean) => void;
  downloads: LocalTrack[];
  watchStatus: WatchStatus | null;
  storage: {
    totalBytes: number;
    usedBytes: number;
    freeBytes?: number;
    percent: number;
    capacityLabel: string;
  } | null;
  watchConnected: boolean;
  busy: string | null;
  jobs: DownloadJob[];
  onDownload: (event: FormEvent<HTMLFormElement>) => void;
  onCancelJob: (id: string) => void;
  onClearJob: (id: string) => void;
  onClearCompletedJobs: () => void;
  onTransfer: (id: string) => void;
  onDeleteDownload: (track: LocalTrack) => void;
  onOpenLibrary: () => void;
  onOpenYouTube: () => void;
  onOpenSpotify: () => void;
}

function MediaOverviewTab({
  url,
  setUrl,
  autoTransfer,
  setAutoTransfer,
  downloads,
  watchStatus,
  storage,
  watchConnected,
  busy,
  jobs,
  onDownload,
  onCancelJob,
  onClearJob,
  onClearCompletedJobs,
  onTransfer,
  onDeleteDownload,
  onOpenLibrary,
  onOpenYouTube,
  onOpenSpotify,
}: MediaOverviewTabProps) {
  const greeting = useTimeOfDayGreeting();
  const urlInputRef = useRef<HTMLInputElement>(null);
  const watchTracks = watchStatus?.tracks ?? [];
  const recentDownloads = useMemo(
    () =>
      [...downloads]
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        )
        .slice(0, 5),
    [downloads],
  );
  const transferredCount = useMemo(
    () =>
      downloads.filter((track) =>
        isLocalTrackOnWatch(track, watchTracks, watchConnected),
      ).length,
    [downloads, watchTracks, watchConnected],
  );
  const librarySize = useMemo(
    () => downloads.reduce((total, track) => total + track.sizeBytes, 0),
    [downloads],
  );
  const watchPresentation = getWatchPresentation(watchStatus);
  const statusTitle =
    watchPresentation.state === "disconnected"
      ? "Not connected"
      : watchPresentation.state === "connected-known"
        ? watchPresentation.displayName
        : (watchStatus?.name ?? "Connected");
  const showProductHero =
    watchPresentation.state === "connected-known" &&
    Boolean(watchPresentation.heroImage);

  return (
    <div className="dashboard">
      <header className="dashboard-welcome dashboard-block">
        <div>
          <h1 className="dashboard-greeting">{greeting}</h1>
          <p className="dashboard-subtitle">{watchPresentation.companion}</p>
        </div>
      </header>

      <div
        className={[
          "dashboard-hero-row",
          "dashboard-block",
          !showProductHero && "dashboard-hero-row--no-hero",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {showProductHero ? (
          <ProductHero presentation={watchPresentation} />
        ) : null}

        <section className="dashboard-status panel">
          <div className="dashboard-status-header">
            <div className="dashboard-status-lead">
              <div
                className={`watch-status-icon${watchConnected ? " connected" : ""}`}
                aria-hidden="true"
              >
                <Watch size={26} />
                <span className="watch-status-badge">
                  {watchConnected ? (
                    <CheckCircle2 size={13} strokeWidth={2.5} />
                  ) : (
                    <X size={12} strokeWidth={3} />
                  )}
                </span>
              </div>
              <div>
                <p className="eyebrow">Watch connection</p>
                <h2>{statusTitle}</h2>
                {!(watchConnected && storage) ? (
                  <p className="dashboard-status-hint">
                    {watchPresentation.connectHint}
                  </p>
                ) : null}
              </div>
            </div>
            <div
              className={`connection-pill${watchConnected ? " connected" : ""}`}
            >
              <StatusDot connected={watchConnected} />
              <span>{watchConnected ? "Connected" : "Offline"}</span>
            </div>
          </div>

          {watchConnected && storage ? (
            <>
              <StorageRing
                percent={storage.percent}
                usedBytes={storage.usedBytes}
              />

              <p className="storage-ring-caption">
                {formatBytes(storage.usedBytes)} of{" "}
                {formatBytes(storage.totalBytes)}
                {storage.freeBytes !== undefined
                  ? ` · ${formatBytes(storage.freeBytes)} free`
                  : ` · ${formatBytes(storage.totalBytes)} capacity`}
              </p>
            </>
          ) : null}
        </section>
      </div>

      <div className="dashboard-metrics dashboard-block">
        <MetricTile
          label="Local Library"
          value={downloads.length}
          detail={downloads.length === 1 ? "track saved" : "tracks saved"}
          icon={<Music size={18} aria-hidden="true" />}
          onClick={onOpenLibrary}
        />
        <MetricTile
          label="On Watch"
          value={watchTracks.length}
          detail={watchTracks.length === 1 ? "MP3 on device" : "MP3s on device"}
          icon={<HardDrive size={18} aria-hidden="true" />}
        />
        <MetricTile
          label="Transferred"
          value={transferredCount}
          detail={transferredCount === 1 ? "track synced" : "tracks synced"}
          icon={<CheckCircle2 size={18} aria-hidden="true" />}
          onClick={onOpenLibrary}
        />
        <MetricTile
          label="Library Size"
          value={formatBytes(librarySize)}
          detail="local storage used"
          icon={<FolderOpen size={18} aria-hidden="true" />}
          onClick={onOpenLibrary}
        />
      </div>

      <div className="dashboard-actions dashboard-block">
        <button
          type="button"
          className="dashboard-action"
          onClick={onOpenYouTube}
        >
          <Link size={16} aria-hidden="true" />
          Browse YouTube
        </button>
        <button
          type="button"
          className="dashboard-action"
          onClick={onOpenSpotify}
        >
          <ListMusic size={16} aria-hidden="true" />
          Sync Spotify
        </button>
      </div>

      <section className="dashboard-download panel dashboard-block">
        <form
          className="download-form download-form-compact"
          onSubmit={onDownload}
        >
          <label className="url-field">
            <span>Quick download</span>
            <div className="input-shell">
              <Link size={18} aria-hidden="true" />
              <input
                ref={urlInputRef}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Paste a YouTube URL or playlist…"
              />
            </div>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={autoTransfer}
              onChange={(event) => setAutoTransfer(event.target.checked)}
            />
            Auto-transfer
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={!url.trim()}
          >
            <Download size={18} aria-hidden="true" />
            Download MP3
          </button>
        </form>

        {jobs.length > 0 ? (
          <YouTubeJobsList
            jobs={jobs}
            onCancelJob={onCancelJob}
            onClearJob={onClearJob}
            onClearCompletedJobs={onClearCompletedJobs}
            emptyMessage="No downloads yet"
            compact
          />
        ) : null}
      </section>

      {downloads.length === 0 ? (
        <section className="panel dashboard-onboarding dashboard-block">
          <h2>Get started</h2>
          <p>Connect your watch and paste a YouTube link to get started.</p>
          <div className="dashboard-onboarding-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => urlInputRef.current?.focus()}
            >
              <Download size={18} aria-hidden="true" />
              Download MP3
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenYouTube}
            >
              <Link size={18} aria-hidden="true" />
              Browse YouTube
            </button>
          </div>
        </section>
      ) : (
        <section className="panel dashboard-recent dashboard-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent</p>
              <h2>
                {recentDownloads.length} of {downloads.length}
              </h2>
            </div>
            {downloads.length > 5 ? (
              <button
                className="secondary-button"
                type="button"
                onClick={onOpenLibrary}
              >
                View all
              </button>
            ) : null}
          </div>

          <RecentTrackList
            tracks={recentDownloads}
            busy={busy}
            watchConnected={watchConnected}
            onTransfer={onTransfer}
            onDeleteDownload={onDeleteDownload}
          />
        </section>
      )}
    </div>
  );
}

interface MediaLibraryTabProps {
  downloads: LocalTrack[];
  watchStatus: WatchStatus | null;
  watchConnected: boolean;
  busy: string | null;
  lastOutput: string[];
  onTransfer: (id: string) => void;
  onTransferAll: () => void;
  onTransferDownloads: (tracks: LocalTrack[]) => void;
  onDeleteDownload: (track: LocalTrack) => void;
  onDeleteDownloads: (tracks: LocalTrack[]) => void;
  onDeleteWatchTrack: (track: WatchTrack) => void;
  onDeleteWatchTracks: (tracks: WatchTrack[]) => void;
}

function MediaLibraryTab({
  downloads,
  watchStatus,
  watchConnected,
  busy,
  lastOutput,
  onTransfer,
  onTransferAll,
  onTransferDownloads,
  onDeleteDownload,
  onDeleteDownloads,
  onDeleteWatchTrack,
  onDeleteWatchTracks,
}: MediaLibraryTabProps) {
  const watchTracks = watchStatus?.tracks ?? [];
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedWatchPaths, setSelectedWatchPaths] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((id) => downloads.some((track) => track.id === id)),
      );
      return next.size === current.size ? current : next;
    });
  }, [downloads]);

  useEffect(() => {
    setSelectedWatchPaths((current) => {
      const next = new Set(
        [...current].filter((path) =>
          watchTracks.some((track) => track.relativePath === path),
        ),
      );
      return next.size === current.size ? current : next;
    });
  }, [watchTracks]);

  const pendingTransferCount = useMemo(
    () => countPendingTransfers(downloads, watchTracks, watchConnected),
    [downloads, watchTracks, watchConnected],
  );
  const canTransferAll = watchConnected && pendingTransferCount > 0;

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function setLocalTracksSelected(ids: string[], selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  function clearLocalSelection() {
    setSelectedIds(new Set());
  }

  function toggleSelectWatch(relativePath: string) {
    setSelectedWatchPaths((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }

  function setWatchTracksSelected(relativePaths: string[], selected: boolean) {
    setSelectedWatchPaths((current) => {
      const next = new Set(current);
      for (const relativePath of relativePaths) {
        if (selected) {
          next.add(relativePath);
        } else {
          next.delete(relativePath);
        }
      }
      return next;
    });
  }

  function clearWatchSelection() {
    setSelectedWatchPaths(new Set());
  }

  function handleLocalBulkTransfer(tracks: LocalTrack[]) {
    onTransferDownloads(tracks);
  }

  function handleLocalBulkDelete(tracks: LocalTrack[]) {
    onDeleteDownloads(tracks);
    setSelectedIds(new Set());
  }

  function handleWatchBulkDelete(tracks: WatchTrack[]) {
    onDeleteWatchTracks(tracks);
    setSelectedWatchPaths(new Set());
  }

  return (
    <div className="stack stack-fill">
      <section className="panel panel-flex library-sync-panel">
        <LibrarySyncLayout
          pendingCount={pendingTransferCount}
          localCount={downloads.length}
          watchConnected={watchConnected}
          localPanel={
            <LocalLibraryPanel
              downloads={downloads}
              watchTracks={watchTracks}
              watchConnected={watchConnected}
              busy={busy}
              selectedIds={selectedIds}
              canTransferAll={canTransferAll}
              onToggleSelect={toggleSelect}
              onSelectTracks={setLocalTracksSelected}
              onClearSelection={clearLocalSelection}
              onTransfer={onTransfer}
              onTransferAll={onTransferAll}
              onTransferDownloads={handleLocalBulkTransfer}
              onDeleteDownload={onDeleteDownload}
              onDeleteDownloads={handleLocalBulkDelete}
            />
          }
          watchPanel={
            <WatchLibraryPanel
              watchStatus={watchStatus}
              watchConnected={watchConnected}
              busy={busy}
              selectedPaths={selectedWatchPaths}
              onToggleSelect={toggleSelectWatch}
              onSelectTracks={setWatchTracksSelected}
              onClearSelection={clearWatchSelection}
              onDeleteWatchTrack={onDeleteWatchTrack}
              onDeleteWatchTracks={handleWatchBulkDelete}
            />
          }
        />
      </section>

      {lastOutput.length > 0 ? (
        <section className="panel output-panel">
          <div className="section-heading compact">
            <h2>Last download</h2>
          </div>
          <pre>{lastOutput.slice(-8).join("\n")}</pre>
        </section>
      ) : null}
    </div>
  );
}

interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
  getTitle: () => string;
  getURL: () => string;
  goBack: () => void;
  goForward: () => void;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
}

interface WebviewNavigationEvent extends Event {
  url?: string;
}

interface WebviewTitleEvent extends Event {
  title?: string;
}

interface WebviewConsoleMessageEvent extends Event {
  message?: string;
}

interface WebviewFailLoadEvent extends Event {
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
  isMainFrame?: boolean;
}

interface YouTubeJobsListProps {
  jobs: DownloadJob[];
  onCancelJob: (id: string) => void;
  onClearJob: (id: string) => void;
  onClearCompletedJobs?: () => void;
  emptyMessage?: string;
  compact?: boolean;
}

function YouTubeJobsList({
  jobs,
  onCancelJob,
  onClearJob,
  onClearCompletedJobs,
  emptyMessage = "No downloads yet",
  compact = false,
}: YouTubeJobsListProps) {
  const hasActiveDownloads = jobs.some((job) => job.status === "downloading");
  const hasFinishedJobs = jobs.some(
    (job) =>
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled",
  );
  const [, setNowTick] = useState(0);

  useEffect(() => {
    if (!hasActiveDownloads) {
      return;
    }

    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 2000);

    return () => window.clearInterval(interval);
  }, [hasActiveDownloads]);

  return (
    <div
      className={
        compact ? "youtube-jobs-panel youtube-jobs-panel--compact" : undefined
      }
    >
      {compact && jobs.length > 0 ? (
        <div className="youtube-downloads-header">
          <div className="youtube-downloads-title">
            <Download size={16} aria-hidden="true" />
            <span>Downloads</span>
          </div>
          {hasFinishedJobs && onClearCompletedJobs ? (
            <button
              className="text-button"
              type="button"
              onClick={onClearCompletedJobs}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="youtube-jobs-list">
        {jobs.length === 0 ? (
          <div className="youtube-downloads-empty">
            <Download size={26} aria-hidden="true" />
            <strong>{emptyMessage}</strong>
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className={`youtube-job-item ${job.status}`}>
              <div className="youtube-job-head">
                <span className={`badge youtube-job-badge ${job.status}`}>
                  {job.status === "downloading" ? (
                    <Loader2 className="spin" size={13} aria-hidden="true" />
                  ) : null}
                  {formatJobStatus(job)}
                </span>
                {job.status === "queued" || job.status === "downloading" ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => onCancelJob(job.id)}
                  >
                    Cancel
                  </button>
                ) : null}
                {job.status === "completed" ||
                job.status === "failed" ||
                job.status === "cancelled" ? (
                  <button
                    className="icon-button compact"
                    type="button"
                    title="Dismiss"
                    onClick={() => onClearJob(job.id)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <strong title={job.title}>{job.title}</strong>
              {job.status === "downloading" &&
              job.entryType === "playlist" &&
              job.currentTrackTitle ? (
                <span
                  className="youtube-job-meta"
                  title={job.currentTrackTitle}
                >
                  {job.currentTrackTitle}
                </span>
              ) : null}
              {job.status === "downloading" ? (
                <>
                  <span className="youtube-job-activity">
                    {formatJobActivity(job)}
                  </span>
                  {isJobStalled(job) ? (
                    <span className="youtube-job-stall">
                      No recent activity — may still be working
                    </span>
                  ) : null}
                  <div className="youtube-job-progress">
                    <div
                      className="youtube-job-progress-bar"
                      style={{ width: `${Math.round(job.progress)}%` }}
                    />
                  </div>
                  {job.trackProgress !== undefined &&
                  job.entryType === "playlist" ? (
                    <span className="youtube-job-meta">
                      {Math.round(job.trackProgress)}% of current track
                    </span>
                  ) : null}
                </>
              ) : null}
              {job.status === "failed" && job.error ? (
                <span className="youtube-job-error">{job.error}</span>
              ) : null}
              {job.status === "completed" && job.warning ? (
                <span className="youtube-job-warning">{job.warning}</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface YouTubeBrowserViewProps {
  browserUrl: string;
  setBrowserUrl: (url: string) => void;
  input: string;
  setInput: (value: string) => void;
  currentUrl: string;
  setCurrentUrl: (url: string) => void;
  title: string;
  setTitle: (title: string) => void;
  jobs: DownloadJob[];
  onVisit: (url: string, title?: string) => void;
  onDownload: (items: YouTubeDownloadItem | YouTubeDownloadItem[]) => void;
  onCancelJob: (id: string) => void;
  onClearJob: (id: string) => void;
  onClearCompletedJobs: () => void;
}

function YouTubeBrowserView({
  browserUrl,
  setBrowserUrl,
  input,
  setInput,
  currentUrl,
  setCurrentUrl,
  title,
  setTitle,
  jobs,
  onVisit,
  onDownload,
  onCancelJob,
  onClearJob,
  onClearCompletedJobs,
}: YouTubeBrowserViewProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const domReadyRef = useRef(false);
  const lastRecordedUrlRef = useRef("");
  const pendingUrlRef = useRef(browserUrl);
  const onDownloadRef = useRef(onDownload);
  const onVisitRef = useRef(onVisit);

  useEffect(() => {
    onDownloadRef.current = onDownload;
    onVisitRef.current = onVisit;
  });
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webviewKey, setWebviewKey] = useState(0);
  const [webviewSrc, setWebviewSrc] = useState(browserUrl);
  const downloadTarget = getYouTubeDownloadTarget(currentUrl);
  const activeJobCount = jobs.filter(
    (job) => job.status === "queued" || job.status === "downloading",
  ).length;
  const hasFinishedJobs = jobs.some(
    (job) =>
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled",
  );

  function reportLoadError(caught: unknown) {
    const message =
      caught instanceof Error ? caught.message : "Unable to load YouTube.";
    setLoadError(message);
    setLoading(false);
  }

  async function navigateWebview(nextUrl: string) {
    const webview = webviewRef.current;
    if (!webview || !domReadyRef.current) {
      return;
    }

    pendingUrlRef.current = nextUrl;
    setLoadError(null);
    setLoading(true);

    try {
      await webview.loadURL(nextUrl);
    } catch (caught) {
      reportLoadError(caught);
    }
  }

  function navigateTo(nextUrl: string) {
    pendingUrlRef.current = nextUrl;
    setBrowserUrl(nextUrl);
    setCurrentUrl(nextUrl);
    setInput(nextUrl);
    setLoading(true);
    setLoadError(null);
    void navigateWebview(nextUrl);
  }

  async function retryYouTubeLoad(resetSession = false) {
    const nextUrl = pendingUrlRef.current || browserUrl;

    if (resetSession) {
      domReadyRef.current = false;
      await window.corosLink?.resetYouTubeBrowserSession();
      setWebviewSrc(nextUrl);
      setWebviewKey((value) => value + 1);
      setLoadError(null);
      setLoading(true);
      return;
    }

    const webview = webviewRef.current;
    if (!webview || !domReadyRef.current) {
      return;
    }

    setLoadError(null);
    setLoading(true);

    try {
      await webview.loadURL(pendingUrlRef.current || browserUrl);
    } catch (caught) {
      reportLoadError(caught);
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateTo(buildYouTubeBrowserUrl(input));
  }

  useEffect(() => {
    pendingUrlRef.current = browserUrl;
  }, [browserUrl]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    domReadyRef.current = false;

    const updateNavigationState = () => {
      if (!domReadyRef.current) {
        return;
      }

      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    const scheduleVisitRecord = (nextUrl: string) => {
      if (!domReadyRef.current || !isYouTubeUrl(nextUrl)) {
        return;
      }

      window.setTimeout(() => {
        if (!domReadyRef.current) {
          return;
        }

        const latestUrl = webview.getURL() || nextUrl;
        const historyKey = normalizeYouTubeHistoryKey(latestUrl);

        if (lastRecordedUrlRef.current === historyKey) {
          return;
        }

        lastRecordedUrlRef.current = historyKey;
        onVisitRef.current(latestUrl, webview.getTitle());
      }, 250);
    };

    const syncFromWebview = (nextUrl?: string) => {
      if (!domReadyRef.current) {
        return;
      }

      const latestUrl = nextUrl || webview.getURL() || browserUrl;
      setCurrentUrl(latestUrl);
      setInput(latestUrl);
      setTitle(webview.getTitle() || "YouTube");
      updateNavigationState();
      scheduleVisitRecord(latestUrl);
      void injectYouTubeDownloadButton(webview);
    };

    const handleDomReady = () => {
      domReadyRef.current = true;
      setLoading(false);
      setLoadError(null);
      syncFromWebview();
    };

    const handleDidStartLoading = () => {
      setLoading(true);
      setLoadError(null);
    };

    const handleDidStopLoading = () => {
      setLoading(false);
      syncFromWebview();
    };

    const handleDidFailLoad = (event: Event) => {
      const failEvent = event as WebviewFailLoadEvent;
      if (failEvent.isMainFrame === false) {
        return;
      }

      if (failEvent.errorCode === -3) {
        return;
      }

      setLoading(false);
      setLoadError(
        failEvent.errorDescription ||
          `Failed to load ${failEvent.validatedURL || browserUrl}.`,
      );
    };

    const handleNavigation = (event: Event) => {
      syncFromWebview((event as WebviewNavigationEvent).url);
    };

    const handleTitleUpdated = (event: Event) => {
      if (!domReadyRef.current) {
        return;
      }

      const nextTitle =
        (event as WebviewTitleEvent).title || webview.getTitle() || "YouTube";
      setTitle(nextTitle);
      scheduleVisitRecord(webview.getURL());
    };

    const handleConsoleMessage = (event: Event) => {
      if (!domReadyRef.current) {
        return;
      }

      const message = (event as WebviewConsoleMessageEvent).message ?? "";

      if (!message.startsWith(YOUTUBE_DOWNLOAD_CONSOLE_PREFIX)) {
        return;
      }

      try {
        const payload = JSON.parse(
          message.slice(YOUTUBE_DOWNLOAD_CONSOLE_PREFIX.length),
        ) as {
          title?: string;
          url?: string;
          items?: YouTubeDownloadItem[];
        };

        if (Array.isArray(payload.items) && payload.items.length > 0) {
          onDownloadRef.current(payload.items);
          return;
        }

        if (payload.url) {
          onDownloadRef.current({ url: payload.url, title: payload.title });
        }
      } catch {
        onDownloadRef.current({
          url: webview.getURL(),
          title: webview.getTitle(),
        });
      }
    };

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-start-loading", handleDidStartLoading);
    webview.addEventListener("did-stop-loading", handleDidStopLoading);
    webview.addEventListener("did-fail-load", handleDidFailLoad);
    webview.addEventListener("did-navigate", handleNavigation);
    webview.addEventListener("did-navigate-in-page", handleNavigation);
    webview.addEventListener("page-title-updated", handleTitleUpdated);
    webview.addEventListener("console-message", handleConsoleMessage);

    const drainDownloads = window.setInterval(() => {
      if (!domReadyRef.current) {
        return;
      }

      webview
        .executeJavaScript(
          "window.__corosLinkDrainDownloads ? window.__corosLinkDrainDownloads() : []",
        )
        .then((items: unknown) => {
          if (Array.isArray(items) && items.length > 0) {
            onDownloadRef.current(items as YouTubeDownloadItem[]);
          }
        })
        .catch(() => undefined);
    }, 700);

    return () => {
      domReadyRef.current = false;
      window.clearInterval(drainDownloads);
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-start-loading", handleDidStartLoading);
      webview.removeEventListener("did-stop-loading", handleDidStopLoading);
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
      webview.removeEventListener("did-navigate", handleNavigation);
      webview.removeEventListener("did-navigate-in-page", handleNavigation);
      webview.removeEventListener("page-title-updated", handleTitleUpdated);
      webview.removeEventListener("console-message", handleConsoleMessage);
    };
    // Intentionally only re-run when the webview instance changes. Callbacks are
    // read via refs so the one-time `dom-ready` event is not missed on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webviewKey]);

  return (
    <div className="stack stack-fill">
      <section className="panel browser-toolbar-panel">
        <form className="browser-toolbar" onSubmit={handleSearchSubmit}>
          <div className="browser-nav-actions">
            <button
              className="icon-button"
              type="button"
              title="Back"
              disabled={!canGoBack}
              onClick={() => webviewRef.current?.goBack()}
            >
              <ArrowLeft size={17} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              title="Forward"
              disabled={!canGoForward}
              onClick={() => webviewRef.current?.goForward()}
            >
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              title="YouTube home"
              onClick={() => navigateTo(YOUTUBE_HOME_URL)}
            >
              <Home size={17} aria-hidden="true" />
            </button>
          </div>

          <label className="browser-search-field">
            <Search size={18} aria-hidden="true" />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Search YouTube or enter a YouTube URL"
            />
          </label>

          <button className="primary-button" type="submit">
            <Search size={17} aria-hidden="true" />
            Search
          </button>
        </form>
      </section>

      <section className="youtube-layout">
        <section className="panel browser-panel">
          <div className="browser-status-strip">
            <span className={downloadTarget ? "badge ready" : "badge"}>
              {downloadTarget
                ? downloadTarget.kind
                : loading
                  ? "Loading"
                  : "Browse"}
            </span>
            <strong title={title || "YouTube"}>{title || "YouTube"}</strong>
          </div>

          <div className="webview-frame">
            <webview
              key={webviewKey}
              ref={(element) => {
                webviewRef.current = element as WebviewElement | null;
                element?.setAttribute("allowpopups", "");
              }}
              className="youtube-webview"
              src={webviewSrc}
              partition="persist:coroslink-youtube"
              webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no"
            />

            {loadError ? (
              <div className="browser-load-error">
                <AlertCircle size={24} aria-hidden="true" />
                <strong>YouTube failed to load</strong>
                <span>{loadError}</span>
                <div className="browser-load-error-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void retryYouTubeLoad(false)}
                  >
                    Retry
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void retryYouTubeLoad(true)}
                  >
                    Reset session
                  </button>
                </div>
              </div>
            ) : null}

            {downloadTarget ? (
              <button
                className="browser-download-overlay"
                type="button"
                onClick={() => onDownload({ url: downloadTarget.url, title })}
              >
                <Download size={18} aria-hidden="true" />
                {downloadTarget.label}
              </button>
            ) : null}

            {loading && !loadError ? (
              <div className="browser-loading">
                <Loader2 className="spin" size={24} aria-hidden="true" />
              </div>
            ) : null}
          </div>
        </section>

        <aside className="panel youtube-downloads-panel">
          <header className="youtube-downloads-header">
            <div className="youtube-downloads-title">
              <Download size={16} aria-hidden="true" />
              <span>Downloads</span>
              {activeJobCount > 0 ? (
                <span className="youtube-downloads-count">
                  {activeJobCount}
                </span>
              ) : null}
            </div>
            {hasFinishedJobs ? (
              <button
                className="text-button"
                type="button"
                onClick={onClearCompletedJobs}
              >
                Clear
              </button>
            ) : null}
          </header>

          <YouTubeJobsList
            jobs={jobs}
            onCancelJob={onCancelJob}
            onClearJob={onClearJob}
            emptyMessage="Search a video and tap the green MP3 button on any result."
          />
        </aside>
      </section>
    </div>
  );
}

interface SpotifySyncViewProps {
  config: SpotifyConfig;
  status: SpotifyStatus | null;
  playlists: SpotifyPlaylist[];
  selectedPlaylistId: string;
  tracks: SpotifyPlaylistTrack[];
  busy: string | null;
  onConfigChange: (config: SpotifyConfig) => void;
  onConfigSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLogin: () => void;
  onLogout: () => void;
  onSelectPlaylist: (playlistId: string) => void;
  onRefresh: () => void | Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}

interface YouTubeMusicViewProps {
  status: YouTubeMusicStatus | null;
  playlists: YouTubeMusicPlaylist[];
  selectedPlaylistId: string;
  headersRaw: string;
  busy: string | null;
  jobs: DownloadJob[];
  onHeadersChange: (value: string) => void;
  onAuthSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
  onSync: () => void;
  onSelectPlaylist: (playlistId: string) => void;
  onQueuePlaylist: (playlist: YouTubeMusicPlaylist) => void;
  onQueueSong: (song: YouTubeMusicSong) => void;
  onRetrySong: (song: YouTubeMusicSong, jobId: string) => void;
  onOpenSong: (song: YouTubeMusicSong) => void;
}

const YOUTUBE_MUSIC_URL = "https://music.youtube.com/";

// Hosts music.youtube.com inside its own persistent Electron session. The main
// process watches this session's youtubei traffic and hands the captured
// headers to ytmusicapi as soon as the user signs in (see
// youtubeMusicBrowserService.ts), so this component just renders the page and
// offers basic navigation.
function YouTubeMusicLoginBrowser() {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [webviewKey, setWebviewKey] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(YOUTUBE_MUSIC_URL);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const handleDomReady = () => setLoading(false);
    const handleStartLoading = () => setLoading(true);
    const handleStopLoading = () => {
      setLoading(false);
      setCurrentUrl(webview.getURL() || YOUTUBE_MUSIC_URL);
    };
    const handleNavigate = () =>
      setCurrentUrl(webview.getURL() || YOUTUBE_MUSIC_URL);

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
    };
  }, [webviewKey]);

  async function handleReset() {
    setResetting(true);
    setLoading(true);
    try {
      await window.corosLink?.resetYouTubeMusicBrowserSession();
    } finally {
      setResetting(false);
      // Remount the webview so it reloads from the freshly cleared session.
      setCurrentUrl(YOUTUBE_MUSIC_URL);
      setWebviewKey((value) => value + 1);
    }
  }

  return (
    <div className="music-login">
      <div className="music-login-toolbar">
        <div className="browser-nav">
          <button
            className="icon-button"
            type="button"
            title="Reload"
            onClick={() => webviewRef.current?.reload()}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            title="YouTube Music home"
            onClick={() => void webviewRef.current?.loadURL(YOUTUBE_MUSIC_URL)}
          >
            <Home size={16} aria-hidden="true" />
          </button>
        </div>
        <span className="music-login-url" title={currentUrl}>
          {currentUrl}
        </span>
        <button
          className="secondary-button"
          type="button"
          disabled={resetting}
          onClick={() => void handleReset()}
        >
          {resetting ? (
            <Loader2 className="spin" size={15} aria-hidden="true" />
          ) : (
            <LogOut size={15} aria-hidden="true" />
          )}
          Reset session
        </button>
      </div>
      <div className="webview-frame music-login-frame">
        <webview
          key={webviewKey}
          ref={(element) => {
            webviewRef.current = element as WebviewElement | null;
            element?.setAttribute("allowpopups", "");
          }}
          className="youtube-webview"
          src={YOUTUBE_MUSIC_URL}
          partition="persist:coroslink-ytmusic"
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no"
        />
        {loading ? (
          <div className="browser-loading">
            <Loader2 className="spin" size={24} aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function YouTubeMusicView({
  status,
  playlists,
  selectedPlaylistId,
  headersRaw,
  busy,
  jobs,
  onHeadersChange,
  onAuthSubmit,
  onLogout,
  onSync,
  onSelectPlaylist,
  onQueuePlaylist,
  onQueueSong,
  onRetrySong,
  onOpenSong,
}: YouTubeMusicViewProps) {
  // Default to the in-app browser sign-in; the manual header paste stays as a
  // fallback for anyone whose login the embedded browser can't complete.
  const [authMode, setAuthMode] = useState<"browser" | "manual">("browser");
  const selectedPlaylist =
    playlists.find((playlist) => playlist.id === selectedPlaylistId) ??
    playlists[0];
  const jobsByVideoId = useMemo(() => {
    const map = new Map<string, DownloadJob>();
    for (const job of jobs) {
      if (job.entryType === "playlist") {
        continue;
      }
      const videoId = extractYouTubeVideoId(job.url);
      if (videoId) {
        map.set(videoId, job);
      }
    }
    return map;
  }, [jobs]);
  const busyWithMusic = busy?.startsWith("youtube-music") ?? false;
  const dependencyReady = Boolean(
    status?.pythonAvailable && status.ytmusicapiAvailable,
  );
  const syncReady = Boolean(status?.authenticated && dependencyReady);

  return (
    <div className="stack stack-fill">
      <section
        className={
          status?.authenticated
            ? "panel spotify-account-panel"
            : "panel spotify-account-panel music-connect-panel"
        }
      >
        {status?.authenticated ? (
          <div className="spotify-account-card youtube-music-account-card">
            <div
              className="spotify-account-mark youtube-music-account-mark"
              aria-hidden="true"
            >
              <YouTubeMusicBrandIcon size={24} />
            </div>
            <div className="spotify-account-copy">
              <p className="eyebrow">YouTube Music</p>
              <h2>Connected</h2>
              <span>
                {status.songCount} song{status.songCount === 1 ? "" : "s"} ·{" "}
                {status.playlistCount} playlist
                {status.playlistCount === 1 ? "" : "s"}
                {status.syncedAt
                  ? ` · Synced ${formatDate(status.syncedAt)}`
                  : ""}
              </span>
            </div>
            <div className="topbar-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!syncReady || busyWithMusic}
                onClick={onSync}
              >
                {busy === "youtube-music-sync" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <RefreshCw size={17} aria-hidden="true" />
                )}
                Refresh
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy === "youtube-music-logout"}
                onClick={onLogout}
              >
                {busy === "youtube-music-logout" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <LogOut size={17} aria-hidden="true" />
                )}
                Disconnect
              </button>
            </div>
          </div>
        ) : authMode === "browser" ? (
          <div className="youtube-music-connect youtube-music-connect--youtube music-signin">
            <div className="youtube-music-connect-header">
              <div className="youtube-music-connect-mark" aria-hidden="true">
                <YouTubeMusicBrandIcon size={28} />
              </div>
              <div className="youtube-music-connect-intro">
                <p className="eyebrow">YouTube Music</p>
                <h2>Sign in to connect</h2>
                <span>
                  Sign in below and CorosLink captures the access it needs
                  automatically — no DevTools required. Then pull in your
                  playlists and liked songs.
                </span>
              </div>
              <span className={dependencyReady ? "badge ready" : "badge danger"}>
                {dependencyReady ? "Ready" : "Missing"}
              </span>
            </div>

            {dependencyReady ? null : (
              <p className="youtube-music-connect-note">
                {status?.dependencyError ??
                  "The bundled Python runtime or ytmusicapi is missing, so sign-in can't be saved. Reinstall CorosLink or run npm run binaries:prepare."}
              </p>
            )}

            <YouTubeMusicLoginBrowser />

            <div className="music-signin-footer">
              <span className="youtube-music-connect-note">
                Sign-in happens in a private, in-app YouTube Music session. Your
                credentials stay on this device and are only used to read your
                library.
              </span>
              <button
                className="text-button"
                type="button"
                onClick={() => setAuthMode("manual")}
              >
                Paste headers manually instead
              </button>
            </div>
          </div>
        ) : (
          <div className="youtube-music-connect youtube-music-connect--youtube">
            <div className="youtube-music-connect-header">
              <div className="youtube-music-connect-mark" aria-hidden="true">
                <YouTubeMusicBrandIcon size={28} />
              </div>
              <div className="youtube-music-connect-intro">
                <p className="eyebrow">YouTube Music</p>
                <h2>Connect your library</h2>
                <span>
                  Pull in your playlists and liked songs, then download any
                  track straight to your watch.
                </span>
              </div>
              <span className={dependencyReady ? "badge ready" : "badge danger"}>
                {dependencyReady ? "Ready" : "Missing"}
              </span>
            </div>

            <button
              className="text-button music-signin-back"
              type="button"
              onClick={() => setAuthMode("browser")}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back to in-app sign in
            </button>

            <ol className="youtube-music-steps">
              <li>
                Open{" "}
                <a
                  href="https://music.youtube.com/library"
                  target="_blank"
                  rel="noreferrer"
                >
                  music.youtube.com/library
                </a>{" "}
                while signed in, then open DevTools (F12) and switch to the{" "}
                <strong>Network</strong> tab.
              </li>
              <li>
                Filter for <code>/browse</code>, right-click a{" "}
                <strong>POST</strong> request, and choose{" "}
                <strong>Copy → Copy as cURL</strong> (or copy the raw request
                headers).
              </li>
              <li>
                Paste it below and connect — a cURL command or a raw header
                block both work (must include <code>cookie</code> and{" "}
                <code>x-goog-authuser</code>).
              </li>
            </ol>

            <figure className="youtube-music-connect-helper">
              <img
                src="./assets/helper-image/youtube-helper.png"
                alt="YouTube Music DevTools guide: filter Network tab for browse, then right-click a POST request and choose Copy as cURL"
                loading="lazy"
              />
              <figcaption>
                Filter for <code>browse</code>, then copy any POST request as
                cURL.
              </figcaption>
            </figure>

            <form
              className="youtube-music-connect-form"
              onSubmit={onAuthSubmit}
            >
              <label className="field youtube-music-headers-field">
                <textarea
                  value={headersRaw}
                  onChange={(event) => onHeadersChange(event.target.value)}
                  placeholder={
                    "Paste a 'Copy as cURL' command from music.youtube.com\n— or the raw request headers.\n\nMust include cookie and x-goog-authuser"
                  }
                  disabled={!dependencyReady || busy === "youtube-music-auth"}
                />
              </label>
              <div className="youtube-music-connect-footer">
                <span className="youtube-music-connect-note">
                  {status?.dependencyError ??
                    "Headers are stored locally and only used to read your library. They expire when you sign out of YouTube Music in your browser — re-paste them if syncing stops working."}
                  {!status?.ytmusicapiAvailable ? (
                    <code>python3 -m pip install ytmusicapi</code>
                  ) : null}
                </span>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    !dependencyReady ||
                    !headersRaw.trim() ||
                    busy === "youtube-music-auth"
                  }
                >
                  {busy === "youtube-music-auth" ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <LogIn size={17} aria-hidden="true" />
                  )}
                  Connect with headers
                </button>
              </div>
            </form>
          </div>
        )}
      </section>

      {status?.authenticated && playlists.length === 0 ? (
        <section className="panel youtube-music-empty">
          <div className="empty-state">
            <ListMusic size={26} aria-hidden="true" />
            <strong>Nothing synced yet</strong>
            <span>
              Sync to pull your YouTube Music playlists and liked songs, then
              queue any track to your watch.
            </span>
            <button
              className="primary-button"
              type="button"
              disabled={!syncReady || busyWithMusic}
              onClick={onSync}
            >
              {busy === "youtube-music-sync" ? (
                <Loader2 className="spin" size={17} aria-hidden="true" />
              ) : (
                <RefreshCw size={17} aria-hidden="true" />
              )}
              Sync now
            </button>
          </div>
        </section>
      ) : null}

      {status?.authenticated && playlists.length > 0 ? (
        <section className="spotify-layout youtube-music-layout">
          <aside className="panel playlist-panel youtube-music-playlist-panel">
            <div className="section-heading compact playlist-heading">
              <h2>Playlists</h2>
              <span className="count-pill">{playlists.length}</span>
            </div>
            <div className="playlist-list">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  className={
                    playlist.id === selectedPlaylist?.id
                      ? "playlist-button youtube-music-playlist-button active"
                      : "playlist-button youtube-music-playlist-button"
                  }
                  type="button"
                  onClick={() => onSelectPlaylist(playlist.id)}
                >
                  <YouTubeMusicArtwork
                    className="youtube-music-playlist-thumb"
                    thumbnailUrl={playlist.thumbnailUrl}
                  />
                  <span className="youtube-music-playlist-copy">
                    <strong>{playlist.title}</strong>
                    <span>
                      {playlist.songCount} song
                      {playlist.songCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="panel panel-flex youtube-music-detail-panel">
            {selectedPlaylist ? (
              <YouTubeMusicPlaylistDetail
                playlist={selectedPlaylist}
                jobsByVideoId={jobsByVideoId}
                onQueuePlaylist={onQueuePlaylist}
                onQueueSong={onQueueSong}
                onRetrySong={onRetrySong}
                onOpenSong={onOpenSong}
              />
            ) : (
              <EmptyState title="Select a playlist to load its songs" />
            )}
          </section>
        </section>
      ) : null}
    </div>
  );
}

interface YouTubeMusicPlaylistDetailProps {
  playlist: YouTubeMusicPlaylist;
  jobsByVideoId: Map<string, DownloadJob>;
  onQueuePlaylist: (playlist: YouTubeMusicPlaylist) => void;
  onQueueSong: (song: YouTubeMusicSong) => void;
  onRetrySong: (song: YouTubeMusicSong, jobId: string) => void;
  onOpenSong: (song: YouTubeMusicSong) => void;
}

function YouTubeMusicPlaylistDetail({
  playlist,
  jobsByVideoId,
  onQueuePlaylist,
  onQueueSong,
  onRetrySong,
  onOpenSong,
}: YouTubeMusicPlaylistDetailProps) {
  return (
    <>
      <div className="youtube-music-playlist-header">
        {playlist.thumbnailUrl ? (
          <img
            className="youtube-music-playlist-backdrop"
            src={playlist.thumbnailUrl}
            alt=""
            aria-hidden="true"
          />
        ) : null}
        <YouTubeMusicArtwork
          className="youtube-music-playlist-art"
          thumbnailUrl={playlist.thumbnailUrl}
        />
        <div className="youtube-music-playlist-meta">
          <p className="eyebrow">YouTube Music Playlist</p>
          <h3>{playlist.title}</h3>
          <span>
            {playlist.songCount} song{playlist.songCount === 1 ? "" : "s"}
          </span>
          {playlist.description ? <p>{playlist.description}</p> : null}
          {playlist.playlistId ? (
            <a
              className="service-open-link youtube-music-open-link"
              href={`https://music.youtube.com/playlist?list=${playlist.playlistId}`}
              target="_blank"
              rel="noreferrer"
            >
              <YouTubeMusicBrandIcon size={15} />
              Open in YouTube Music
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {playlist.songs.length > 0 ? (
          <button
            className="primary-button youtube-music-queue-all"
            type="button"
            onClick={() => onQueuePlaylist(playlist)}
          >
            <Download size={17} aria-hidden="true" />
            Download all
          </button>
        ) : null}
      </div>

      <YouTubeMusicSongTable
        songs={playlist.songs}
        jobsByVideoId={jobsByVideoId}
        onQueueSong={onQueueSong}
        onRetrySong={onRetrySong}
        onOpenSong={onOpenSong}
      />
    </>
  );
}

function YouTubeMusicBrandIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.684 15.54V8.46L15.816 12l-6.132 3.54z" />
    </svg>
  );
}

function YouTubeMusicArtwork({
  thumbnailUrl,
  className,
}: {
  thumbnailUrl?: string;
  className: string;
}) {
  return thumbnailUrl ? (
    <img className={className} src={thumbnailUrl} alt="" />
  ) : (
    <span
      className={`${className} youtube-music-art-fallback`}
      aria-hidden="true"
    >
      <YouTubeMusicBrandIcon size={22} />
    </span>
  );
}

interface YouTubeMusicSongTableProps {
  songs: YouTubeMusicSong[];
  jobsByVideoId: Map<string, DownloadJob>;
  onQueueSong: (song: YouTubeMusicSong) => void;
  onRetrySong: (song: YouTubeMusicSong, jobId: string) => void;
  onOpenSong: (song: YouTubeMusicSong) => void;
}

function YouTubeMusicSongTable({
  songs,
  jobsByVideoId,
  onQueueSong,
  onRetrySong,
  onOpenSong,
}: YouTubeMusicSongTableProps) {
  if (songs.length === 0) {
    return <EmptyState title="No songs synced" />;
  }

  return (
    <div className="table-shell youtube-music-table-shell">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Song</th>
            <th>Album</th>
            <th>Download</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {songs.map((song, index) => {
            const job = song.videoId
              ? jobsByVideoId.get(song.videoId)
              : undefined;
            const downloadStatus = youtubeMusicDownloadStatus(job);
            const inProgress =
              job?.status === "queued" || job?.status === "downloading";
            const failed = job?.status === "failed";
            const completed = job?.status === "completed";
            return (
              <tr key={song.id}>
                <td>{index + 1}</td>
                <td>
                  <div className="youtube-music-track-cell">
                    <YouTubeMusicArtwork
                      className="youtube-music-track-art"
                      thumbnailUrl={song.thumbnailUrl}
                    />
                    <span className="youtube-music-track-copy">
                      <strong>{song.songTitle}</strong>
                      <span>{song.artistName ?? "Unknown Artist"}</span>
                    </span>
                  </div>
                </td>
                <td>{song.albumTitle ?? "Unknown Album"}</td>
                <td>
                  <span className={downloadStatus.className}>
                    {downloadStatus.label}
                  </span>
                  {failed && job?.error ? (
                    <span className="youtube-music-status-error">
                      {job.error}
                    </span>
                  ) : null}
                </td>
                <td>
                  <div className="table-actions">
                    {failed && job ? (
                      <button
                        className="icon-button"
                        type="button"
                        title="Retry download"
                        aria-label={`Retry ${song.songTitle}`}
                        disabled={!song.videoUrl}
                        onClick={() => onRetrySong(song, job.id)}
                      >
                        <RefreshCw size={16} aria-hidden="true" />
                      </button>
                    ) : inProgress ? (
                      <button
                        className="icon-button"
                        type="button"
                        title="Downloading"
                        disabled
                      >
                        <Loader2
                          className="spin"
                          size={16}
                          aria-hidden="true"
                        />
                      </button>
                    ) : completed ? (
                      <button
                        className="icon-button"
                        type="button"
                        title="Downloaded"
                        disabled
                      >
                        <CheckCircle2 size={16} aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        className="icon-button"
                        type="button"
                        title="Queue"
                        aria-label={`Queue ${song.songTitle}`}
                        disabled={!song.videoUrl}
                        onClick={() => onQueueSong(song)}
                      >
                        <Download size={16} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      type="button"
                      title="Open in YouTube"
                      aria-label={`Open ${song.songTitle} in YouTube`}
                      disabled={!song.videoUrl}
                      onClick={() => onOpenSong(song)}
                    >
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function youtubeMusicDownloadStatus(job?: DownloadJob): {
  label: string;
  className: string;
} {
  switch (job?.status) {
    case "queued":
      return { label: "Queued", className: "badge" };
    case "downloading":
      return {
        label: `${Math.round(job.progress)}%`,
        className: "badge warning",
      };
    case "completed":
      return { label: "Downloaded", className: "badge ready" };
    case "failed":
      return { label: "Failed", className: "badge danger" };
    case "cancelled":
      return { label: "Cancelled", className: "badge" };
    default:
      return { label: "Not queued", className: "badge" };
  }
}

function extractYouTubeVideoId(url: string): string | undefined {
  const match = url.match(
    /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/,
  );
  return match?.[1];
}

function SpotifySyncView({
  config,
  status,
  playlists,
  selectedPlaylistId,
  tracks,
  busy,
  onConfigChange,
  onConfigSubmit,
  onLogin,
  onLogout,
  onSelectPlaylist,
  onRefresh,
  onMessage,
  onError,
}: SpotifySyncViewProps) {
  const api = window.corosLink;
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const selectedPlaylist = playlists.find(
    (playlist) => playlist.id === selectedPlaylistId,
  );

  useEffect(() => {
    if (!api) {
      return;
    }
    void api
      .listYouTubeJobs()
      .then(setJobs)
      .catch(() => {});
    return api.onYouTubeJobsUpdate(setJobs);
  }, [api]);

  const jobByUrl = useMemo(() => {
    const map = new Map<string, DownloadJob>();
    for (const job of jobs) {
      if (job.entryType !== "playlist") {
        map.set(job.url, job);
      }
    }
    return map;
  }, [jobs]);

  async function enqueueTargets(targets: DownloadQueueItem[]) {
    if (!api || targets.length === 0) {
      return;
    }
    try {
      const created = await api.enqueueYouTubeDownloads(targets);
      onMessage(
        created.length === 0
          ? "Those tracks are already queued."
          : `Queued ${created.length} download${created.length === 1 ? "" : "s"}. They run in the background.`,
      );
    } catch (caught) {
      onError(toErrorMessage(caught));
    }
  }

  async function handleQueueTrack(track: SpotifyPlaylistTrack) {
    await enqueueTargets([spotifyDownloadTarget(track)]);
  }

  async function handleQueueAllTracks(playlistTracks: SpotifyPlaylistTrack[]) {
    await enqueueTargets(playlistTracks.map(spotifyDownloadTarget));
  }

  async function handleRetryTrack(track: SpotifyPlaylistTrack, jobId: string) {
    if (!api) {
      return;
    }
    try {
      setJobs(await api.clearYouTubeJob(jobId));
    } catch {
      // The job may already be gone; re-queue regardless.
    }
    await handleQueueTrack(track);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="stack stack-fill">
      <section className="panel spotify-account-panel">
        {status?.authenticated ? (
          <div className="spotify-account-card">
            <div className="spotify-account-mark spotify-brand-mark" aria-hidden="true">
              <SpotifyBrandIcon size={26} />
            </div>
            <div className="spotify-account-copy">
              <p className="eyebrow">Spotify</p>
              <h2>{status.displayName ?? "Connected"}</h2>
              <span>
                {playlists.length} playlist{playlists.length === 1 ? "" : "s"}{" "}
                available
              </span>
            </div>
            <div className="topbar-actions">
              <button
                className="primary-button"
                type="button"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
              >
                {refreshing ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <RefreshCw size={17} aria-hidden="true" />
                )}
                Refresh
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy === "spotify-logout"}
                onClick={onLogout}
              >
                {busy === "spotify-logout" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <LogOut size={17} aria-hidden="true" />
                )}
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Spotify OAuth</p>
                <h2>Connect Spotify</h2>
              </div>
              <span className="badge">Not connected</span>
            </div>

            <form className="settings-grid" onSubmit={onConfigSubmit}>
              <label className="field">
                <span>Client ID</span>
                <input
                  value={config.clientId}
                  onChange={(event) =>
                    onConfigChange({ ...config, clientId: event.target.value })
                  }
                  placeholder="Spotify app client ID"
                  disabled={busy === "spotify-config"}
                />
              </label>
              <label className="field">
                <span>Client Secret</span>
                <input
                  value={config.clientSecret}
                  onChange={(event) =>
                    onConfigChange({
                      ...config,
                      clientSecret: event.target.value,
                    })
                  }
                  placeholder="Spotify app client secret"
                  type="password"
                  disabled={busy === "spotify-config"}
                />
              </label>
              <label className="field">
                <span>Redirect URI</span>
                <input value={config.redirectUri} readOnly />
              </label>

              <div className="settings-actions">
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={busy === "spotify-config"}
                >
                  <Settings size={17} aria-hidden="true" />
                  Save
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!status?.configured || busy === "spotify-login"}
                  onClick={onLogin}
                >
                  {busy === "spotify-login" ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <LogIn size={17} aria-hidden="true" />
                  )}
                  Log in
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {status?.authenticated ? (
        <section className="spotify-layout spotify-library-layout">
          <aside className="panel playlist-panel spotify-playlist-panel">
            <div className="section-heading compact playlist-heading">
              <h2>Playlists</h2>
              <span className="count-pill">{playlists.length}</span>
            </div>
            <div className="playlist-list">
              {playlists.length === 0 ? (
                <EmptyState title="No playlists loaded" />
              ) : (
                playlists.map((playlist) => (
                  <button
                    key={playlist.id}
                    className={
                      playlist.id === selectedPlaylistId
                        ? "playlist-button spotify-playlist-button active"
                        : "playlist-button spotify-playlist-button"
                    }
                    type="button"
                    disabled={!playlist.syncable}
                    onClick={() => onSelectPlaylist(playlist.id)}
                  >
                    <SpotifyArtwork
                      className="spotify-playlist-thumb"
                      artworkUrl={playlist.artworkUrl}
                    />
                    <span className="spotify-playlist-copy">
                      <strong>{playlist.name}</strong>
                      <span>
                        {playlist.totalTracks} track
                        {playlist.totalTracks === 1 ? "" : "s"} ·{" "}
                        {playlist.syncable ? "Ready" : "Unavailable"}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="panel panel-flex spotify-detail-panel">
            {selectedPlaylist ? (
              <SpotifyPlaylistDetail
                playlist={selectedPlaylist}
                tracks={tracks}
                jobByUrl={jobByUrl}
                loading={busy?.startsWith("spotify-load") ?? false}
                onQueueAll={() => void handleQueueAllTracks(tracks)}
                onQueueTrack={(track) => void handleQueueTrack(track)}
                onRetryTrack={(track, jobId) =>
                  void handleRetryTrack(track, jobId)
                }
              />
            ) : (
              <EmptyState title="Select a playlist to load its tracks" />
            )}
          </section>
        </section>
      ) : null}
    </div>
  );
}

interface SpotifyPlaylistDetailProps {
  playlist: SpotifyPlaylist;
  tracks: SpotifyPlaylistTrack[];
  jobByUrl: Map<string, DownloadJob>;
  loading: boolean;
  onQueueAll: () => void;
  onQueueTrack: (track: SpotifyPlaylistTrack) => void;
  onRetryTrack: (track: SpotifyPlaylistTrack, jobId: string) => void;
}

function SpotifyPlaylistDetail({
  playlist,
  tracks,
  jobByUrl,
  loading,
  onQueueAll,
  onQueueTrack,
  onRetryTrack,
}: SpotifyPlaylistDetailProps) {
  return (
    <>
      <div className="spotify-playlist-header">
        {playlist.artworkUrl ? (
          <img
            className="spotify-playlist-backdrop"
            src={playlist.artworkUrl}
            alt=""
            aria-hidden="true"
          />
        ) : null}
        <SpotifyArtwork
          className="spotify-playlist-art"
          artworkUrl={playlist.artworkUrl}
        />
        <div className="spotify-playlist-meta">
          <p className="eyebrow">Spotify Playlist</p>
          <h3>{playlist.name}</h3>
          <span>
            {playlist.ownerName ? `${playlist.ownerName} · ` : ""}
            {playlist.totalTracks} track{playlist.totalTracks === 1 ? "" : "s"}
          </span>
          {playlist.description ? <p>{playlist.description}</p> : null}
          {playlist.url ? (
            <a
              className="service-open-link spotify-open-link"
              href={playlist.url}
              target="_blank"
              rel="noreferrer"
            >
              <SpotifyBrandIcon size={15} />
              Open in Spotify
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {tracks.length > 0 ? (
          <button
            className="primary-button spotify-download-all"
            type="button"
            onClick={onQueueAll}
          >
            <Download size={17} aria-hidden="true" />
            Download all
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="spotify-track-loading">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <strong>Loading playlist</strong>
        </div>
      ) : tracks.length === 0 ? (
        <EmptyState title="No tracks in this playlist" />
      ) : (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Album</th>
                <th>Duration</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track, index) => {
                const target = spotifyDownloadTarget(track);
                const job = jobByUrl.get(target.sourceUrl);
                const downloadStatus = youtubeMusicDownloadStatus(job);
                const inProgress =
                  job?.status === "queued" || job?.status === "downloading";
                const failed = job?.status === "failed";
                const completed = job?.status === "completed";
                return (
                  <tr key={track.spotifyTrackId}>
                    <td>{index + 1}</td>
                    <td>
                      <div className="spotify-track-cell">
                        <SpotifyArtwork
                          className="spotify-track-art"
                          artworkUrl={track.artworkUrl}
                        />
                        <span className="spotify-track-copy">
                          <strong>{track.trackName}</strong>
                          <span>{track.artistName}</span>
                        </span>
                      </div>
                    </td>
                    <td>{track.albumName ?? "—"}</td>
                    <td>{formatTrackDuration(track.durationMs)}</td>
                    <td>
                      <div className="table-actions">
                        <span className={downloadStatus.className}>
                          {downloadStatus.label}
                        </span>
                        {failed && job ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="Retry download"
                            aria-label={`Retry ${track.trackName}`}
                            onClick={() => onRetryTrack(track, job.id)}
                          >
                            <RefreshCw size={16} aria-hidden="true" />
                          </button>
                        ) : inProgress ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="Downloading"
                            disabled
                          >
                            <Loader2
                              className="spin"
                              size={16}
                              aria-hidden="true"
                            />
                          </button>
                        ) : completed ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="Downloaded"
                            disabled
                          >
                            <CheckCircle2 size={16} aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            className="icon-button"
                            type="button"
                            title="Download"
                            aria-label={`Download ${track.trackName}`}
                            onClick={() => onQueueTrack(track)}
                          >
                            <Download size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SpotifyArtwork({
  artworkUrl,
  className,
}: {
  artworkUrl?: string;
  className: string;
}) {
  return artworkUrl ? (
    <img className={className} src={artworkUrl} alt="" />
  ) : (
    <span className={`${className} spotify-art-fallback`} aria-hidden="true">
      <SpotifyBrandIcon size={22} />
    </span>
  );
}

function SpotifyBrandIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

interface WatchViewProps {
  watchStatus: WatchStatus | null;
  storage: {
    totalBytes: number;
    usedBytes: number;
    freeBytes?: number;
    percent: number;
    capacityLabel: string;
  } | null;
  busy: string | null;
  onDeleteWatchTrack: (track: LocalTrackLike) => void;
}

function WatchView({
  watchStatus,
  storage,
  busy,
  onDeleteWatchTrack,
}: WatchViewProps) {
  const watchPresentation = getWatchPresentation(watchStatus);
  const connected = Boolean(watchStatus?.connected);
  const tracks = watchStatus?.tracks ?? [];
  const storageTitle =
    watchPresentation.state === "connected-known"
      ? watchPresentation.displayName
      : connected
        ? (watchStatus?.name ?? "COROS Watch")
        : "No watch connected";

  return (
    <div className="stack">
      <section className="panel">
        <div className="storage-row">
          <div>
            <p className="eyebrow">Storage</p>
            <h2>{storageTitle}</h2>
          </div>
          {connected && storage ? (
            <div className="storage-numbers">
              <strong>{formatBytes(storage.usedBytes)}</strong>
              <span>of {formatBytes(storage.totalBytes)}</span>
            </div>
          ) : null}
        </div>
        {connected && storage ? (
          <>
            <div className="storage-bar" aria-label="Watch storage usage">
              <span style={{ width: `${storage.percent}%` }} />
            </div>
            <div className="storage-meta">
              <span>{storage.percent}% used</span>
              <span>
                {storage.freeBytes !== undefined
                  ? `${formatBytes(storage.freeBytes)} free`
                  : storage.capacityLabel}
              </span>
            </div>
          </>
        ) : (
          <p className="connect-hint">
            Connect your COROS watch via USB to sync music
          </p>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Watch Music Folder</p>
            <h2>{tracks.length} MP3 file(s)</h2>
          </div>
          <FolderOpen size={22} aria-hidden="true" />
        </div>

        <WatchTrackTable
          tracks={tracks}
          busy={busy}
          connected={connected}
          onDeleteWatchTrack={onDeleteWatchTrack}
        />
      </section>
    </div>
  );
}

type LocalTrackLike = {
  name: string;
  relativePath: string;
};

interface WatchTrackTableProps {
  tracks: LocalTrackLike[];
  busy: string | null;
  connected: boolean;
  onDeleteWatchTrack: (track: LocalTrackLike) => void;
}

function WatchTrackTable({
  tracks,
  busy,
  connected,
  onDeleteWatchTrack,
}: WatchTrackTableProps) {
  if (!connected) {
    return <EmptyState title="Connect a COROS watch" />;
  }

  if (tracks.length === 0) {
    return <EmptyState title="No MP3 files on the watch" />;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Track</th>
            <th>Folder Path</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <tr key={track.relativePath}>
              <td>
                <strong>{track.name}</strong>
              </td>
              <td>{track.relativePath}</td>
              <td>
                <div className="row-actions">
                  <button
                    className="icon-button danger"
                    type="button"
                    title="Delete from watch"
                    disabled={busy === `delete-watch:${track.relativePath}`}
                    onClick={() => onDeleteWatchTrack(track)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ToastItem {
  id: number;
  kind: "success" | "error";
  text: string;
}

const TOAST_DURATION: Record<ToastItem["kind"], number> = {
  success: 4500,
  error: 7000,
};

// Drives the floating toast stack from the app's existing message/error state,
// so every setMessage/setError call surfaces as an auto-dismissing toast
// instead of a banner that shoves the layout down.
function useToaster(message: string | null, error: string | null) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const lastMessageRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (kind: ToastItem["kind"], text: string) => {
      const id = (nextIdRef.current += 1);
      setToasts((current) => [...current.slice(-2), { id, kind, text }]);
      const timer = window.setTimeout(
        () => dismissToast(id),
        TOAST_DURATION[kind],
      );
      timersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  // Refs guard against StrictMode's double-invoke and repeated identical values
  // (e.g. a polled watch error) while still re-toasting after the source clears.
  useEffect(() => {
    if (message && message !== lastMessageRef.current) {
      pushToast("success", message);
    }
    lastMessageRef.current = message;
  }, [message, pushToast]);

  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      pushToast("error", error);
    }
    lastErrorRef.current = error;
  }, [error, pushToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { toasts, dismissToast };
}

function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className={`toast toast--${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      <span className="toast-icon" aria-hidden="true">
        {toast.kind === "error" ? (
          <AlertCircle size={18} />
        ) : (
          <CheckCircle2 size={18} />
        )}
      </span>
      <span className="toast-text">{toast.text}</span>
      <button
        className="toast-close"
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={15} aria-hidden="true" />
      </button>
      <span
        className="toast-progress"
        style={{ animationDuration: `${TOAST_DURATION[toast.kind]}ms` }}
        aria-hidden="true"
      />
    </div>
  );
}

function BridgeMissing() {
  return (
    <section className="panel">
      <div className="empty-state">
        <AlertCircle size={26} aria-hidden="true" />
        <strong>Electron bridge unavailable</strong>
        <span>Run the app with npm run dev or npm start.</span>
      </div>
    </section>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="empty-state">
      <Music size={24} aria-hidden="true" />
      <strong>{title}</strong>
    </div>
  );
}

const APPLE_MUSIC_LOGIN_URL = "https://music.apple.com/login";
const APPLE_MUSIC_HOME_URL = "https://music.apple.com/";

// Hosts music.apple.com inside its own persistent Electron session. The main
// process watches this session's amp-api traffic and lifts the auth headers as
// soon as the user signs in (see appleMusicBrowserService.ts), so this
// component only has to render the page and offer basic navigation.
function AppleMusicLoginBrowser() {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [webviewKey, setWebviewKey] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(APPLE_MUSIC_LOGIN_URL);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const handleDomReady = () => setLoading(false);
    const handleStartLoading = () => setLoading(true);
    const handleStopLoading = () => {
      setLoading(false);
      setCurrentUrl(webview.getURL() || APPLE_MUSIC_LOGIN_URL);
    };
    const handleNavigate = () =>
      setCurrentUrl(webview.getURL() || APPLE_MUSIC_LOGIN_URL);

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
    };
  }, [webviewKey]);

  async function handleReset() {
    setResetting(true);
    setLoading(true);
    try {
      await window.corosLink?.resetAppleMusicBrowserSession();
    } finally {
      setResetting(false);
      // Remount the webview so it reloads from the freshly cleared session.
      setCurrentUrl(APPLE_MUSIC_LOGIN_URL);
      setWebviewKey((value) => value + 1);
    }
  }

  return (
    <div className="apple-music-login">
      <div className="apple-music-login-toolbar">
        <div className="browser-nav">
          <button
            className="icon-button"
            type="button"
            title="Reload"
            onClick={() => webviewRef.current?.reload()}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Apple Music home"
            onClick={() => void webviewRef.current?.loadURL(APPLE_MUSIC_HOME_URL)}
          >
            <Home size={16} aria-hidden="true" />
          </button>
        </div>
        <span className="apple-music-login-url" title={currentUrl}>
          {currentUrl}
        </span>
        <button
          className="secondary-button"
          type="button"
          disabled={resetting}
          onClick={() => void handleReset()}
        >
          {resetting ? (
            <Loader2 className="spin" size={15} aria-hidden="true" />
          ) : (
            <LogOut size={15} aria-hidden="true" />
          )}
          Reset session
        </button>
      </div>
      <div className="webview-frame apple-music-login-frame">
        <webview
          key={webviewKey}
          ref={(element) => {
            webviewRef.current = element as WebviewElement | null;
            element?.setAttribute("allowpopups", "");
          }}
          className="youtube-webview apple-music-webview"
          src={APPLE_MUSIC_LOGIN_URL}
          partition="persist:coroslink-apple"
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no"
        />
        {loading ? (
          <div className="browser-loading">
            <Loader2 className="spin" size={24} aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AppleMusicView({
  onMessage,
  onError,
}: {
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const api = window.corosLink;
  const [status, setStatus] = useState<AppleMusicStatus | null>(null);
  const [headersRaw, setHeadersRaw] = useState("");
  const [playlists, setPlaylists] = useState<AppleMusicPlaylist[]>([]);
  const [selectedId, setSelectedId] = useState(
    () => appleMusicSelectedPlaylistIdMemory || readAppleMusicSelectedPlaylistId(),
  );
  const [detailCache, setDetailCache] = useState<
    Record<string, AppleMusicPlaylist>
  >(() => appleMusicDetailCacheMemory);
  const [busy, setBusy] = useState<
    "auth" | "logout" | "list" | "tracks" | null
  >(null);
  // Default to the in-app browser sign-in; the manual header paste stays as a
  // fallback for anyone whose login the embedded browser can't complete.
  const [authMode, setAuthMode] = useState<"browser" | "manual">("browser");
  const [loadingPlaylistId, setLoadingPlaylistId] = useState<string | null>(
    null,
  );
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  // Route feedback through the global toast stack instead of an inline banner.
  const setError = useCallback(
    (value: string | null) => {
      if (value) {
        onError(value);
      }
    },
    [onError],
  );
  const setNotice = useCallback(
    (value: string | null) => {
      if (value) {
        onMessage(value);
      }
    },
    [onMessage],
  );

  const loadPlaylistDetail = useCallback(
    async (id: string) => {
      if (!api || !id) {
        return;
      }

      setLoadingPlaylistId(id);
      setError(null);
      try {
        const detail = await api.fetchAppleMusicPlaylist(id);
        appleMusicDetailCacheMemory = {
          ...appleMusicDetailCacheMemory,
          [id]: detail,
        };
        setDetailCache((previous) => {
          return { ...previous, [id]: detail };
        });
      } catch (caught) {
        setError(toErrorMessage(caught));
      } finally {
        setLoadingPlaylistId((current) => (current === id ? null : current));
      }
    },
    [api],
  );

  const refreshPlaylists = useCallback(async () => {
    if (!api) {
      return;
    }
    setBusy("list");
    setError(null);
    try {
      const nextPlaylists = await api.listAppleMusicPlaylists();
      setPlaylists(nextPlaylists);
      setSelectedId((current) => {
        const remembered =
          current || appleMusicSelectedPlaylistIdMemory || readAppleMusicSelectedPlaylistId();
        const nextId = nextPlaylists.some((playlist) => playlist.id === remembered)
          ? remembered
          : nextPlaylists[0]?.id || "";
        rememberAppleMusicSelectedPlaylistId(nextId);
        return nextId;
      });
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      return;
    }
    void api
      .getAppleMusicStatus()
      .then(setStatus)
      .catch((caught: unknown) => setError(toErrorMessage(caught)));
  }, [api]);

  // The main process lifts credentials out of the embedded music.apple.com
  // session and notifies us when they change (e.g. once the user signs in and
  // the media-user-token first appears).
  useEffect(() => {
    if (!api) {
      return;
    }
    return api.onAppleMusicAuthCaptured((next) => {
      setStatus(next);
      setNotice(
        next.hasUserToken
          ? "Apple Music connected — your library is ready."
          : "Signed in to Apple Music.",
      );
    });
  }, [api, setNotice]);

  useEffect(() => {
    if (status?.authenticated && status.hasUserToken) {
      void refreshPlaylists();
    }
  }, [status?.authenticated, status?.hasUserToken, refreshPlaylists]);

  useEffect(() => {
    rememberAppleMusicSelectedPlaylistId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !status?.authenticated || !status.hasUserToken) {
      return;
    }

    if (!detailCache[selectedId] && loadingPlaylistId !== selectedId) {
      void loadPlaylistDetail(selectedId);
    }
  }, [
    detailCache,
    loadPlaylistDetail,
    loadingPlaylistId,
    selectedId,
    status?.authenticated,
    status?.hasUserToken,
  ]);

  useEffect(() => {
    if (!api) {
      return;
    }
    void api.listYouTubeJobs().then(setJobs).catch(() => {});
    return api.onYouTubeJobsUpdate(setJobs);
  }, [api]);

  const jobByUrl = useMemo(() => {
    const map = new Map<string, DownloadJob>();
    for (const job of jobs) {
      if (job.entryType !== "playlist") {
        map.set(job.url, job);
      }
    }
    return map;
  }, [jobs]);

  if (!api) {
    return null;
  }

  // A catalog-only credential (developer token without a media-user-token)
  // isn't usefully connected — keep showing the sign-in flow so the user can
  // finish logging in and capture the library token.
  const connected = Boolean(status?.authenticated && status.hasUserToken);

  const selectedSummary = selectedId
    ? playlists.find((playlist) => playlist.id === selectedId)
    : undefined;
  const selectedDetail = selectedId ? detailCache[selectedId] : undefined;
  const selectedPlaylist = selectedDetail ?? selectedSummary;
  const selectedPlaylistLoading =
    Boolean(selectedId && loadingPlaylistId === selectedId) && !selectedDetail;

  async function enqueueTargets(targets: DownloadQueueItem[]) {
    if (!api || targets.length === 0) {
      return;
    }
    setError(null);
    try {
      const created = await api.enqueueYouTubeDownloads(targets);
      setNotice(
        created.length === 0
          ? "Those tracks are already queued."
          : `Queued ${created.length} download${created.length === 1 ? "" : "s"}. They run in the background.`,
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handleQueueTrack(track: AppleMusicTrack) {
    await enqueueTargets([appleMusicDownloadTarget(track)]);
  }

  async function handleQueueAllTracks(detail: AppleMusicPlaylist) {
    await enqueueTargets(detail.tracks.map(appleMusicDownloadTarget));
  }

  async function handleRetryTrack(track: AppleMusicTrack, jobId: string) {
    if (!api) {
      return;
    }
    try {
      setJobs(await api.clearYouTubeJob(jobId));
    } catch {
      // The job may already be gone; re-queue regardless.
    }
    await handleQueueTrack(track);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !headersRaw.trim()) {
      return;
    }
    setBusy("auth");
    setError(null);
    try {
      const next = await api.saveAppleMusicAuth(headersRaw);
      setStatus(next);
      setHeadersRaw("");
      setNotice("Apple Music headers saved.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    if (!api) {
      return;
    }
    setBusy("logout");
    setError(null);
    try {
      // Clear the stored credentials *and* the persisted Apple Music browser
      // session, otherwise the webview stays signed in and a fresh capture
      // would silently reconnect the same account.
      const [next] = await Promise.all([
        api.logoutAppleMusic(),
        api.resetAppleMusicBrowserSession(),
      ]);
      setStatus(next);
      setPlaylists([]);
      setSelectedId("");
      setDetailCache({});
      appleMusicDetailCacheMemory = {};
      setNotice("Apple Music disconnected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectPlaylist(id: string) {
    setSelectedId(id);
    if (!api) {
      return;
    }
    void loadPlaylistDetail(id);
  }

  return (
    <div className="stack stack-fill">
      <section
        className={
          connected
            ? "panel spotify-account-panel"
            : "panel spotify-account-panel music-connect-panel"
        }
      >
        {connected ? (
          <div className="spotify-account-card apple-music-account-card">
            <div
              className="spotify-account-mark apple-music-account-mark"
              aria-hidden="true"
            >
              <AppleBrandIcon size={24} />
            </div>
            <div className="spotify-account-copy">
              <p className="eyebrow">Apple Music</p>
              <h2>Connected</h2>
              <span>
                Catalog + library access
                {status?.authUpdatedAt
                  ? ` · Saved ${formatDate(status.authUpdatedAt)}`
                  : ""}
              </span>
            </div>
            <div className="topbar-actions">
              <button
                className="primary-button"
                type="button"
                disabled={busy === "list"}
                onClick={() => void refreshPlaylists()}
              >
                {busy === "list" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <RefreshCw size={17} aria-hidden="true" />
                )}
                Refresh
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy === "logout"}
                onClick={handleLogout}
              >
                {busy === "logout" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <LogOut size={17} aria-hidden="true" />
                )}
                Disconnect
              </button>
            </div>
          </div>
        ) : authMode === "browser" ? (
          <div className="youtube-music-connect youtube-music-connect--apple apple-music-signin">
            <div className="youtube-music-connect-header">
              <div
                className="youtube-music-connect-mark apple-music-connect-mark"
                aria-hidden="true"
              >
                <AppleBrandIcon size={28} />
              </div>
              <div className="youtube-music-connect-intro">
                <p className="eyebrow">Apple Music</p>
                <h2>Sign in to connect</h2>
                <span>
                  Sign in below, then open your <strong>Library</strong> —
                  CorosLink captures the access it needs automatically. No
                  DevTools and no Apple Developer account required.
                </span>
              </div>
            </div>

            <AppleMusicLoginBrowser />

            <div className="apple-music-signin-footer">
              <span className="youtube-music-connect-note">
                Sign-in happens in a private, in-app Apple Music session. Your
                credentials stay on this device and are only used to read
                playlist metadata.
              </span>
              <button
                className="text-button"
                type="button"
                onClick={() => setAuthMode("manual")}
              >
                Paste headers manually instead
              </button>
            </div>
          </div>
        ) : (
          <div className="youtube-music-connect youtube-music-connect--apple">
            <div className="youtube-music-connect-header">
              <div
                className="youtube-music-connect-mark apple-music-connect-mark"
                aria-hidden="true"
              >
                <AppleBrandIcon size={28} />
              </div>
              <div className="youtube-music-connect-intro">
                <p className="eyebrow">Apple Music</p>
                <h2>Connect your library</h2>
                <span>
                  Paste the request headers from music.apple.com to read
                  playlist metadata. No Apple Developer account needed.
                </span>
              </div>
            </div>

            <button
              className="text-button apple-music-signin-back"
              type="button"
              onClick={() => setAuthMode("browser")}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back to in-app sign in
            </button>

            <ol className="youtube-music-steps">
              <li>
                Open{" "}
                <a
                  href="https://music.apple.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  music.apple.com
                </a>{" "}
                while signed in, then open DevTools (F12) and switch to the{" "}
                <strong>Network</strong> tab.
              </li>
              <li>
                Filter for <code>amp-api</code>, right-click any request, and
                choose <strong>Copy → Copy as cURL</strong> (or copy the raw
                request headers).
              </li>
              <li>
                Paste it below and connect — it must include the{" "}
                <code>authorization</code> bearer token (and{" "}
                <code>media-user-token</code> for personal playlists).
              </li>
            </ol>

            <figure className="youtube-music-connect-helper">
              <img
                src="./assets/helper-image/apple-helper.png"
                alt="Apple Music DevTools guide: filter Network tab for amp-api, then right-click a request and choose Copy as cURL"
                loading="lazy"
              />
              <figcaption>
                Filter for <code>amp-api</code>, then copy any request as cURL.
              </figcaption>
            </figure>

            <form
              className="youtube-music-connect-form"
              onSubmit={handleAuthSubmit}
            >
              <label className="field youtube-music-headers-field">
                <textarea
                  value={headersRaw}
                  onChange={(event) => setHeadersRaw(event.target.value)}
                  placeholder={
                    "Paste a 'Copy as cURL' command from music.apple.com\n— or the raw request headers.\n\nMust include the authorization bearer token"
                  }
                  disabled={busy === "auth"}
                />
              </label>
              <div className="youtube-music-connect-footer">
                <span className="youtube-music-connect-note">
                  Headers are stored locally and only used to read playlist
                  metadata. The Apple Music token expires often — re-paste it if
                  fetching stops working.
                </span>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!headersRaw.trim() || busy === "auth"}
                >
                  {busy === "auth" ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <LogIn size={17} aria-hidden="true" />
                  )}
                  Connect with headers
                </button>
              </div>
            </form>
          </div>
        )}
      </section>

      {connected ? (
        playlists.length === 0 ? (
          <section className="panel youtube-music-empty">
            <div className="empty-state">
              <ListMusic size={26} aria-hidden="true" />
              <strong>
                {busy === "list" ? "Loading playlists…" : "No playlists found"}
              </strong>
              <span>
                Your Apple Music library playlists load automatically. Refresh
                to try again.
              </span>
              <button
                className="primary-button"
                type="button"
                disabled={busy === "list"}
                onClick={() => void refreshPlaylists()}
              >
                {busy === "list" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <RefreshCw size={17} aria-hidden="true" />
                )}
                Refresh
              </button>
            </div>
          </section>
        ) : (
          <section className="spotify-layout apple-music-layout">
            <aside className="panel playlist-panel apple-music-playlist-panel">
              <div className="section-heading compact playlist-heading">
                <h2>Playlists</h2>
                <span className="count-pill">{playlists.length}</span>
              </div>
              <div className="playlist-list">
                {playlists.map((entry) => {
                  // Once a playlist has been opened, its cached detail has the
                  // exact count (tracks.length); prefer it over the list value.
                  const trackCount =
                    detailCache[entry.id]?.trackCount ?? entry.trackCount;
                  return (
                    <button
                      key={entry.id}
                      className={
                        entry.id === selectedId
                          ? "playlist-button apple-music-playlist-button active"
                          : "playlist-button apple-music-playlist-button"
                      }
                      type="button"
                      onClick={() => void handleSelectPlaylist(entry.id)}
                    >
                      <AppleMusicArtwork
                        className="apple-music-playlist-thumb"
                        artworkUrl={entry.artworkUrl}
                      />
                      <span className="apple-music-playlist-copy">
                        <strong>{entry.name}</strong>
                        <span>
                          {trackCount} track
                          {trackCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="panel panel-flex apple-music-detail-panel">
              {selectedPlaylist ? (
                <AppleMusicPlaylistDetail
                  playlist={selectedPlaylist}
                  loadingTracks={selectedPlaylistLoading}
                  jobByUrl={jobByUrl}
                  onQueueAll={() => void handleQueueAllTracks(selectedPlaylist)}
                  onQueueTrack={(track) => void handleQueueTrack(track)}
                  onRetryTrack={(track, jobId) =>
                    void handleRetryTrack(track, jobId)
                  }
                />
              ) : (
                <EmptyState title="Select a playlist to load its tracks" />
              )}
            </section>
          </section>
        )
      ) : null}
    </div>
  );
}

interface AppleMusicPlaylistDetailProps {
  playlist: AppleMusicPlaylist;
  loadingTracks: boolean;
  jobByUrl: Map<string, DownloadJob>;
  onQueueAll: () => void;
  onQueueTrack: (track: AppleMusicTrack) => void;
  onRetryTrack: (track: AppleMusicTrack, jobId: string) => void;
}

function AppleMusicPlaylistDetail({
  playlist,
  loadingTracks,
  jobByUrl,
  onQueueAll,
  onQueueTrack,
  onRetryTrack,
}: AppleMusicPlaylistDetailProps) {
  return (
    <>
      <div className="apple-music-playlist-header">
        {playlist.artworkUrl ? (
          <img
            className="apple-music-playlist-backdrop"
            src={playlist.artworkUrl}
            alt=""
            aria-hidden="true"
          />
        ) : null}
        <AppleMusicArtwork
          className="apple-music-playlist-art"
          artworkUrl={playlist.artworkUrl}
        />
        <div className="apple-music-playlist-meta">
          <p className="eyebrow">Apple Music Playlist</p>
          <h3>{playlist.name}</h3>
          <span>
            {playlist.trackCount} track{playlist.trackCount === 1 ? "" : "s"}
            {playlist.curatorName ? ` · ${playlist.curatorName}` : ""}
            {playlist.lastModifiedAt
              ? ` · Updated ${formatDate(playlist.lastModifiedAt)}`
              : ""}
          </span>
          {playlist.description ? <p>{playlist.description}</p> : null}
          {playlist.url ? (
            <a
              className="service-open-link apple-music-open-link"
              href={playlist.url}
              target="_blank"
              rel="noreferrer"
            >
              <AppleBrandIcon size={15} />
              Open in Apple Music
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {playlist.tracks.length > 0 ? (
          <button
            className="primary-button apple-music-download-all"
            type="button"
            onClick={onQueueAll}
          >
            <Download size={17} aria-hidden="true" />
            Download all
          </button>
        ) : null}
      </div>

      {loadingTracks ? (
        <div className="apple-music-track-loading">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <strong>Loading tracks</strong>
        </div>
      ) : playlist.tracks.length === 0 ? (
        <EmptyState title="No tracks in this playlist" />
      ) : (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Album</th>
                <th>Duration</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {playlist.tracks.map((track, index) => {
                const target = appleMusicDownloadTarget(track);
                const job =
                  jobByUrl.get(target.sourceUrl) ??
                  jobByUrl.get(appleMusicLegacySearchUrl(target.query));
                const downloadStatus = youtubeMusicDownloadStatus(job);
                const inProgress =
                  job?.status === "queued" || job?.status === "downloading";
                const failed = job?.status === "failed";
                const completed = job?.status === "completed";
                return (
                  <tr key={track.id}>
                    <td>{track.trackNumber ?? index + 1}</td>
                    <td>
                      <div className="apple-music-track-cell">
                        <AppleMusicArtwork
                          className="apple-music-track-art"
                          artworkUrl={track.artworkUrl}
                        />
                        <span className="apple-music-track-copy">
                          <strong>{track.title}</strong>
                          <span>{track.artistName ?? "Unknown Artist"}</span>
                        </span>
                      </div>
                    </td>
                    <td>{track.albumName ?? "—"}</td>
                    <td>{formatTrackDuration(track.durationMs)}</td>
                    <td>
                      <div className="table-actions">
                        <span className={downloadStatus.className}>
                          {downloadStatus.label}
                        </span>
                        {failed && job ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="Retry download"
                            aria-label={`Retry ${track.title}`}
                            onClick={() => onRetryTrack(track, job.id)}
                          >
                            <RefreshCw size={16} aria-hidden="true" />
                          </button>
                        ) : inProgress ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="Downloading"
                            disabled
                          >
                            <Loader2
                              className="spin"
                              size={16}
                              aria-hidden="true"
                            />
                          </button>
                        ) : completed ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="Downloaded"
                            disabled
                          >
                            <CheckCircle2 size={16} aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            className="icon-button"
                            type="button"
                            title="Download"
                            aria-label={`Download ${track.title}`}
                            onClick={() => onQueueTrack(track)}
                          >
                            <Download size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AppleMusicArtwork({
  artworkUrl,
  className,
}: {
  artworkUrl?: string;
  className: string;
}) {
  return artworkUrl ? (
    <img className={className} src={artworkUrl} alt="" />
  ) : (
    <span className={`${className} apple-music-art-fallback`} aria-hidden="true">
      <AppleBrandIcon size={24} />
    </span>
  );
}

function AppleBrandIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35-4.88-5.03-4.16-12.69 1.38-12.97 1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01z" />
      <path d="M12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function readAppleMusicSelectedPlaylistId(): string {
  try {
    return (
      window.localStorage.getItem(APPLE_MUSIC_SELECTED_PLAYLIST_STORAGE_KEY) ??
      ""
    );
  } catch {
    return "";
  }
}

function rememberAppleMusicSelectedPlaylistId(playlistId: string): void {
  appleMusicSelectedPlaylistIdMemory = playlistId;

  try {
    if (playlistId) {
      window.localStorage.setItem(
        APPLE_MUSIC_SELECTED_PLAYLIST_STORAGE_KEY,
        playlistId,
      );
    } else {
      window.localStorage.removeItem(APPLE_MUSIC_SELECTED_PLAYLIST_STORAGE_KEY);
    }
  } catch {
    // Local storage may be unavailable; in-memory selection still works.
  }
}

// Apple Music streams are DRM-protected, so "download" resolves each track to a
// YouTube search and reuses the existing download queue (the same approach the
// Spotify integration takes). Jobs use the Apple track URL/id as their stable
// source identity so they can be matched back to tracks after the search runs.
function appleMusicDownloadTarget(
  track: AppleMusicTrack,
): Extract<DownloadQueueItem, { source: "search" }> {
  const artist = track.artistName ?? "";
  const query = `${artist} ${track.title} official audio`.trim();
  const title = [artist, track.title].filter(Boolean).join(" - ") || track.title;
  return {
    source: "search",
    query,
    title,
    sourceUrl: track.catalogUrl?.trim() || `apple-music:${track.id}`,
    fileBaseName: title,
  };
}

function appleMusicLegacySearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// Spotify streams are DRM-protected too, so downloads resolve each track to a
// YouTube search and reuse the shared download queue — the same approach as
// Apple Music. The stable Spotify track id keys the job so it maps back after
// the search resolves.
function spotifyDownloadTarget(
  track: SpotifyPlaylistTrack,
): Extract<DownloadQueueItem, { source: "search" }> {
  const artist = track.artistName ?? "";
  const query =
    track.query?.trim() || `${artist} ${track.trackName} official audio`.trim();
  const title =
    [artist, track.trackName].filter(Boolean).join(" - ") || track.trackName;
  return {
    source: "search",
    query,
    title,
    sourceUrl: `spotify:${track.spotifyTrackId}`,
    fileBaseName: title,
  };
}

function formatTrackDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) {
    return "—";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function StatusDot({ connected }: { connected: boolean }) {
  return <span className={connected ? "status-dot connected" : "status-dot"} />;
}

type YouTubeDownloadTarget = {
  kind: "Video" | "Playlist";
  label: string;
  url: string;
};

function buildYouTubeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return YOUTUBE_HOME_URL;
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(www\.)?(youtube\.com|youtu\.be)(\/|$)/i.test(trimmed)
      ? `https://${trimmed}`
      : "";

  if (candidate && isYouTubeUrl(candidate)) {
    return candidate;
  }

  return `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmed)}`;
}

function isYouTubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
    return host === "youtu.be" || host.endsWith("youtube.com");
  } catch {
    return false;
  }
}

function getYouTubeDownloadTarget(value: string): YouTubeDownloadTarget | null {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      return videoId
        ? {
            kind: "Video",
            label: "Download MP3",
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          }
        : null;
    }

    if (!host.endsWith("youtube.com")) {
      return null;
    }

    const videoId = parsed.searchParams.get("v");
    const playlistId = parsed.searchParams.get("list");

    if (parsed.pathname === "/playlist" && playlistId) {
      return {
        kind: "Playlist",
        label: "Download playlist",
        url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
      };
    }

    if (parsed.pathname === "/watch" && playlistId) {
      return {
        kind: "Playlist",
        label: "Download playlist",
        url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
      };
    }

    if (parsed.pathname === "/watch" && videoId) {
      return {
        kind: "Video",
        label: "Download MP3",
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeYouTubeHistoryKey(value: string): string {
  return getYouTubeDownloadTarget(value)?.url ?? value;
}

function injectYouTubeDownloadButton(webview: WebviewElement): Promise<void> {
  const script = `
(() => {
  const marker = ${JSON.stringify(YOUTUBE_DOWNLOAD_CONSOLE_PREFIX)};
  const styleId = "coroslink-youtube-download-style";
  const btnClass = "coroslink-yt-dl-btn";
  const rowSelector =
    "ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer";

  window.__corosLinkDrainDownloads = () => {
    const pending = window.__corosLinkPendingDownloads || [];
    window.__corosLinkPendingDownloads = [];
    return pending;
  };

  const emitDownload = (items) => {
    try {
      window.__corosLinkPendingDownloads = (window.__corosLinkPendingDownloads || []).concat(items);
    } catch (err) {}
    try {
      console.info(marker + JSON.stringify({ items }));
    } catch (err) {}
  };

  const ensureStyle = () => {
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = [
      "." + btnClass + " { position: absolute; top: 8px; left: 8px; z-index: 100; display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 999px; background: #2d9a74; color: #fff; font: 700 12px system-ui, sans-serif; padding: 6px 10px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.45); opacity: .92; }",
      "." + btnClass + ":hover { background: #24785a; opacity: 1; }",
      "." + btnClass + ".done { background: #1f6b4f; }"
    ].join("\\n");
    document.documentElement.appendChild(style);
  };

  const previewStyleId = "coroslink-youtube-disable-preview-style";
  const previewSelectors =
    "#inline-preview-player, ytd-video-preview, .ytd-video-preview, .ytp-inline-preview, #preview ytd-video-preview, ytd-thumbnail-overlay-hover-text-renderer";
  const previewHoverSelectors =
    "#content.ytd-rich-item-renderer, #contents.ytd-item-section-renderer, #dismissible.ytd-compact-video-renderer, ytd-thumbnail, a#thumbnail";

  const removePreviewPlayers = () => {
    document.querySelectorAll(previewSelectors).forEach((node) => {
      node.remove();
    });

    document
      .querySelectorAll(
        "#inline-preview-player video, ytd-video-preview video, .ytd-video-preview video, .ytp-inline-preview video"
      )
      .forEach((video) => {
        video.pause();
        video.removeAttribute("src");
        try {
          video.load();
        } catch (err) {}
      });
  };

  const ensurePreviewDisabled = () => {
    if (!document.getElementById(previewStyleId)) {
      const style = document.createElement("style");
      style.id = previewStyleId;
      style.textContent = previewSelectors + " { display: none !important; visibility: hidden !important; pointer-events: none !important; }";
      document.documentElement.appendChild(style);
    }

    removePreviewPlayers();
  };

  const blockPreviewHover = (event) => {
    const path =
      typeof event.composedPath === "function" ? event.composedPath() : [];
    if (
      path.some(
        (elem) =>
          elem &&
          elem.matches &&
          elem.matches(previewHoverSelectors)
      )
    ) {
      event.stopImmediatePropagation();
    }
  };

  const ensurePreviewGuards = () => {
    if (window.__corosLinkYoutubePreviewDisabled) {
      ensurePreviewDisabled();
      return;
    }

    window.__corosLinkYoutubePreviewDisabled = true;
    window.addEventListener("mouseenter", blockPreviewHover, true);
    window.addEventListener("mouseover", blockPreviewHover, true);
    window.addEventListener("pointerenter", blockPreviewHover, true);

    new MutationObserver(() => {
      ensurePreviewDisabled();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });

    ensurePreviewDisabled();
  };

  const readVideo = (renderer) => {
    const anchor = renderer.querySelector(
      "a#thumbnail[href*='watch?v='], a#video-title[href*='watch?v='], a[href*='/watch?v=']"
    );
    if (!anchor) {
      return null;
    }

    const href = anchor.href || anchor.getAttribute("href") || "";
    let videoId = "";
    try {
      videoId = new URL(href, window.location.origin).searchParams.get("v") || "";
    } catch {
      return null;
    }
    if (!videoId) {
      return null;
    }

    const titleEl = renderer.querySelector(
      "#video-title, #video-title-link, a#video-title, yt-formatted-string#video-title"
    );
    let title = "";
    if (titleEl) {
      title = (
        titleEl.getAttribute("title") ||
        titleEl.textContent ||
        titleEl.getAttribute("aria-label") ||
        ""
      ).trim();
    }
    if (!title) {
      title = (
        anchor.getAttribute("title") ||
        anchor.getAttribute("aria-label") ||
        anchor.textContent ||
        ""
      ).trim();
    }

    return {
      videoId,
      title: title || "",
      url: "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId)
    };
  };

  const ensureRowButton = (renderer) => {
    const info = readVideo(renderer);
    if (!info) {
      return;
    }

    let button = renderer.querySelector("." + btnClass);
    if (!button) {
      const host =
        renderer.querySelector("ytd-thumbnail") ||
        renderer.querySelector("#thumbnail") ||
        renderer;
      if (window.getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }

      button = document.createElement("button");
      button.type = "button";
      button.className = btnClass;
      button.textContent = "Download MP3";
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          emitDownload([
            { url: button.dataset.url, title: button.dataset.title }
          ]);
          button.textContent = "Queued ✓";
          button.classList.add("done");
          window.setTimeout(() => {
            button.textContent = "Download MP3";
            button.classList.remove("done");
          }, 1800);
        },
        true
      );
      host.appendChild(button);
    }

    button.dataset.url = info.url;
    button.dataset.title = info.title;
    button.title = "Download " + info.title;
  };

  let scheduled = false;
  const run = () => {
    ensureStyle();
    ensurePreviewGuards();
    document.querySelectorAll(rowSelector).forEach(ensureRowButton);
  };
  const upsert = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      run();
    });
  };

  if (!window.__corosLinkYoutubeDownloadInjected) {
    window.__corosLinkYoutubeDownloadInjected = true;
    window.addEventListener("yt-navigate-finish", upsert);
    new MutationObserver(upsert).observe(
      document.body || document.documentElement,
      { childList: true, subtree: true }
    );
    window.setInterval(upsert, 2500);
  }

  upsert();
})();
`;

  return webview
    .executeJavaScript(script, true)
    .then(() => undefined)
    .catch(() => undefined);
}

function formatJobStatus(job: DownloadJob): string {
  if (job.status === "queued") {
    return "Queued";
  }

  if (job.status === "downloading") {
    if (job.entryType === "playlist" && job.trackIndex && job.trackTotal) {
      return `Track ${job.trackIndex}/${job.trackTotal} · ${Math.round(job.progress)}%`;
    }

    return `${Math.round(job.progress)}%`;
  }

  if (job.status === "completed") {
    if (job.entryType === "playlist") {
      const count = job.tracks.length || job.completedTrackCount || 0;
      return count > 0 ? `Completed · ${count} tracks` : "Completed";
    }

    return "Completed";
  }

  if (job.status === "cancelled") {
    return "Cancelled";
  }

  return "Failed";
}

function formatJobActivity(job: DownloadJob): string {
  if (job.activity) {
    return job.activity;
  }

  switch (job.phase) {
    case "starting":
      return "Starting yt-dlp… (first run can take ~30s)";
    case "converting":
      return "Converting to MP3…";
    case "between_tracks":
      return "Preparing next track…";
    case "downloading":
      return "Downloading…";
    default:
      return "Working…";
  }
}

function isJobStalled(job: DownloadJob): boolean {
  if (job.status !== "downloading") {
    return false;
  }

  const updatedAt = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  const idleMs = Date.now() - updatedAt;
  const thresholdMs = job.phase === "starting" ? 45_000 : 20_000;
  return idleMs >= thresholdMs;
}

function viewTitle(view: View): string {
  if (view === "overview") {
    return "Overview";
  }

  if (view === "media") {
    return "Media";
  }

  if (view === "maps") {
    return "Maps";
  }

  return "Training Hub";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
