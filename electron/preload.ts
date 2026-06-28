import { contextBridge, ipcRenderer } from "electron";
import type {
  BinaryStatus,
  DownloadAudioResult,
  DownloadJob,
  LocalTrack,
  SpotifyConfig,
  SpotifyPlaylist,
  SpotifyPlaylistTrack,
  SpotifyStatus,
  SpotifySyncResult,
  SpotifySyncTrack,
  SpotifySyncUpdate,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubAnalytics,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubRacePredictor,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout,
  TransferResult,
  AppUpdateSnapshot,
  WatchConnectionSmokeOptionId,
  WatchStatus,
  YouTubeHistoryEntry
} from "./types";

const api = {
  getWatchStatus: (): Promise<WatchStatus> =>
    ipcRenderer.invoke("watch:getStatus"),
  getWatchConnectionSmokeOption: (): Promise<WatchConnectionSmokeOptionId> =>
    ipcRenderer.invoke("watch:getConnectionSmokeOption"),
  setWatchConnectionSmokeOption: (
    optionId: WatchConnectionSmokeOptionId
  ): Promise<WatchStatus> =>
    ipcRenderer.invoke("watch:setConnectionSmokeOption", optionId),
  deleteWatchTrack: (relativePath: string): Promise<WatchStatus> =>
    ipcRenderer.invoke("watch:deleteTrack", relativePath),
  transferLocalTrack: (id: string): Promise<TransferResult> =>
    ipcRenderer.invoke("watch:transferLocalTrack", id),
  listDownloads: (): Promise<LocalTrack[]> =>
    ipcRenderer.invoke("downloads:list"),
  downloadAudio: (url: string): Promise<DownloadAudioResult> =>
    ipcRenderer.invoke("downloads:downloadAudio", url),
  deleteDownload: (id: string, removeFile: boolean): Promise<LocalTrack[]> =>
    ipcRenderer.invoke("downloads:delete", id, removeFile),
  getBinaryStatus: (): Promise<BinaryStatus> =>
    ipcRenderer.invoke("binaries:getStatus"),
  listYouTubeHistory: (): Promise<YouTubeHistoryEntry[]> =>
    ipcRenderer.invoke("youtube:listHistory"),
  recordYouTubeVisit: (
    url: string,
    title?: string
  ): Promise<YouTubeHistoryEntry> =>
    ipcRenderer.invoke("youtube:recordVisit", url, title),
  downloadFromYouTubeBrowser: (
    url: string,
    title?: string
  ): Promise<DownloadAudioResult> =>
    ipcRenderer.invoke("youtube:download", url, title),
  downloadMultipleFromYouTubeBrowser: (
    items: Array<{ url: string; title?: string }>
  ): Promise<DownloadAudioResult> =>
    ipcRenderer.invoke("youtube:downloadMultiple", items),
  enqueueYouTubeDownloads: (
    items: Array<{ url: string; title?: string }>
  ): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:enqueueDownload", items),
  listYouTubeJobs: (): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:listJobs"),
  clearYouTubeJob: (id: string): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:clearJob", id),
  cancelYouTubeJob: (id: string): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:cancelJob", id),
  clearCompletedYouTubeJobs: (): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:clearCompletedJobs"),
  onYouTubeJobsUpdate: (
    callback: (jobs: DownloadJob[]) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, jobs: DownloadJob[]) => {
      callback(jobs);
    };
    ipcRenderer.on("youtube:jobsUpdate", listener);
    return () => ipcRenderer.removeListener("youtube:jobsUpdate", listener);
  },
  resetYouTubeBrowserSession: (): Promise<void> =>
    ipcRenderer.invoke("youtube:resetSession"),
  getSpotifyConfig: (): Promise<SpotifyConfig> =>
    ipcRenderer.invoke("spotify:getConfig"),
  saveSpotifyConfig: (config: SpotifyConfig): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:saveConfig", config),
  getSpotifyStatus: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:getStatus"),
  loginSpotify: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:login"),
  logoutSpotify: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:logout"),
  listSpotifyPlaylists: (): Promise<SpotifyPlaylist[]> =>
    ipcRenderer.invoke("spotify:listPlaylists"),
  listSpotifyPlaylistTracks: (
    playlistId: string
  ): Promise<SpotifyPlaylistTrack[]> =>
    ipcRenderer.invoke("spotify:listPlaylistTracks", playlistId),
  listSpotifySyncState: (playlistId: string): Promise<SpotifySyncTrack[]> =>
    ipcRenderer.invoke("spotify:listSyncState", playlistId),
  syncSpotifyPlaylist: (
    playlistId: string,
    autoTransfer: boolean
  ): Promise<SpotifySyncResult> =>
    ipcRenderer.invoke("spotify:syncPlaylist", playlistId, autoTransfer),
  onSpotifySyncUpdate: (
    callback: (update: SpotifySyncUpdate) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: SpotifySyncUpdate) => {
      callback(update);
    };
    ipcRenderer.on("spotify:syncUpdate", listener);
    return () => ipcRenderer.removeListener("spotify:syncUpdate", listener);
  },
  getTrainingHubStatus: (): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:getStatus"),
  loginTrainingHub: (
    email: string,
    password: string
  ): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:login", email, password),
  logoutTrainingHub: (): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:logout"),
  listTrainingHubActivities: (
    page: number,
    size: number
  ): Promise<TrainingHubActivity[]> =>
    ipcRenderer.invoke("trainingHub:listActivities", page, size),
  getTrainingHubActivityDetail: (
    activityId: string,
    sportType: number,
    listActivity?: TrainingHubActivity
  ): Promise<TrainingHubActivityDetail> =>
    ipcRenderer.invoke(
      "trainingHub:getActivityDetail",
      activityId,
      sportType,
      listActivity
    ),
  getTrainingHubActivityFileUrl: (
    activityId: string,
    sportType: number,
    fileType: TrainingHubActivityFileType
  ): Promise<string> =>
    ipcRenderer.invoke(
      "trainingHub:getActivityFileUrl",
      activityId,
      sportType,
      fileType
    ),
  getTrainingAnalytics: (): Promise<TrainingHubAnalytics> =>
    ipcRenderer.invoke("trainingHub:getTrainingAnalytics"),
  getRacePredictor: (): Promise<TrainingHubRacePredictor> =>
    ipcRenderer.invoke("trainingHub:getRacePredictor"),
  getTrainingDashboard: (): Promise<TrainingHubDashboard> =>
    ipcRenderer.invoke("trainingHub:getDashboard"),
  getDailyMetrics: (dateList: string[]): Promise<TrainingHubDailyMetrics> =>
    ipcRenderer.invoke("trainingHub:getDailyMetrics", dateList),
  getSportTypeMap: (): Promise<TrainingHubSportType[]> =>
    ipcRenderer.invoke("trainingHub:getSportTypeMap"),
  getUpcomingWorkouts: (
    days?: number
  ): Promise<TrainingHubUpcomingWorkout[]> =>
    ipcRenderer.invoke("trainingHub:getUpcomingWorkouts", days),
  getAppUpdateStatus: (): Promise<AppUpdateSnapshot> =>
    ipcRenderer.invoke("app:getUpdateStatus"),
  checkForAppUpdates: (): Promise<AppUpdateSnapshot> =>
    ipcRenderer.invoke("app:checkForUpdates"),
  quitAndInstallUpdate: (): Promise<void> =>
    ipcRenderer.invoke("app:quitAndInstallUpdate"),
  onAppUpdateStatus: (
    callback: (snapshot: AppUpdateSnapshot) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: AppUpdateSnapshot
    ) => {
      callback(snapshot);
    };
    ipcRenderer.on("app:updateStatus", listener);
    return () => ipcRenderer.removeListener("app:updateStatus", listener);
  }
};

contextBridge.exposeInMainWorld("corosLink", api);

export type CorosLinkApi = typeof api;
