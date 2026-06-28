import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  Home,
  LayoutGrid,
  Link,
  ListMusic,
  LogIn,
  LogOut,
  Loader2,
  Music,
  RefreshCw,
  Search,
  Settings,
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
  LocalTrack,
  SpotifyConfig,
  SpotifyPlaylist,
  SpotifyPlaylistTrack,
  SpotifyStatus,
  SpotifySyncTrack,
  SpotifySyncUpdate,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubAnalytics,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout,
  WatchStatus,
  WatchTrack,
  AppUpdateSnapshot,
} from "../electron/types";
import { buildTrainingHubSnapshot } from "./training/parsers";
import { fetchTrainingDashboard, fetchUpcomingWorkouts } from "./training/api";
import { TRAINING_HEATMAP_DAYS } from "./training/chartConfig";
import { recentTrainingHubDateList } from "./training/formatters";
import { TrainingHubView } from "./training/TrainingHubView";
import type { TrainingHubSnapshot } from "./training/types";
import type { CorosLinkApi } from "./coroslink-api";
import { AppUpdateControls } from "./components/AppUpdateControls";
import {
  LibrarySyncLayout,
  LocalLibraryPanel,
  WatchLibraryPanel,
} from "./media/LibraryPanels";
import {
  countPendingTransfers,
  isLocalTrackOnWatch,
} from "./media/libraryUtils";
import { useTimeOfDayGreeting } from "./hooks/useTimeOfDayGreeting";
import { getWatchPresentation } from "./watchModels";

type View = "overview" | "media" | "training";
type MediaTab = "library" | "youtube" | "spotify";

const YOUTUBE_HOME_URL = "https://www.youtube.com/";
const YOUTUBE_DOWNLOAD_CONSOLE_PREFIX = "__COROSLINK_YOUTUBE_DOWNLOAD__";

interface YouTubeDownloadItem {
  url: string;
  title?: string;
}

export default function App() {
  const api: CorosLinkApi | undefined = window.corosLink;
  const [activeView, setActiveView] = useState<View>("overview");
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
  const [spotifySyncTracks, setSpotifySyncTracks] = useState<
    SpotifySyncTrack[]
  >([]);
  const [spotifyAutoTransfer, setSpotifyAutoTransfer] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(YOUTUBE_HOME_URL);
  const [youtubeInput, setYoutubeInput] = useState("");
  const [youtubeCurrentUrl, setYoutubeCurrentUrl] = useState(YOUTUBE_HOME_URL);
  const [youtubeTitle, setYoutubeTitle] = useState("YouTube");
  const [youtubeJobs, setYoutubeJobs] = useState<DownloadJob[]>([]);
  const completedJobIdsRef = useRef<Set<string>>(new Set());
  const [trainingHubStatus, setTrainingHubStatus] =
    useState<TrainingHubStatus | null>(null);
  const [trainingHubEmail, setTrainingHubEmail] = useState("");
  const [trainingHubPassword, setTrainingHubPassword] = useState("");
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
  const [trainingHubFileUrl, setTrainingHubFileUrl] = useState<string | null>(
    null,
  );
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
    },
  );

  useEffect(() => {
    if (!api) {
      return;
    }

    void api.getAppUpdateStatus().then(setAppUpdateSnapshot);
    return api.onAppUpdateStatus(setAppUpdateSnapshot);
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
      setSpotifySyncTracks([]);
    }
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
    setTrainingHubFileUrl(null);
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
    ] = await Promise.allSettled([
      api.listTrainingHubActivities(1, 50),
      api.getTrainingAnalytics(),
      fetchTrainingDashboard(api),
      api.getDailyMetrics(dateList),
      api.getSportTypeMap(),
      fetchUpcomingWorkouts(api, 14),
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

  const refreshTrainingHub = useCallback(async () => {
    if (!api) {
      return;
    }

    const status = await api.getTrainingHubStatus();
    setTrainingHubStatus(status);

    if (status.authenticated) {
      await loadTrainingHubData();
    } else {
      clearTrainingHubData();
    }
  }, [api, clearTrainingHubData, loadTrainingHubData]);

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
        setTrainingHubFileUrl(null);
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
    void refreshTrainingHub().catch((caught) => {
      setError(toErrorMessage(caught));
    });

    const interval = window.setInterval(() => {
      void refreshAll();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [api, refreshAll, refreshSpotify, refreshTrainingHub]);

  useEffect(() => {
    if (!api) {
      return;
    }

    return api.onSpotifySyncUpdate((update: SpotifySyncUpdate) => {
      setSpotifySyncTracks((current) =>
        mergeSpotifySyncUpdate(current, update),
      );
    });
  }, [api]);

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

        if (
          autoTransferRef.current &&
          watchConnectedRef.current &&
          api
        ) {
          void (async () => {
            let transferred = 0;
            for (const job of newlyCompleted) {
              for (const track of job.tracks) {
                await api.transferLocalTrack(track.id);
                transferred += 1;
              }
            }

            if (transferred > 0) {
              setMessage(
                `${transferred} track(s) downloaded and transferred.`,
              );
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
      watchStatus.tracks.reduce(
        (total, track) => total + track.sizeBytes,
        0,
      ) ?? 0;
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
      await Promise.all([refreshAll(), refreshSpotify(), refreshTrainingHub()]);
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
    void api?.quitAndInstallUpdate();
  }

  async function loadSpotifyPlaylist(playlistId: string) {
    if (!api) {
      return;
    }

    setBusy(`spotify-load:${playlistId}`);
    setError(null);

    try {
      const [tracks, syncState] = await Promise.all([
        api.listSpotifyPlaylistTracks(playlistId),
        api.listSpotifySyncState(playlistId),
      ]);
      setSpotifyTracks(tracks);
      setSpotifySyncTracks(syncState);
    } catch (caught) {
      setError(toErrorMessage(caught));
      setSpotifyTracks([]);
      setSpotifySyncTracks([]);
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
      setSpotifySyncTracks([]);
      setSelectedSpotifyPlaylistId("");
      setMessage("Spotify account disconnected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSpotifySync() {
    if (!api || !selectedSpotifyPlaylistId) {
      return;
    }

    setBusy("spotify-sync");
    setError(null);
    setMessage(null);

    try {
      const result = await api.syncSpotifyPlaylist(
        selectedSpotifyPlaylistId,
        spotifyAutoTransfer,
      );
      setSpotifySyncTracks(result.tracks);
      setMessage(
        `Spotify sync finished: ${result.completed} done, ${result.failed} failed.`,
      );
      await refreshAll();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
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

  async function handleTrainingHubFileUrl(
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType,
  ) {
    if (!api) {
      return;
    }

    setBusy(`training-file:${activity.activityId}:${fileType}`);
    setError(null);
    setMessage(null);

    try {
      const fileUrl = await api.getTrainingHubActivityFileUrl(
        activity.activityId,
        activity.sportType,
        fileType,
      );
      setTrainingHubFileUrl(fileUrl);
      setTrainingHubActivityDetail(null);
      setMessage("COROS activity file URL ready.");
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
    );
  }, [trainingHubAnalytics, trainingHubDashboard, trainingHubDailyMetrics]);

  function openMediaTab(tab: MediaTab) {
    setActiveView("media");
    setActiveMediaTab(tab);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-start">
          <div className="brand">
            <div className="brand-mark">
              <Watch size={22} aria-hidden="true" />
            </div>
            <div>
              <strong>CorosLink</strong>
              <span>Media & watch</span>
            </div>
          </div>

          <nav className="primary-tabs" aria-label="Primary">
            <button
              type="button"
              className={
                activeView === "overview" ? "primary-tab active" : "primary-tab"
              }
              onClick={() => setActiveView("overview")}
            >
              <LayoutGrid size={16} aria-hidden="true" />
              Overview
            </button>
            <button
              type="button"
              className={
                activeView === "media" ? "primary-tab active" : "primary-tab"
              }
              onClick={() => setActiveView("media")}
            >
              <Music size={16} aria-hidden="true" />
              Media
            </button>
            <button
              type="button"
              className={
                activeView === "training" ? "primary-tab active" : "primary-tab"
              }
              onClick={() => setActiveView("training")}
            >
              <Activity size={16} aria-hidden="true" />
              Training Hub
            </button>
          </nav>
        </div>

        <div className="app-header-end">
          <AppUpdateControls
            snapshot={appUpdateSnapshot}
            busy={busy === "update-check"}
            onCheck={() => void handleCheckForUpdates()}
            onInstall={handleInstallUpdate}
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

      <main
        className={[
          "content",
          isOverviewDashboard && "content-overview",
          activeView === "media" && "content-fill",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {!api ? (
          <BridgeMissing />
        ) : (
          <>
            <Feedback message={message} error={error ?? watchStatus?.error} />

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
                onRefresh={handleRefresh}
              />
            ) : activeView === "media" ? (
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
                ) : (
                  <SpotifySyncView
                    config={spotifyConfig}
                    status={spotifyStatus}
                    playlists={spotifyPlaylists}
                    selectedPlaylistId={selectedSpotifyPlaylistId}
                    tracks={spotifyTracks}
                    syncTracks={spotifySyncTracks}
                    autoTransfer={spotifyAutoTransfer}
                    busy={busy}
                    watchConnected={Boolean(watchStatus?.connected)}
                    onConfigChange={setSpotifyConfig}
                    onConfigSubmit={handleSpotifyConfigSubmit}
                    onLogin={handleSpotifyLogin}
                    onLogout={handleSpotifyLogout}
                    onSelectPlaylist={setSelectedSpotifyPlaylistId}
                    onAutoTransferChange={setSpotifyAutoTransfer}
                    onSync={handleSpotifySync}
                  />
                )}
              </MediaView>
            ) : (
              <TrainingHubView
                status={trainingHubStatus}
                email={trainingHubEmail}
                password={trainingHubPassword}
                activities={trainingHubActivities}
                upcomingWorkouts={trainingHubUpcomingWorkouts}
                snapshot={trainingHubSnapshot}
                sportTypes={trainingHubSportTypes}
                activityDetail={trainingHubActivityDetail}
                selectedActivity={selectedTrainingHubActivity}
                fileUrl={trainingHubFileUrl}
                busy={busy}
                onEmailChange={setTrainingHubEmail}
                onPasswordChange={setTrainingHubPassword}
                onLogin={handleTrainingHubLogin}
                onLogout={handleTrainingHubLogout}
                onRefresh={handleTrainingHubRefresh}
                onLoadDetail={handleTrainingHubActivityDetail}
                onGetFileUrl={handleTrainingHubFileUrl}
              />
            )}
          </>
        )}
      </main>
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
      label: "YouTube",
      icon: <Link size={16} aria-hidden="true" />,
    },
    {
      id: "spotify",
      label: "Spotify",
      icon: <ListMusic size={16} aria-hidden="true" />,
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
  onRefresh: () => void;
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
  onRefresh,
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
  const statusEyebrow =
    watchPresentation.state === "disconnected" ? "Watch" : watchPresentation.displayName;
  const statusTitle =
    watchPresentation.state === "disconnected"
      ? "Not connected"
      : watchPresentation.state === "connected-known"
        ? watchPresentation.displayName
        : (watchStatus?.name ?? "Connected");

  return (
    <div className="dashboard">
      <header className="dashboard-welcome dashboard-block">
        <div>
          <h1 className="dashboard-greeting">{greeting}</h1>
          <p className="dashboard-subtitle">{watchPresentation.companion}</p>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Refresh watch and library"
          onClick={onRefresh}
          disabled={busy === "refresh"}
        >
          <RefreshCw
            size={18}
            aria-hidden="true"
            className={busy === "refresh" ? "spin" : ""}
          />
        </button>
      </header>

      <div
        className={[
          "dashboard-hero-row",
          "dashboard-block",
          !watchPresentation.heroImage && "dashboard-hero-row--no-hero",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {watchPresentation.heroImage ? (
          <section className="dashboard-hero panel">
            <img
              src={watchPresentation.heroImage}
              alt={watchPresentation.heroAlt ?? ""}
              className="dashboard-hero-image"
            />
          </section>
        ) : null}

        <section className="dashboard-status panel">
          <div className="dashboard-status-header">
            <div>
              <p className="eyebrow">{statusEyebrow}</p>
              <h2>{statusTitle}</h2>
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
          ) : (
            <p className="connect-hint">{watchPresentation.connectHint}</p>
          )}
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
  syncTracks: SpotifySyncTrack[];
  autoTransfer: boolean;
  busy: string | null;
  watchConnected: boolean;
  onConfigChange: (config: SpotifyConfig) => void;
  onConfigSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLogin: () => void;
  onLogout: () => void;
  onSelectPlaylist: (playlistId: string) => void;
  onAutoTransferChange: (value: boolean) => void;
  onSync: () => void;
}

function SpotifySyncView({
  config,
  status,
  playlists,
  selectedPlaylistId,
  tracks,
  syncTracks,
  autoTransfer,
  busy,
  watchConnected,
  onConfigChange,
  onConfigSubmit,
  onLogin,
  onLogout,
  onSelectPlaylist,
  onAutoTransferChange,
  onSync,
}: SpotifySyncViewProps) {
  const selectedPlaylist = playlists.find(
    (playlist) => playlist.id === selectedPlaylistId,
  );
  const syncByTrackId = useMemo(
    () => new Map(syncTracks.map((track) => [track.spotifyTrackId, track])),
    [syncTracks],
  );
  const canSync =
    Boolean(status?.authenticated && selectedPlaylist?.syncable) &&
    busy !== "spotify-sync";

  return (
    <div className="stack stack-fill">
      <section className="panel spotify-account-panel">
        {status?.authenticated ? (
          <div className="spotify-account-card">
            <div className="spotify-account-mark" aria-hidden="true">
              <ListMusic size={22} />
            </div>
            <div className="spotify-account-copy">
              <p className="eyebrow">Spotify account</p>
              <h2>{status.displayName ?? "Connected"}</h2>
              <span>
                {playlists.length} playlist{playlists.length === 1 ? "" : "s"}{" "}
                available
              </span>
            </div>
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

      <section className="spotify-layout">
        <aside className="panel playlist-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Playlists</p>
              <h2>{playlists.length}</h2>
            </div>
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
                      ? "playlist-button active"
                      : "playlist-button"
                  }
                  type="button"
                  disabled={!playlist.syncable}
                  onClick={() => onSelectPlaylist(playlist.id)}
                >
                  <strong>{playlist.name}</strong>
                  <span>
                    {playlist.totalTracks} track(s) ·{" "}
                    {playlist.syncable ? "Ready" : "Unavailable"}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="panel panel-flex">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {selectedPlaylist ? selectedPlaylist.ownerName : "Playlist"}
              </p>
              <h2>{selectedPlaylist?.name ?? "Select a playlist"}</h2>
            </div>
            <div className="topbar-actions">
              <label className="check-row compact-check">
                <input
                  type="checkbox"
                  checked={autoTransfer}
                  disabled={!watchConnected}
                  onChange={(event) =>
                    onAutoTransferChange(event.target.checked)
                  }
                />
                Auto-transfer
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!canSync}
                onClick={onSync}
              >
                {busy === "spotify-sync" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <RefreshCw size={17} aria-hidden="true" />
                )}
                Re-sync
              </button>
            </div>
          </div>

          <SpotifyTrackTable
            tracks={tracks}
            syncByTrackId={syncByTrackId}
            loading={busy?.startsWith("spotify-load") ?? false}
          />
        </section>
      </section>
    </div>
  );
}

interface SpotifyTrackTableProps {
  tracks: SpotifyPlaylistTrack[];
  syncByTrackId: Map<string, SpotifySyncTrack>;
  loading: boolean;
}

function SpotifyTrackTable({
  tracks,
  syncByTrackId,
  loading,
}: SpotifyTrackTableProps) {
  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 className="spin" size={24} aria-hidden="true" />
        <strong>Loading playlist</strong>
      </div>
    );
  }

  if (tracks.length === 0) {
    return <EmptyState title="No tracks selected" />;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Track</th>
            <th>Filename</th>
            <th>Status</th>
            <th>Local File</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => {
            const syncTrack = syncByTrackId.get(track.spotifyTrackId);
            return (
              <tr key={track.spotifyTrackId}>
                <td>
                  <strong>{track.trackName}</strong>
                  <span>{track.artistName}</span>
                </td>
                <td>{syncTrack?.filename ?? track.filename}</td>
                <td>
                  <span className={syncStatusClass(syncTrack?.status)}>
                    {syncTrack?.status ?? "queued"}
                  </span>
                  {syncTrack?.error ? <span>{syncTrack.error}</span> : null}
                </td>
                <td>
                  {syncTrack?.filePath ? (
                    <span>{syncTrack.filePath}</span>
                  ) : (
                    <span>{track.query}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

function Feedback({
  message,
  error,
}: {
  message: string | null;
  error?: string | null;
}) {
  if (!message && !error) {
    return null;
  }

  return (
    <div className={error ? "feedback error" : "feedback"}>
      {error ? (
        <AlertCircle size={18} aria-hidden="true" />
      ) : (
        <CheckCircle2 size={18} aria-hidden="true" />
      )}
      <span>{error ?? message}</span>
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

function StatusDot({ connected }: { connected: boolean }) {
  return <span className={connected ? "status-dot connected" : "status-dot"} />;
}

function mergeSpotifySyncUpdate(
  tracks: SpotifySyncTrack[],
  update: SpotifySyncUpdate,
): SpotifySyncTrack[] {
  const next = new Map(tracks.map((track) => [track.spotifyTrackId, track]));
  next.set(update.spotifyTrackId, update);
  return Array.from(next.values()).sort((left, right) =>
    `${left.artistName} ${left.trackName}`.localeCompare(
      `${right.artistName} ${right.trackName}`,
    ),
  );
}

function syncStatusClass(status?: SpotifySyncTrack["status"]): string {
  if (status === "done") {
    return "badge ready";
  }

  if (status === "failed") {
    return "badge danger";
  }

  if (status === "downloading") {
    return "badge warning";
  }

  return "badge";
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
    if (
      job.entryType === "playlist" &&
      job.trackIndex &&
      job.trackTotal
    ) {
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

  return "Training Hub";
}

const TRACK_AVATAR_COLORS = [
  "#2d9a74",
  "#6366f1",
  "#d89b22",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function trackAvatarColor(title: string): string {
  let hash = 0;

  for (const character of title) {
    hash = (hash + character.charCodeAt(0)) % TRACK_AVATAR_COLORS.length;
  }

  return TRACK_AVATAR_COLORS[hash];
}

function trackInitial(title: string): string {
  const trimmed = title.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
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
