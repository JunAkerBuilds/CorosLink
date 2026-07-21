import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import {
  corosSportName,
  enrichActivitiesWithSportNames,
  mergeSportTypeEntries
} from "./corosSportTypes";
import {
  countTrainingActivitiesMissingFeelType,
  countTrainingActivitiesSince,
  deleteSettings,
  getSetting,
  listStoredTrainingActivities,
  listTrainingActivitiesMissingFeelType,
  listTrainingActivityRpeInputs,
  setSetting,
  setTrainingActivityFeelType,
  upsertTrainingActivities
} from "./database";
import { buildRpeDistribution, dailyRpeLoad } from "./rpeLoad";
import type {
  ActivityPaceBaseline,
  ActivityPaceBaselines,
  RouteActivityType,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubActivityLap,
  TrainingHubExportFormat,
  TrainingHubActivityTrack,
  TrainingHubTrackPoint,
  TrainingHubAnalytics,
  TrainingHubDailyMetric,
  TrainingHubDailyMetrics,
  TrainingHubRacePredictor,
  TrainingHubRaceScore,
  TrainingHubSportStatistic,
  TrainingHubSportType,
  TrainingHubDashboard,
  TrainingHubPersonalRecord,
  TrainingHubPersonalRecordGroup,
  TrainingHubSleepHrvReading,
  TrainingHubSleepHrvSummary,
  TrainingHubStatus,
  TrainingHubLoginResult,
  TrainingHubThresholdZone,
  TrainingHubUpcomingWorkout,
  TrainingHubScheduledExercise,
  TrainingHubActivitySeriesPoint,
  TrainingHubZoneDistributionEntry,
  TrainingHubZoneDistributions,
  UploadPlanResult,
  UploadPlanResultEntry,
  CorosTrainingPlanDraftInput,
  PlanWorkoutEntryInput,
  DeleteWorkoutResult,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubLibraryWorkout,
  RunWorkoutEditorDraft,
  WorkoutEditPreview,
  WorkoutEditRef,
  WorkoutEditSaveResult,
  WorkoutEditorDocument
} from "./types";
import {
  applyWorkoutCalculation,
  buildWorkoutPayloadFromEntry,
  resetProgramForCreate,
  validatePlanDraft,
  type CorosWorkoutCalculation,
  type CorosTrainingPlanDraft,
  type PlanWorkoutEntry
} from "./corosWorkoutBuilder";
import {
  corosProgramToWorkoutDraft,
  parseWorkoutEditorContext,
  runWorkoutEditPreview,
  runWorkoutEditWrite,
  validateWorkoutDraft,
  workoutDraftsMatch,
  workoutDraftToCorosProgram,
  workoutEditRevision,
  type WorkoutEditSource
} from "./corosWorkoutEditor";
import { TRAINING_HUB_EXPORT_FORMATS } from "./types";
import { signRequest, sha256Hex } from "./awsSigV4";
import { createStoreZip } from "./zipStore";
import {
  regionFromBaseUrl,
  stsRequestUrl,
  decodeStsCredentials
} from "./corosUploadConfig";
import { parseStrengthDetail } from "./strengthDetail";
import {
  clearStoredCorosCredentials,
  getStoredCorosCredentials,
  hashCorosPassword,
  storeCorosCredentials
} from "./corosCredentialStore";

interface LoginResult {
  loginData: TrainingHubLoginData;
  loginBaseUrl: string;
}

const GLOBAL_BASE_URL = "https://teamapi.coros.com";
const LOGIN_URL = `${GLOBAL_BASE_URL}/account/login`;
const RESULT_SUCCESS = "0000";
const AUTH_ERROR_CODES = new Set(["0101", "0102", "1006"]);

// Email verification code for the 2FA login challenge: codeType 20, 6 digits.
const TWO_FACTOR_CODE_TYPE = 20;
const TWO_FACTOR_CODE_LENGTH = 2;
const COROS_LOGIN_LANGUAGE = "en-US";
const COROS_DEV_PREVIEW_COOKIE =
  "x-app-req-env=202607/; x-app-req-dev=feature-202607-dev; CPL-coros-region=1";

const REGION_BASE_URLS: Record<string, string> = {
  "0": "https://teamapi.coros.com",
  "1": "https://teamapi.coros.com",
  "2": "https://teameuapi.coros.com",
  "3": "https://teamapiap.coros.com",
  cn: "https://teamcnapi.coros.com",
  us: "https://teamapi.coros.com",
  eu: "https://teameuapi.coros.com",
  global: "https://teamapi.coros.com"
};

const REGION_PROBE_URLS = [
  "https://teamapi.coros.com",
  "https://teameuapi.coros.com",
  "https://teamcnapi.coros.com",
  "https://teamapiap.coros.com"
];

const SETTINGS = {
  accessToken: "trainingHub.accessToken",
  userId: "trainingHub.userId",
  regionId: "trainingHub.regionId",
  baseUrl: "trainingHub.baseUrl"
};

interface TrainingHubAuthState {
  accessToken: string;
  userId: string;
  regionId: string;
  baseUrl: string;
}

interface TrainingHubApiResponse<T> {
  result?: string;
  apiCode?: string;
  message?: string;
  data?: T;
}

interface TrainingHubLoginData {
  accessToken?: string;
  userId?: string | number;
  regionId?: string | number;
  twoFactorRequired?: boolean;
  // Present instead of accessToken when the account has 2FA enabled: the ticket
  // that must be echoed back to /account/2fa/login/verify along with the code.
  loginTicket?: string;
  appKey?: string;
  account?: string;
  accountType2fa?: string | number;
}

// A login that stopped at the 2FA challenge. Held in memory between the
// password step and the code-verify step (never persisted to disk).
interface PendingTwoFactorLogin {
  account: string;
  pwdHash: string;
  loginBaseUrl: string;
  loginTicket: string;
  appKey: string;
  accountType: string;
  regionId: string;
  userId?: string;
  remember: boolean;
}

// Discriminated result of the password step: either a fully-authenticated
// session, or a 2FA challenge whose pending state is stashed in `pendingTwoFactor`.
type BeginLoginOutcome =
  | { kind: "authenticated"; session: TrainingHubAuthState }
  | { kind: "twoFactor"; account: string };

let pendingTwoFactor: PendingTwoFactorLogin | null = null;

interface TrainingHubAccountData {
  userId?: string | number;
}

interface TrainingHubActivityListData {
  dataList?: RawTrainingHubActivity[];
}

interface RawTrainingHubActivity {
  labelId?: string;
  activityId?: string;
  name?: string;
  sportType?: number;
  sportName?: string;
  sport_name?: string;
  startTime?: number;
  endTime?: number;
  totalTime?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calorie?: number;
  trainingLoad?: number;
  ascent?: number;
}

interface TrainingHubDashboardData {
  summaryInfo?: Record<string, unknown>;
  sportDataSummary?: {
    count?: number;
    modelValidState?: boolean;
  };
}

interface TrainingHubSportListData {
  sportList?: RawSportType[];
  dataList?: RawSportType[];
}

interface RawSportType {
  sportType?: number;
  sportName?: string;
  name?: string;
}

interface RawDailyMetric {
  happenDay?: string | number;
  date?: string | number;
  day?: string | number;
  trainingLoad?: number;
  rhr?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  tiredRateNew?: number;
  tiredRateStateNew?: number;
  trainingLoadRatio?: number;
  staminaLevel?: number;
  vo2max?: number;
  distance?: number;
  totalDistance?: number;
  dis?: number;
  sportDis?: number;
  totalDis?: number;
  duration?: number;
  totalTime?: number;
  workoutTime?: number;
  sportTime?: number;
  time?: number;
}

interface RawRaceScore {
  type?: number;
  distance?: number;
  duration?: number;
  avgPace?: number;
  predictSecond?: number;
  predictTime?: number;
  time?: number;
  score?: number;
  raceType?: number | string;
  raceName?: string;
  [key: string]: unknown;
}

interface TrainingHubFileUrlData {
  fileUrl?: string;
}

export function getTrainingHubStatus(): TrainingHubStatus {
  const auth = getStoredAuth();
  const credentials = getStoredCorosCredentials();

  return {
    authenticated: Boolean(auth),
    userId: auth?.userId,
    regionId: auth?.regionId,
    baseUrl: auth?.baseUrl,
    rememberCredentials: Boolean(credentials),
    email: credentials?.account
  };
}

export async function loginTrainingHub(
  email: string,
  password: string,
  remember = false
): Promise<TrainingHubLoginResult> {
  const account = email.trim();
  if (!account || !password) {
    throw new Error("Enter your COROS email and password.");
  }

  const pwdHash = hashCorosPassword(password);
  const outcome = await beginTrainingHubLogin(account, pwdHash, {
    remember,
    interactive: true
  });

  if (outcome.kind === "twoFactor") {
    return {
      twoFactorRequired: true,
      status: getTrainingHubStatus(),
      email: outcome.account
    };
  }

  finalizeTrainingHubLogin(outcome.session, account, pwdHash, remember);
  return { twoFactorRequired: false, status: getTrainingHubStatus() };
}

// Complete the second half of a 2FA login by submitting the emailed code.
export async function verifyTrainingHubTwoFactor(
  code: string
): Promise<TrainingHubStatus> {
  const pending = pendingTwoFactor;
  if (!pending) {
    throw new Error("No COROS verification is in progress. Start again.");
  }

  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    throw new Error("Enter the 6-digit verification code sent to your email.");
  }

  const loginData = await verifyTwoFactorCode(pending, trimmed);
  const session = await completeSessionFromLogin(
    loginData,
    pending.loginBaseUrl,
    String(loginData.regionId ?? pending.regionId),
    pending.userId
  );

  finalizeTrainingHubLogin(
    session,
    pending.account,
    pending.pwdHash,
    pending.remember
  );
  pendingTwoFactor = null;
  return getTrainingHubStatus();
}

// Re-send the emailed 2FA code for the login currently awaiting verification.
export async function resendTrainingHubTwoFactorCode(): Promise<void> {
  const pending = pendingTwoFactor;
  if (!pending) {
    throw new Error("No COROS verification is in progress. Start again.");
  }
  await requestTwoFactorCode(
    pending.loginBaseUrl,
    pending.account,
    pending.accountType
  );
}

export function cancelTrainingHubTwoFactor(): void {
  pendingTwoFactor = null;
}

function finalizeTrainingHubLogin(
  session: TrainingHubAuthState,
  account: string,
  pwdHash: string,
  remember: boolean
): void {
  persistTrainingHubSession(session);
  if (remember) {
    storeCorosCredentials(account, pwdHash);
  } else {
    clearStoredCorosCredentials();
  }
}

function persistTrainingHubSession(session: TrainingHubAuthState): void {
  setSetting(SETTINGS.accessToken, session.accessToken);
  setSetting(SETTINGS.userId, session.userId);
  setSetting(SETTINGS.regionId, session.regionId);
  setSetting(SETTINGS.baseUrl, session.baseUrl);
}

// Perform the password step. Returns a completed session, or — when the account
// has 2FA enabled — stashes a pending challenge (after emailing the code, in
// interactive mode) and reports that verification is required.
async function beginTrainingHubLogin(
  account: string,
  pwdHash: string,
  options: { remember: boolean; interactive: boolean }
): Promise<BeginLoginOutcome> {
  pendingTwoFactor = null;

  const { loginData, loginBaseUrl } = await loginViaAnyBase(
    account,
    pwdHash,
    options.remember
  );
  const regionId =
    loginData.regionId === undefined ? "1" : String(loginData.regionId);

  if (loginData.accessToken) {
    const session = await completeSessionFromLogin(
      loginData,
      loginBaseUrl,
      regionId
    );
    return { kind: "authenticated", session };
  }

  const loginTicket = String(loginData.loginTicket ?? "").trim();
  const appKey = String(loginData.appKey ?? "").trim();
  if (!loginTicket || !appKey) {
    throw new Error("COROS returned an incomplete two-factor login challenge.");
  }

  if (!options.interactive) {
    throw new Error("COROS_TWO_FACTOR_REQUIRED");
  }

  const challengeAccount = String(loginData.account ?? "").trim() || account;
  const accountType = String(loginData.accountType2fa ?? "").trim() || "2";
  await requestTwoFactorCode(loginBaseUrl, challengeAccount, accountType);
  pendingTwoFactor = {
    account: challengeAccount,
    pwdHash,
    loginBaseUrl,
    loginTicket,
    appKey,
    accountType,
    regionId,
    userId:
      loginData.userId === undefined
        ? undefined
        : String(loginData.userId).trim(),
    remember: options.remember
  };
  return { kind: "twoFactor", account: challengeAccount };
}

// Turn a login/verify response that carries an accessToken into a full session
// (resolving the region base URL and user id).
async function completeSessionFromLogin(
  loginData: TrainingHubLoginData,
  loginBaseUrl: string,
  regionId: string,
  fallbackUserId = ""
): Promise<TrainingHubAuthState> {
  const accessToken = loginData.accessToken;
  if (!accessToken) {
    throw new Error("COROS login response did not include a usable token.");
  }

  const baseUrl = await resolveTrainingHubBaseUrl(accessToken, loginBaseUrl);

  let userId = String(loginData.userId ?? fallbackUserId).trim();
  const accountData = await queryTrainingHubAccount(accessToken, baseUrl);
  if (accountData?.userId !== undefined) {
    userId = String(accountData.userId).trim();
  }

  if (!userId) {
    throw new Error("COROS login response did not include a user ID.");
  }

  return { accessToken, userId, regionId, baseUrl };
}

// Silent re-authentication path (token refresh from stored credentials). Cannot
// prompt for a 2FA code, so a 2FA challenge here surfaces as a login failure.
async function establishTrainingHubSession(
  account: string,
  pwdHash: string
): Promise<TrainingHubAuthState> {
  const outcome = await beginTrainingHubLogin(account, pwdHash, {
    remember: true,
    interactive: false
  });
  if (outcome.kind !== "authenticated") {
    throw new Error("COROS_TWO_FACTOR_REQUIRED");
  }
  return outcome.session;
}

async function loginViaAnyBase(
  account: string,
  pwdHash: string,
  remember: boolean
): Promise<LoginResult> {
  const secret = buildCorosLoginSecret(pwdHash);
  const loginTargets = REGION_PROBE_URLS.map(
    (baseUrl) => [baseUrl, `${baseUrl}/account/login`] as const
  );

  let lastError: unknown;

  for (const [loginBaseUrl, loginUrl] of loginTargets) {
    try {
      const loginData = await loginAtBase(
        loginUrl,
        account,
        secret,
        remember
      );
      return { loginData, loginBaseUrl };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error && lastError.message) {
    throw lastError;
  }

  throw new Error(
    "COROS login failed. Check your email and password, then try again."
  );
}

// COROS's web login no longer accepts the raw MD5 digest. Instead it sends a
// bcrypt hash of that digest (p1) plus the salt used (p2); the server re-derives
// bcrypt(storedMd5, p2) and compares. Mirror that exactly.
export function buildCorosLoginSecret(
  pwdHash: string
): { p1: string; p2: string } {
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(pwdHash, salt);
  return { p1: hash, p2: salt };
}

export function buildCorosPasswordLoginPayload(
  account: string,
  secret: { p1: string; p2: string },
  remember: boolean
): Record<string, string | number> {
  const payload: Record<string, string | number> = {
    account,
    accountType: 2,
    p1: secret.p1,
    p2: secret.p2
  };
  if (remember) {
    payload.rmbm = 1;
  }
  return payload;
}

export function buildCorosTwoFactorCodePayload(
  account: string,
  accountType: string
): Record<string, string | number> {
  return {
    account,
    codeType: TWO_FACTOR_CODE_TYPE,
    lengthType: TWO_FACTOR_CODE_LENGTH,
    accountType
  };
}

export function buildCorosTwoFactorVerifyPayload(
  loginTicket: string,
  appKey: string,
  code: string
): Record<string, string> {
  return { loginTicket, appKey, code };
}

export function buildCorosLoginHeaders(options?: {
  suppressApiWarning?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    YFHeader: JSON.stringify({ language: COROS_LOGIN_LANGUAGE })
  };
  if (options?.suppressApiWarning) {
    headers["X-No-Warnning"] = "1";
  }
  // COROS currently gates the new 2FA API response behind its 202607 preview
  // environment. Only opt into that routing while running `npm run dev`;
  // packaged builds must follow COROS's normal production rollout.
  if (process.env.VITE_DEV_SERVER_URL) {
    headers.Cookie = COROS_DEV_PREVIEW_COOKIE;
  }
  return headers;
}

async function loginAtBase(
  url: string,
  account: string,
  secret: { p1: string; p2: string },
  remember: boolean
): Promise<TrainingHubLoginData> {
  const response = await fetch(url, {
    method: "POST",
    headers: buildCorosLoginHeaders(),
    body: JSON.stringify(
      buildCorosPasswordLoginPayload(account, secret, remember)
    )
  });

  if (!response.ok) {
    throw new Error(
      `COROS login request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TrainingHubApiResponse<TrainingHubLoginData>;
  const result = String(payload.result ?? payload.apiCode ?? "");

  if (result !== RESULT_SUCCESS) {
    throw new Error(payload.message || "COROS login failed.");
  }

  // Success may carry an accessToken (no 2FA) or a loginTicket (2FA required).
  if (!payload.data?.accessToken && !payload.data?.loginTicket) {
    throw new Error("COROS login response did not include a usable token.");
  }

  return payload.data;
}

// Ask COROS to email the 6-digit two-factor login code.
async function requestTwoFactorCode(
  loginBaseUrl: string,
  account: string,
  accountType: string
): Promise<void> {
  const response = await fetch(`${loginBaseUrl}/account/captcha`, {
    method: "POST",
    headers: buildCorosLoginHeaders(),
    body: JSON.stringify(buildCorosTwoFactorCodePayload(account, accountType))
  });

  if (!response.ok) {
    throw new Error(
      `COROS failed to send a verification code: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TrainingHubApiResponse<unknown>;
  const result = String(payload.result ?? payload.apiCode ?? "");
  if (result !== RESULT_SUCCESS) {
    throw new Error(
      payload.message || "COROS could not send a verification code."
    );
  }
}

// Exchange the emailed code + login ticket for a real access token.
async function verifyTwoFactorCode(
  pending: PendingTwoFactorLogin,
  code: string
): Promise<TrainingHubLoginData> {
  const response = await fetch(
    `${pending.loginBaseUrl}/account/2fa/login/verify`,
    {
      method: "POST",
      headers: buildCorosLoginHeaders({ suppressApiWarning: true }),
      body: JSON.stringify(
        buildCorosTwoFactorVerifyPayload(
          pending.loginTicket,
          pending.appKey,
          code
        )
      )
    }
  );

  if (!response.ok) {
    throw new Error(
      `COROS verification failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TrainingHubApiResponse<TrainingHubLoginData>;
  const result = String(payload.result ?? payload.apiCode ?? "");
  if (result !== RESULT_SUCCESS) {
    throw new Error(payload.message || "That verification code didn't work.");
  }
  if (!payload.data?.accessToken) {
    throw new Error("COROS verification did not return an access token.");
  }
  return payload.data;
}

async function queryTrainingHubAccount(
  accessToken: string,
  baseUrl: string
): Promise<TrainingHubAccountData | null> {
  try {
    const response = await fetch(`${baseUrl}/account/query`, {
      headers: buildTrainingHubHeaders(accessToken)
    });

    if (!response.ok) {
      return null;
    }

    const payload =
      (await response.json()) as TrainingHubApiResponse<TrainingHubAccountData>;
    const result = String(payload.result ?? payload.apiCode ?? "");

    if (result !== RESULT_SUCCESS || !payload.data) {
      return null;
    }

    return payload.data;
  } catch {
    return null;
  }
}

export function logoutTrainingHub(): TrainingHubStatus {
  pendingTwoFactor = null;
  clearTrainingHubAuth();
  clearStoredCorosCredentials();
  return getTrainingHubStatus();
}

/**
 * Re-establish a COROS session from the stored (encrypted) credentials without
 * asking the user to re-enter their password. Used by the "Reconnect" action
 * when the access token has expired but remembered credentials are available.
 *
 * When the account has 2FA enabled the saved password alone is not enough, so
 * this surfaces the same emailed-code challenge as a fresh login.
 */
export async function reconnectTrainingHub(): Promise<TrainingHubLoginResult> {
  const credentials = getStoredCorosCredentials();
  if (!credentials) {
    throw new Error(
      "Couldn't reconnect with saved credentials. Please log in again."
    );
  }

  const outcome = await beginTrainingHubLogin(
    credentials.account,
    credentials.pwdHash,
    { remember: true, interactive: true }
  );

  if (outcome.kind === "twoFactor") {
    return {
      twoFactorRequired: true,
      status: getTrainingHubStatus(),
      email: outcome.account
    };
  }

  finalizeTrainingHubLogin(
    outcome.session,
    credentials.account,
    credentials.pwdHash,
    true
  );
  return { twoFactorRequired: false, status: getTrainingHubStatus() };
}

export async function listTrainingHubActivities(
  page = 1,
  size = 50,
  startDay?: string,
  endDay?: string
): Promise<TrainingHubActivity[]> {
  const params: Record<string, string | number> = {
    size,
    pageNumber: page
  };
  // Verified live: /activity/query filters on startDay/endDay (YYYYMMDD);
  // startDate/endDate are ignored by this endpoint.
  if (startDay && endDay) {
    params.startDay = startDay;
    params.endDay = endDay;
  }
  const data = await trainingHubGet<TrainingHubActivityListData>(
    "/activity/query",
    params
  );

  const activities = enrichActivitiesWithSportNames(
    (data.dataList ?? []).map(mapTrainingHubActivity)
  );
  // Persist a local copy so analytics (e.g. personal pace) work offline and
  // across sessions without re-fetching from COROS.
  try {
    upsertTrainingActivities(activities);
  } catch {
    // Storage is best-effort; never block the activity list on it.
  }
  return activities;
}

export async function getTrainingHubActivityDetail(
  activityId: string,
  sportType: number,
  listActivity?: TrainingHubActivity
): Promise<TrainingHubActivityDetail> {
  const auth = getStoredAuth();
  const raw = await trainingHubRequest<Record<string, unknown>>(
    "/activity/detail/query",
    {
      method: "POST",
      params: {
        labelId: activityId,
        sportType,
        ...(auth?.userId ? { userId: auth.userId } : {})
      }
    }
  );

  let detail = parseActivityDetail(raw);
  // Opportunistically cache the end-of-activity feeling while we have the detail.
  cacheFeelTypeFromDetail(activityId, raw);
  if (listActivity) {
    detail = mergeActivityDetailWithList(detail, listActivity);
  }

  const sportName = corosSportName(
    detail.sportType ?? listActivity?.sportType ?? 0,
    detail.sportName ?? listActivity?.sportName
  );
  if (sportName) {
    detail = {
      ...detail,
      sportName
    };
  }

  const gpsPointCount =
    detail.track?.points.filter(
      (point) => point.lat !== undefined && point.lon !== undefined
    ).length ?? 0;

  if (gpsPointCount < 2) {
    const gpxTrack = await fetchActivityTrackFromGpx(activityId, sportType);
    if (gpxTrack) {
      detail = {
        ...detail,
        track: mergeActivityTracks(detail.track, gpxTrack)
      };
    }
  }

  return detail;
}

export async function getTrainingHubActivityFileUrl(
  activityId: string,
  sportType: number,
  fileType: TrainingHubActivityFileType = 4
): Promise<string> {
  const data = await trainingHubRequest<TrainingHubFileUrlData>(
    "/activity/detail/download",
    {
      method: "POST",
      params: {
        labelId: activityId,
        sportType,
        fileType
      }
    }
  );

  if (!data.fileUrl) {
    throw new Error("COROS did not return a file URL for this activity.");
  }

  return data.fileUrl;
}

export function getTrainingHubExportFormat(
  fileType: TrainingHubActivityFileType
): TrainingHubExportFormat {
  const format = TRAINING_HUB_EXPORT_FORMATS.find(
    (item) => item.fileType === fileType
  );

  if (!format) {
    throw new Error(`Unsupported COROS export file type: ${fileType}`);
  }

  return format;
}

// Resolves the COROS S3 URL for the requested format and downloads the raw file
// so the main process can write it to disk via a save dialog.
export async function fetchTrainingHubActivityFile(
  activityId: string,
  sportType: number,
  fileType: TrainingHubActivityFileType
): Promise<{ format: TrainingHubExportFormat; content: Buffer }> {
  const format = getTrainingHubExportFormat(fileType);
  const fileUrl = await getTrainingHubActivityFileUrl(
    activityId,
    sportType,
    fileType
  );

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download the ${format.label} file (HTTP ${response.status}).`
    );
  }

  const content = Buffer.from(await response.arrayBuffer());
  return { format, content };
}

export async function getTrainingAnalytics(): Promise<TrainingHubAnalytics> {
  const raw = await trainingHubGet<Record<string, unknown>>("/analyse/query");
  return parseAnalytics(raw);
}

export async function getTrainingDashboard(): Promise<TrainingHubDashboard> {
  const dashboard = await trainingHubGet<TrainingHubDashboardData>(
    "/dashboard/query"
  );

  return parseTrainingDashboard(dashboard);
}

export async function getRacePredictor(): Promise<TrainingHubRacePredictor> {
  const dashboard = await getTrainingDashboard();
  return dashboard.racePredictor;
}

// Pull sportFeelInfo.feelType out of a raw /activity/detail payload and cache
// it (0 = the user left it unrated; 1..5 = a smiley). The raw payload comes
// from a successful, envelope-validated response, so a missing/invalid
// sportFeelInfo genuinely means "never rated" — persist 0 in that case too,
// otherwise the row stays NULL and the backfill would refetch it forever.
function cacheFeelTypeFromDetail(
  activityId: string,
  raw: Record<string, unknown>
): void {
  try {
    const feelInfo = raw.sportFeelInfo as { feelType?: unknown } | undefined;
    const feelType = toOptionalNumber(feelInfo?.feelType);
    setTrainingActivityFeelType(
      activityId,
      feelType !== undefined && Number.isInteger(feelType) ? feelType : 0
    );
  } catch {
    // best-effort cache; never block the detail request on it.
  }
}

const HEATMAP_WINDOW_DAYS = 365;
// Query pending activities in chunks so the DB read stays small; the whole
// window is still drained in one background run.
const FEEL_BACKFILL_CHUNK = 50;
// Pause between detail fetches: each response is ~1 MB and a full window can
// be hundreds of activities, so pace the drain instead of hammering COROS.
const FEEL_BACKFILL_DELAY_MS = 400;
// Abort the run when the API errors repeatedly (down / rate-limiting us) …
const FEEL_BACKFILL_MAX_CONSECUTIVE_FAILURES = 5;
// … and refuse to start another run for a while afterwards.
const FEEL_BACKFILL_COOLDOWN_MS = 5 * 60 * 1000;
let feelBackfillRunning = false;
let feelBackfillCooldownUntil = 0;
// Activities whose detail fetch failed this session: left NULL in the DB so a
// future session retries them, but skipped for the rest of this one.
const feelBackfillFailedIds = new Set<string>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function heatmapWindowStartEpochSeconds(): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - HEATMAP_WINDOW_DAYS);
  return Math.floor(start.getTime() / 1000);
}

/** How much of the RPE backfill is left for the heatmap window. */
export function getRpeBackfillStatus(): {
  pending: number;
  running: boolean;
} {
  const since = heatmapWindowStartEpochSeconds();
  const missing = countTrainingActivitiesMissingFeelType(since);
  // Failed fetches stay NULL in the DB (a future session retries them) but
  // won't be refetched this session — report only what can still load now.
  const pending = Math.max(0, missing - feelBackfillFailedIds.size);
  return { pending, running: feelBackfillRunning };
}

/** Per-day Foster sRPE for the heatmap window, keyed by happenDay (YYYYMMDD). */
export function getRpeLoadByDay(): Record<string, number> {
  const since = heatmapWindowStartEpochSeconds();
  const byDay = dailyRpeLoad(listTrainingActivityRpeInputs(since));
  return Object.fromEntries(byDay);
}

// Fetch feelType for every activity in the heatmap window that was never
// fetched, draining the queue in one background run paced by
// FEEL_BACKFILL_DELAY_MS between requests. Fire-and-forget; guarded so only
// one run happens at once. Transient failures leave the row NULL (retried in
// a later session), and repeated failures abort the run and start a cooldown
// so a struggling API isn't hammered.
export async function backfillFeelTypes(): Promise<void> {
  if (feelBackfillRunning || Date.now() < feelBackfillCooldownUntil) {
    return;
  }
  if (!getStoredAuth()) {
    return;
  }
  feelBackfillRunning = true;
  try {
    const since = heatmapWindowStartEpochSeconds();
    const userId = getStoredAuth()?.userId;
    // Every activity touched this run, success or failure — filtered out of
    // each re-query so a row that stays NULL can't wedge the loop.
    const attempted = new Set<string>();
    let consecutiveFailures = 0;
    // Re-query each chunk: rows drop out of "missing" as we cache them. The
    // limit grows with the skip sets so unattempted rows stay reachable.
    for (;;) {
      const pending = listTrainingActivitiesMissingFeelType(
        since,
        FEEL_BACKFILL_CHUNK + attempted.size + feelBackfillFailedIds.size
      ).filter(
        ({ activityId }) =>
          !attempted.has(activityId) && !feelBackfillFailedIds.has(activityId)
      );
      if (pending.length === 0) {
        break;
      }
      for (const { activityId, sportType } of pending) {
        attempted.add(activityId);
        try {
          const raw = await trainingHubRequest<Record<string, unknown>>(
            "/activity/detail/query",
            {
              method: "POST",
              params: {
                labelId: activityId,
                sportType,
                ...(userId ? { userId } : {})
              }
            }
          );
          cacheFeelTypeFromDetail(activityId, raw);
          consecutiveFailures = 0;
        } catch {
          // Leave the row NULL so the fetch is retried in a future session;
          // skip it for the rest of this one.
          feelBackfillFailedIds.add(activityId);
          consecutiveFailures += 1;
          if (consecutiveFailures >= FEEL_BACKFILL_MAX_CONSECUTIVE_FAILURES) {
            feelBackfillCooldownUntil = Date.now() + FEEL_BACKFILL_COOLDOWN_MS;
            return;
          }
        }
        await delay(FEEL_BACKFILL_DELAY_MS);
      }
    }
  } finally {
    feelBackfillRunning = false;
  }
}

export async function getDailyMetrics(
  dateList: string[]
): Promise<TrainingHubDailyMetrics> {
  const sortedDates = [...dateList].sort();
  const startDay = sortedDates[0];
  const endDay = sortedDates[sortedDates.length - 1];

  if (!startDay || !endDay) {
    throw new Error("At least one date is required for daily metrics.");
  }

  const raw = await trainingHubGet<Record<string, unknown>>(
    "/analyse/dayDetail/query",
    {
      startDay,
      endDay
    }
  );

  const metrics = parseDailyMetrics(raw);

  // Attach per-day Foster sRPE from cached feelType, then top up the cache in
  // the background so coverage improves on the next load.
  try {
    const since = heatmapWindowStartEpochSeconds();
    const rpeByDay = dailyRpeLoad(listTrainingActivityRpeInputs(since));
    const dayByKey = new Map(
      metrics.dayList.map((day) => [day.happenDay, day])
    );
    for (const [happenDay, load] of rpeByDay) {
      if (load <= 0) {
        continue;
      }
      const existing = dayByKey.get(happenDay);
      if (existing) {
        existing.rpeLoad = load;
      } else {
        // A rated day COROS returned no daily metric for still needs to show.
        const day = { happenDay, rpeLoad: load };
        dayByKey.set(happenDay, day);
        metrics.dayList.push(day);
      }
    }
  } catch {
    // RPE is additive; never fail daily metrics if the cache read throws.
  }
  void backfillFeelTypes();

  return metrics;
}

export async function getSportTypeMap(): Promise<TrainingHubSportType[]> {
  try {
    const data = await trainingHubGet<TrainingHubSportListData>(
      "/activity/fit/getImportSportList"
    );
    const list = data.sportList ?? data.dataList ?? [];

    const fromApi = list
      .map((item) => ({
        sportType: item.sportType ?? 0,
        sportName: item.sportName ?? item.name ?? ""
      }))
      .filter((item) => item.sportType > 0 && item.sportName.trim());

    return mergeSportTypeEntries(fromApi);
  } catch {
    return mergeSportTypeEntries([]);
  }
}

// Each route sport maps to a COROS activity category so we compare like-for-like
// (a running route uses your runs, a bike route uses your rides, etc.).
type PaceCategory = "run" | "walk" | "hike" | "bike";

const CATEGORY_FOR_ACTIVITY: Record<RouteActivityType, PaceCategory> = {
  running: "run",
  walking: "walk",
  hiking: "hike",
  "cycling-road": "bike",
  "cycling-mountain": "bike"
};

// Substrings matched against the COROS sport name (lower-cased), in priority order.
const CATEGORY_KEYWORDS: Record<PaceCategory, string[]> = {
  run: ["run"],
  bike: ["bike", "cycl", "ride"],
  hike: ["hik"],
  walk: ["walk"]
};

// Plausible pace band per category in seconds/km — drops GPS junk and the rare
// mislabelled activity that slips through the name match.
const CATEGORY_PACE_BAND: Record<PaceCategory, [number, number]> = {
  run: [180, 720], // 3:00–12:00 /km
  walk: [540, 1500], // 9:00–25:00 /km
  hike: [480, 1800], // 8:00–30:00 /km
  bike: [60, 400] // ~9–60 km/h
};

const MIN_ACTIVITY_DISTANCE_METERS = 1000;
const MIN_PACE_SAMPLES = 3;

function categorizeSportName(name: string): PaceCategory | null {
  const lower = name.toLowerCase();
  for (const category of ["run", "bike", "hike", "walk"] as PaceCategory[]) {
    if (CATEGORY_KEYWORDS[category].some((keyword) => lower.includes(keyword))) {
      return category;
    }
  }
  return null;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Derives per-sport median pace from stored COROS activities so route time
 * estimates reflect *your* running/walking/hiking/cycling pace. Sports without
 * enough matching activities are omitted, so callers fall back to a default.
 */
export async function getActivityPaceBaselines(): Promise<ActivityPaceBaselines> {
  let activities = listStoredTrainingActivities();
  // Seed the local store from COROS on first use if the user is logged in.
  if (activities.length < 5 && getStoredAuth()) {
    try {
      await listTrainingHubActivities(1, 50);
      activities = listStoredTrainingActivities();
    } catch {
      // Offline or not authorised — fall back to whatever is stored.
    }
  }
  if (activities.length === 0) {
    return {};
  }

  // Resolve sport type → name; the activity list doesn't carry names itself.
  const sportNames = new Map<number, string>();
  try {
    for (const sport of await getSportTypeMap()) {
      sportNames.set(sport.sportType, sport.sportName);
    }
  } catch {
    // Without names we can't tell runs from walks, so bail to safe defaults.
  }

  const pacesByCategory: Record<PaceCategory, number[]> = {
    run: [],
    walk: [],
    hike: [],
    bike: []
  };

  for (const activity of activities) {
    const distance = activity.distance ?? 0;
    const duration = activity.duration ?? 0;
    if (distance < MIN_ACTIVITY_DISTANCE_METERS || duration <= 0) {
      continue;
    }
    const name = activity.sportName ?? sportNames.get(activity.sportType) ?? "";
    const category = categorizeSportName(name);
    if (!category) {
      continue;
    }
    const pace = duration / (distance / 1000);
    const [min, max] = CATEGORY_PACE_BAND[category];
    if (pace < min || pace > max) {
      continue;
    }
    pacesByCategory[category].push(pace);
  }

  const baselineByCategory: Partial<Record<PaceCategory, ActivityPaceBaseline>> =
    {};
  for (const category of Object.keys(pacesByCategory) as PaceCategory[]) {
    const samples = pacesByCategory[category];
    const value = median(samples);
    if (value !== undefined && samples.length >= MIN_PACE_SAMPLES) {
      baselineByCategory[category] = {
        secondsPerKm: Math.round(value),
        sampleSize: samples.length
      };
    }
  }

  const result: ActivityPaceBaselines = {};
  for (const activityType of Object.keys(
    CATEGORY_FOR_ACTIVITY
  ) as RouteActivityType[]) {
    const baseline = baselineByCategory[CATEGORY_FOR_ACTIVITY[activityType]];
    if (baseline) {
      result[activityType] = baseline;
    }
  }
  return result;
}

export async function getUpcomingWorkouts(
  days = 14
): Promise<TrainingHubUpcomingWorkout[]> {
  const { startDay, endDay } = upcomingScheduleDateRange(days);
  const raw = await trainingHubGet<Record<string, unknown>>(
    "/training/schedule/query",
    {
      startDate: startDay,
      endDate: endDay,
      supportRestExercise: 1
    }
  );

  return parseUpcomingWorkouts(raw, startDay);
}

/**
 * GROUNDWORK (not yet wired to the UI): push a generated route to the user's
 * COROS account so it syncs to the watch through the COROS phone app over
 * Bluetooth — the only viable one-click path from the desktop, since COROS
 * watches do not import routes over USB.
 *
 * This reuses the existing Training Hub session via `trainingHubRequest`
 * (handles token, region base-URL failover, and re-auth), so the only missing
 * piece is the actual COROS route/course upload endpoint + payload, which is
 * undocumented.
 *
 * To finish it, capture the request the COROS web app makes:
 *   1. Log into web.coros.com and open DevTools → Network.
 *   2. Import a GPX route (or create one) and watch for the upload request.
 *   3. Note the path (likely under `/route` / `/course` / `/nav`), HTTP method,
 *      and body shape (JSON vs. multipart form-data with the GPX/`.kml`).
 * Then replace the placeholder below with that path/body and remove the throw.
 */
export async function uploadRouteToCorosAccount(
  _name: string,
  _gpx: string
): Promise<void> {
  // Example of the intended call once the endpoint is known:
  //
  //   await trainingHubRequest<{ result: string }>("/route/import", {
  //     method: "POST",
  //     body: JSON.stringify({ name: _name, fileType: "gpx", content: _gpx })
  //   });
  //
  throw new Error(
    "Uploading routes to your COROS account is not available yet. Export the GPX and import it in the COROS phone app for now."
  );
}

/**
 * Upload a local .fit or .tcx activity file to the signed-in COROS account.
 * Reuses the stored Training Hub session (no separate COROS login).
 * Flow: STS credentials → zip the file → S3 PUT → POST /activity/fit/import.
 */
export async function uploadActivityFitToCoros(
  fitPath: string
): Promise<{ importId: string }> {
  const auth = getStoredAuth();
  if (!auth) {
    throw new Error("Not signed in to COROS. Log in to the Training Hub first.");
  }

  const ext = path.extname(fitPath).toLowerCase().replace(".", "");
  if (ext !== "fit" && ext !== "tcx") {
    throw new Error(`Unsupported file type ".${ext}" (only .fit or .tcx).`);
  }

  const fileBuf = fs.readFileSync(fitPath);
  const md5 = crypto.createHash("md5").update(fileBuf).digest("hex");
  const oriFileName = path.basename(fitPath);

  // 1. STS credentials (unauthenticated app-level request).
  const region = regionFromBaseUrl(auth.baseUrl);
  const stsResp = await fetch(stsRequestUrl(region));
  if (!stsResp.ok) {
    throw new Error(`COROS STS request failed: ${stsResp.status}`);
  }
  const stsJson = (await stsResp.json()) as {
    data?: { credentials?: string };
  };
  if (!stsJson.data?.credentials) {
    throw new Error("COROS STS response missing credentials.");
  }
  const sts = decodeStsCredentials(stsJson.data.credentials);

  // 2. Zip the file as <md5>/<oriFileName> and upload to S3.
  const zipBuf = createStoreZip([
    { name: `${md5}/${oriFileName}`, data: fileBuf }
  ]);
  const objectKey = `fit_zip/${auth.userId}/${md5}.zip`;
  const host = `${sts.Bucket}.s3.${sts.Region}.amazonaws.com`;
  const putUrl = `https://${host}/${objectKey}`;
  const payloadHash = sha256Hex(zipBuf);
  // Compute the timestamp once so the signed value and the sent header match.
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const { authorization } = signRequest({
    method: "PUT",
    url: putUrl,
    region: sts.Region,
    service: "s3",
    accessKeyId: sts.AccessKeyId,
    secretAccessKey: sts.SecretAccessKey,
    sessionToken: sts.SessionToken,
    payloadHash,
    amzDate,
    signedHeaders: {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "x-amz-security-token": sts.SessionToken
    }
  });
  const putResp = await fetch(putUrl, {
    method: "PUT",
    headers: {
      Host: host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "x-amz-security-token": sts.SessionToken,
      Authorization: authorization,
      "Content-Type": "application/zip"
    },
    body: zipBuf
  });
  if (!putResp.ok) {
    throw new Error(`S3 upload failed: ${putResp.status}`);
  }

  // 3. Register the import with COROS.
  const body = {
    source: 1,
    timezone: (-new Date().getTimezoneOffset() / 60) * 4,
    bucket: sts.Bucket,
    md5,
    size: zipBuf.byteLength,
    object: objectKey,
    serviceName: "aws",
    oriFileName
  };
  const form = new FormData();
  form.append("jsonParameter", JSON.stringify(body));
  const importResp = await fetch(`${auth.baseUrl}/activity/fit/import`, {
    method: "POST",
    headers: buildTrainingHubHeaders(auth.accessToken, auth.userId),
    body: form
  });
  if (!importResp.ok) {
    throw new Error(`COROS import failed: ${importResp.status}`);
  }
  const importJson = (await importResp.json()) as {
    result?: string;
    message?: string;
    data?: { importId?: string | number };
  };
  if (importJson.result && importJson.result !== "0000") {
    throw new Error(`COROS import rejected: ${importJson.message ?? "unknown"}`);
  }
  return { importId: String(importJson.data?.importId ?? "") };
}

export async function createWorkoutProgram(
  program: Record<string, unknown>
): Promise<{ programId: string; program: Record<string, unknown> }> {
  const payload = await calculateWorkoutProgram(program);
  const name = String(payload.name ?? "").trim();
  const rawId = await trainingHubPost<string | number>(
    "/training/program/add",
    payload,
    { allowEmptyData: true }
  );

  let programId =
    rawId !== undefined && rawId !== null && String(rawId).trim()
      ? String(rawId)
      : undefined;

  if (!programId && name) {
    const found = await findLibraryWorkoutByName(name);
    if (found?.id !== undefined && found.id !== null) {
      programId = String(found.id);
    }
  }

  if (!programId) {
    throw new Error(
      "Workout may have been created but COROS did not return a program ID."
    );
  }

  // Return the full payload we just wrote. /training/program/query is only a
  // library summary and can omit structured fields needed for scheduling.
  const fullProgram = {
    ...payload,
    id: programId
  } as Record<string, unknown>;

  return { programId, program: fullProgram };
}

export async function calculateWorkoutProgram(
  program: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const payload = resetProgramForCreate(program);
  const calculation = await trainingHubPost<CorosWorkoutCalculation>(
    "/training/program/calculate",
    payload
  );
  if (!calculation) {
    throw new Error("COROS did not return calculated workout metrics.");
  }
  return applyWorkoutCalculation(payload, calculation);
}

export async function scheduleWorkoutOnDate(
  program: Record<string, unknown>,
  happenDay: string,
  sortNo = 1
): Promise<void> {
  if (!/^\d{8}$/.test(happenDay)) {
    throw new Error("happenDay must be YYYYMMDD.");
  }

  const scheduleRaw = await trainingHubGet<Record<string, unknown>>(
    "/training/schedule/query",
    {
      startDate: happenDay,
      endDate: happenDay,
      supportRestExercise: 1
    }
  );

  const maxIdInPlan = toOptionalNumber(scheduleRaw.maxIdInPlan) ?? 0;
  const idInPlan = maxIdInPlan + 1;

  const programPayload = structuredClone(program);
  programPayload.idInPlan = idInPlan;

  const entity: Record<string, unknown> = {
    happenDay,
    idInPlan,
    sortNoInSchedule: sortNo
  };
  if (Array.isArray(programPayload.exerciseBarChart)) {
    entity.exerciseBarChart = structuredClone(programPayload.exerciseBarChart);
  }

  await trainingHubPostVoid("/training/schedule/update", {
    entities: [entity],
    programs: [programPayload],
    versionObjects: [{ id: idInPlan, status: 1 }],
    pbVersion: 2
  });
}

export async function listScheduledWorkoutEntries(
  startDay: string,
  endDay: string
): Promise<TrainingHubScheduledWorkoutEntry[]> {
  const raw = await trainingHubGet<Record<string, unknown>>(
    "/training/schedule/query",
    {
      startDate: startDay,
      endDate: endDay,
      supportRestExercise: 1
    }
  );
  return parseScheduledWorkoutEntries(raw);
}

export async function removeScheduledWorkout(entry: {
  planId: string;
  idInPlan: string;
  planProgramId?: string;
}): Promise<void> {
  const idInPlan = entry.idInPlan;
  await trainingHubPostVoid("/training/schedule/update", {
    versionObjects: [
      {
        id: idInPlan,
        planProgramId: entry.planProgramId ?? idInPlan,
        planId: entry.planId,
        status: 3
      }
    ],
    pbVersion: 2
  });
}

export async function deleteWorkoutProgram(programId: string): Promise<void> {
  const id = String(programId ?? "").trim();
  if (!id) {
    throw new Error("A program ID is required to delete a library workout.");
  }
  await trainingHubPostVoid("/training/program/delete", [id]);
}

export async function listWorkoutPrograms(): Promise<Record<string, unknown>[]> {
  return listLibraryWorkoutPrograms();
}

export async function listLibraryWorkouts(): Promise<TrainingHubLibraryWorkout[]> {
  const programs = await listLibraryWorkoutPrograms();
  return programs
    .filter((program) => program.id !== undefined && program.id !== null)
    .map((program) => ({
      id: String(program.id),
      name: pickString(program, ["name"]) ?? "Workout",
      sportType: toOptionalNumber(program.sportType),
      volume: formatUpcomingWorkoutVolume(program, {}),
      trainingLoad: resolveUpcomingWorkoutLoad(program, {}),
      createTimestamp: toOptionalNumber(program.createTimestamp)
    }))
    .sort((left, right) => (right.createTimestamp ?? 0) - (left.createTimestamp ?? 0));
}

async function resolveWorkoutEditSource(ref: WorkoutEditRef): Promise<WorkoutEditSource> {
  if (ref.kind === "library") {
    const program = await trainingHubGet<Record<string, unknown>>(
      "/training/program/detail",
      { id: ref.programId, supportRestExercise: 1 }
    );
    return { ref, program };
  }

  if (!/^\d{8}$/.test(ref.happenDay)) {
    throw new Error("Scheduled workout date must be YYYYMMDD.");
  }
  const raw = await trainingHubGet<Record<string, unknown>>(
    "/training/schedule/query",
    {
      startDate: ref.happenDay,
      endDate: ref.happenDay,
      supportRestExercise: 1
    }
  );
  const entities = extractArray(raw, ["entities"]) ?? [];
  const programs = extractArray(raw, ["programs"]) ?? [];
  const entityIndex = entities.findIndex((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    const item = candidate as Record<string, unknown>;
    return (
      String(item.planId ?? "") === ref.planId &&
      String(item.idInPlan ?? "") === ref.idInPlan &&
      String(item.happenDay ?? "") === ref.happenDay &&
      toOptionalNumber(item.status) !== 3
    );
  });
  if (entityIndex < 0) {
    throw new Error("Scheduled workout was not found on its original date.");
  }
  const entity = entities[entityIndex] as Record<string, unknown>;
  const maps = buildScheduledProgramMaps(programs);
  const program = resolveScheduledProgram(
    entity,
    entityIndex,
    maps.programsByIdInPlan,
    maps.programsById,
    programs
  );
  if (!program) {
    throw new Error("COROS did not return the scheduled workout program.");
  }
  return { ref, entity, program };
}

async function loadWorkoutEditorAccount(): Promise<Record<string, unknown>> {
  try {
    return await trainingHubGet<Record<string, unknown>>("/account/query");
  } catch {
    return {};
  }
}

async function documentFromWorkoutEditSource(
  source: WorkoutEditSource
): Promise<WorkoutEditorDocument> {
  const account = await loadWorkoutEditorAccount();
  const sportType = toOptionalNumber(source.program.sportType);
  const isPastOccurrence =
    source.ref.kind === "scheduled" &&
    source.ref.happenDay < formatScheduleDay(new Date());
  const canEdit = sportType === 1 && !isPastOccurrence;
  return {
    ref: source.ref,
    revision: workoutEditRevision(source),
    draft: corosProgramToWorkoutDraft(source.program),
    context: parseWorkoutEditorContext(account),
    canEdit,
    ...(canEdit
      ? {}
      : {
          unsupportedReason: isPastOccurrence
            ? "Past scheduled workouts are read-only."
            : "Only COROS Run workouts can be edited in this release."
        })
  };
}

export async function getWorkoutForEdit(
  ref: WorkoutEditRef
): Promise<WorkoutEditorDocument> {
  return documentFromWorkoutEditSource(await resolveWorkoutEditSource(ref));
}

export async function calculateExistingWorkoutProgram(
  program: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const payload = structuredClone(program);
  const calculation = await trainingHubPost<CorosWorkoutCalculation>(
    "/training/program/calculate",
    payload
  );
  if (!calculation) {
    throw new Error("COROS did not return calculated workout metrics.");
  }
  return applyWorkoutCalculation(payload, calculation);
}

function workoutEditEndpointAdapter() {
  return {
    calculate: calculateExistingWorkoutProgram,
    updateLibrary: (program: Record<string, unknown>) =>
      trainingHubPostVoid("/training/program/update", program),
    updateScheduled: (request: Record<string, unknown>) =>
      trainingHubPostVoid("/training/schedule/update", request),
    estimateScheduled: async (request: {
      entity: Record<string, unknown>;
      program: Record<string, unknown>;
    }) => {
      const estimate = await trainingHubPost<Record<string, unknown>>(
        "/training/program/estimate",
        request
      );
      if (!estimate) {
        throw new Error("COROS did not return a scheduled workout estimate.");
      }
      return estimate;
    }
  };
}

function previewFromProgram(program: Record<string, unknown>): WorkoutEditPreview {
  const durationSeconds =
    toOptionalNumber(program.planDuration) ??
    toOptionalNumber(program.duration) ??
    toOptionalNumber(program.estimatedTime);
  const distanceRaw =
    toOptionalNumber(program.planDistance) ??
    toOptionalNumber(program.distance) ??
    toOptionalNumber(program.estimatedDistance);
  const trainingLoad =
    toOptionalNumber(program.planTrainingLoad) ??
    toOptionalNumber(program.trainingLoad) ??
    toOptionalNumber(program.essence);
  return {
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(distanceRaw !== undefined ? { distanceMeters: distanceRaw / 100 } : {}),
    ...(trainingLoad !== undefined ? { trainingLoad } : {})
  };
}

function previewFromEstimate(raw: Record<string, unknown>): WorkoutEditPreview {
  const programPreview = previewFromProgram(raw);
  const currentDaySum = pickObject(raw, ["currentDaySum"]) ?? {};
  return {
    ...programPreview,
    ...(toOptionalNumber(currentDaySum.planCti) !== undefined
      ? { baseFitness: toOptionalNumber(currentDaySum.planCti) }
      : {}),
    ...(toOptionalNumber(currentDaySum.planAti) !== undefined
      ? { loadImpact: toOptionalNumber(currentDaySum.planAti) }
      : {}),
    ...(toOptionalNumber(currentDaySum.planTrainingLoadRatio) !== undefined
      ? {
          intensityTrendPercent:
            (toOptionalNumber(currentDaySum.planTrainingLoadRatio) ?? 0) *
            (Math.abs(toOptionalNumber(currentDaySum.planTrainingLoadRatio) ?? 0) <= 2
              ? 100
              : 1)
        }
      : {})
  };
}

export async function previewWorkoutEdit(
  ref: WorkoutEditRef,
  revision: string,
  draft: RunWorkoutEditorDraft
): Promise<WorkoutEditPreview> {
  const validation = validateWorkoutDraft(draft);
  if (!validation.valid) {
    throw new Error(Object.values(validation.errors)[0] ?? "Workout is invalid.");
  }
  const source = await resolveWorkoutEditSource(ref);
  if (ref.kind === "scheduled" && ref.happenDay < formatScheduleDay(new Date())) {
    throw new Error("Past scheduled workouts are read-only.");
  }
  if (workoutEditRevision(source) !== revision) {
    throw new Error("This workout changed in COROS. Reload it before continuing.");
  }
  const context = parseWorkoutEditorContext(await loadWorkoutEditorAccount());
  const program = workoutDraftToCorosProgram(source.program, draft, context);

  const result = await runWorkoutEditPreview(
    ref,
    source.entity,
    program,
    workoutEditEndpointAdapter()
  );
  return ref.kind === "scheduled"
    ? previewFromEstimate(result as Record<string, unknown>)
    : previewFromProgram(result as Record<string, unknown>);
}

async function verifyWorkoutEdit(
  ref: WorkoutEditRef,
  expected: RunWorkoutEditorDraft,
  calculated: Record<string, unknown>
): Promise<WorkoutEditSource | undefined> {
  const totalsMatch = (actual: Record<string, unknown>): boolean => {
    const fieldPairs: Array<[unknown, unknown]> = [
      [calculated.distance, actual.distance],
      [calculated.duration, actual.duration],
      [calculated.trainingLoad, actual.trainingLoad],
      [calculated.sets ?? calculated.totalSets, actual.sets ?? actual.totalSets]
    ];
    return fieldPairs.every(([expectedValue, actualValue]) => {
      const expectedNumber = toOptionalNumber(expectedValue);
      if (expectedNumber === undefined) {
        return true;
      }
      const actualNumber = toOptionalNumber(actualValue);
      return actualNumber !== undefined && Math.abs(expectedNumber - actualNumber) < 0.01;
    });
  };
  const delays = [0, 250, 600, 1_200];
  for (const waitMs of delays) {
    if (waitMs > 0) {
      await delay(waitMs);
    }
    try {
      const source = await resolveWorkoutEditSource(ref);
      if (workoutDraftsMatch(expected, source.program) && totalsMatch(source.program)) {
        return source;
      }
    } catch {
      // COROS is eventually consistent after updates; retry the read only.
    }
  }
  return undefined;
}

export async function saveWorkoutEdit(
  ref: WorkoutEditRef,
  revision: string,
  draft: RunWorkoutEditorDraft
): Promise<WorkoutEditSaveResult> {
  const validation = validateWorkoutDraft(draft);
  if (!validation.valid) {
    throw new Error(Object.values(validation.errors)[0] ?? "Workout is invalid.");
  }

  const source = await resolveWorkoutEditSource(ref);
  if (ref.kind === "scheduled" && ref.happenDay < formatScheduleDay(new Date())) {
    throw new Error("Past scheduled workouts are read-only.");
  }
  if (toOptionalNumber(source.program.sportType) !== 1) {
    throw new Error("Only COROS Run workouts can be edited in this release.");
  }
  if (workoutEditRevision(source) !== revision) {
    throw new Error("This workout changed in COROS. Reload it before saving.");
  }

  const context = parseWorkoutEditorContext(await loadWorkoutEditorAccount());
  const edited = workoutDraftToCorosProgram(source.program, draft, context);
  const calculated = await runWorkoutEditWrite(
    ref,
    source.entity,
    edited,
    workoutEditEndpointAdapter()
  );

  const verifiedSource = await verifyWorkoutEdit(ref, draft, calculated);
  let latestSource = verifiedSource;
  if (!latestSource) {
    try {
      latestSource = await resolveWorkoutEditSource(ref);
    } catch {
      latestSource = {
        ref,
        ...(source.entity ? { entity: source.entity } : {}),
        program: calculated
      };
    }
  }
  return {
    verified: Boolean(verifiedSource),
    ...(!verifiedSource
      ? {
          warning:
            "COROS accepted the save, but the updated workout could not be verified yet. The view was refreshed."
        }
      : {}),
    document: await documentFromWorkoutEditSource(latestSource)
  };
}

export async function scheduleLibraryWorkout(
  programId: string,
  happenDay: string
): Promise<void> {
  const id = String(programId);
  const program =
    (await getWorkoutProgramDetail(id)) ??
    (await findLibraryWorkoutById(id));
  if (!program) {
    throw new Error("Library workout not found.");
  }
  await scheduleWorkoutOnDate(program, happenDay);
}

export async function createAndScheduleWorkout(
  entryInput: PlanWorkoutEntryInput,
  happenDay: string,
  saveToLibrary = false
): Promise<{ programId?: string }> {
  const entry = toPlanWorkoutEntry(entryInput);
  const payload = buildWorkoutPayloadFromEntry(entry);
  // Schedule a calculated full payload, not the library query summary. The
  // summary omits fields needed by simple and structured workouts.
  let program: Record<string, unknown>;
  let programId: string | undefined;

  if (saveToLibrary) {
    const created = await createWorkoutProgram(payload);
    programId = created.programId;
    program = created.program;
  } else {
    program = await calculateWorkoutProgram(payload);
  }

  await scheduleWorkoutOnDate(program, happenDay, entryInput.sort_no ?? 1);
  return { programId };
}

/**
 * Move a scheduled workout to another day. COROS's /training/schedule/update
 * has no move semantics (versionObjects status 2 is rejected with 17004), so
 * this re-adds the workout on the new day first and only then deletes the old
 * entry — a failure part-way can duplicate the workout but never lose it.
 */
export async function rescheduleScheduledWorkout(
  entry: {
    planId: string;
    idInPlan: string;
    planProgramId?: string;
    happenDay: string;
  },
  newHappenDay: string
): Promise<void> {
  if (!/^\d{8}$/.test(newHappenDay)) {
    throw new Error("newHappenDay must be YYYYMMDD.");
  }
  if (newHappenDay === entry.happenDay) {
    return;
  }
  if (newHappenDay < formatScheduleDay(new Date())) {
    throw new Error("COROS does not allow scheduling workouts before today.");
  }

  const dayEntries = await listScheduledWorkoutEntries(
    entry.happenDay,
    entry.happenDay
  );
  const match = dayEntries.find(
    (candidate) =>
      candidate.planId === String(entry.planId) &&
      candidate.idInPlan === String(entry.idInPlan)
  );
  if (!match) {
    throw new Error("Scheduled workout not found on its original day.");
  }
  if (!match.rawProgram) {
    throw new Error("Scheduled workout has no program data to reschedule.");
  }

  await scheduleWorkoutOnDate(match.rawProgram, newHappenDay, match.sortNo ?? 1);
  await removeScheduledWorkout({
    planId: match.planId,
    idInPlan: match.idInPlan,
    planProgramId: match.planProgramId
  });
}

export async function deleteWorkout(options: {
  target: "scheduled" | "library" | "both";
  schedule_date?: string;
  workout_name?: string;
  program_id?: string;
  plan_id?: string;
  id_in_plan?: string;
  plan_program_id?: string;
}): Promise<DeleteWorkoutResult> {
  const target = options.target;
  const scheduleDate = options.schedule_date
    ? String(options.schedule_date).replace(/-/g, "")
    : undefined;
  const workoutName = options.workout_name?.trim();
  const programId = options.program_id?.trim();

  let removedFromSchedule = false;
  let removedFromLibrary = false;
  let resolvedProgramId = programId;
  let resolvedName = workoutName;

  if (target === "scheduled" || target === "both") {
    let scheduleEntry: TrainingHubScheduledWorkoutEntry | undefined;

    if (options.plan_id && options.id_in_plan) {
      const entries = scheduleDate
        ? await listScheduledWorkoutEntries(scheduleDate, scheduleDate)
        : await listScheduledWorkoutEntries(
            formatScheduleDay(new Date()),
            formatScheduleDay(
              new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            )
          );
      scheduleEntry = entries.find(
        (entry) =>
          entry.planId === String(options.plan_id) &&
          entry.idInPlan === String(options.id_in_plan)
      );
    } else if (scheduleDate && workoutName) {
      const entries = await listScheduledWorkoutEntries(
        scheduleDate,
        scheduleDate
      );
      const matches = entries.filter((entry) => entry.name === workoutName);
      if (matches.length > 1) {
        throw new Error(
          `Multiple scheduled workouts named "${workoutName}" on ${scheduleDate}. ` +
            "Use plan_id and id_in_plan to disambiguate."
        );
      }
      scheduleEntry = matches[0];
    } else {
      throw new Error(
        "Scheduled delete requires schedule_date + workout_name, or plan_id + id_in_plan."
      );
    }

    if (!scheduleEntry) {
      throw new Error("Scheduled workout not found on COROS calendar.");
    }

    await removeScheduledWorkout({
      planId: scheduleEntry.planId,
      idInPlan: scheduleEntry.idInPlan,
      planProgramId: scheduleEntry.planProgramId
    });
    removedFromSchedule = true;
    resolvedName = resolvedName ?? scheduleEntry.name;
    resolvedProgramId = resolvedProgramId ?? scheduleEntry.programId;
  }

  if (target === "library" || target === "both") {
    let libraryId = resolvedProgramId;
    if (!libraryId && workoutName) {
      const found = await findLibraryWorkoutByName(workoutName);
      libraryId =
        found?.id !== undefined && found.id !== null
          ? String(found.id)
          : undefined;
      resolvedName = resolvedName ?? (found?.name as string | undefined);
    }

    if (!libraryId) {
      if (target === "library") {
        throw new Error("Library workout not found.");
      }
    } else {
      await deleteWorkoutProgram(libraryId);
      removedFromLibrary = true;
      resolvedProgramId = libraryId;
    }
  }

  const parts: string[] = [];
  if (removedFromSchedule) {
    parts.push("removed from calendar");
  }
  if (removedFromLibrary) {
    parts.push("removed from library");
  }
  if (parts.length === 0) {
    throw new Error("Nothing was deleted.");
  }

  return {
    removedFromSchedule,
    removedFromLibrary,
    workoutName: resolvedName,
    scheduleDate,
    programId: resolvedProgramId,
    message: `Workout ${parts.join(" and ")}.`
  };
}

export function parseScheduledWorkoutEntries(
  raw: Record<string, unknown>
): TrainingHubScheduledWorkoutEntry[] {
  const entities = extractArray(raw, ["entities"]) ?? [];
  const programs = extractArray(raw, ["programs"]) ?? [];
  const { programsByIdInPlan, programsById } = buildScheduledProgramMaps(programs);

  const entries: TrainingHubScheduledWorkoutEntry[] = [];

  entities.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const entity = item as Record<string, unknown>;
    const status = toOptionalNumber(entity.status);

    if (status === 3) {
      return;
    }

    const happenDay = String(entity.happenDay ?? "");
    if (!/^\d{8}$/.test(happenDay)) {
      return;
    }

    const idInPlan = String(entity.idInPlan ?? "");
    const planProgramId = String(entity.planProgramId ?? "");
    const planId = String(entity.planId ?? "");
    const program = resolveScheduledProgram(
      entity,
      index,
      programsByIdInPlan,
      programsById,
      programs
    );

    entries.push({
      planId,
      idInPlan,
      planProgramId,
      happenDay,
      name: resolveUpcomingWorkoutName(program, entity),
      programId:
        program?.id !== undefined && program.id !== null
          ? String(program.id)
          : planProgramId || undefined,
      sportType: toOptionalNumber(program?.sportType ?? entity.sportType),
      sortNo: toOptionalNumber(entity.sortNoInSchedule ?? entity.sortNo),
      volume: formatUpcomingWorkoutVolume(program, entity),
      trainingLoad: resolveUpcomingWorkoutLoad(program, entity),
      exercises: parseScheduledExercises(program),
      rawProgram: program
    });
  });

  return entries.sort((left, right) => {
    if (left.happenDay !== right.happenDay) {
      return left.happenDay.localeCompare(right.happenDay);
    }
    return (left.sortNo ?? 0) - (right.sortNo ?? 0);
  });
}

function toPlanWorkoutEntry(entry: PlanWorkoutEntryInput): PlanWorkoutEntry {
  return {
    key: entry.key,
    name: entry.name,
    steps: entry.steps as PlanWorkoutEntry["steps"],
    distance_km: entry.distance_km,
    schedule_date: entry.schedule_date,
    sort_no: entry.sort_no,
    save_to_library: entry.save_to_library
  };
}

export async function uploadTrainingPlan(
  draftInput: CorosTrainingPlanDraftInput
): Promise<UploadPlanResult> {
  const draft: CorosTrainingPlanDraft = {
    name: draftInput.name,
    workouts: draftInput.workouts.map(toPlanWorkoutEntry)
  };

  const validation = validatePlanDraft(draft);
  if (!validation.ok) {
    throw new Error(validation.errors.join(" "));
  }

  const existingByDate = await loadExistingScheduleDates(draft);
  const entries: UploadPlanResultEntry[] = [];
  let workoutsCreated = 0;
  let workoutsScheduled = 0;
  const libraryPrograms = new Map<
    string,
    { programId: string; program: Record<string, unknown> }
  >();
  const calculatedPrograms = new Map<string, Record<string, unknown>>();

  for (const entry of draft.workouts) {
    const payload = buildWorkoutPayloadFromEntry(entry);
    const workoutSignature = JSON.stringify(payload);
    const saveToLibrary = entry.save_to_library !== false;
    // Schedule a calculated full payload, not the library query summary. The
    // summary omits fields needed by simple and structured workouts.
    let program: Record<string, unknown>;
    let programId: string | undefined;

    if (saveToLibrary) {
      let created = libraryPrograms.get(workoutSignature);
      if (!created) {
        created = await createWorkoutProgram(payload);
        libraryPrograms.set(workoutSignature, created);
        workoutsCreated += 1;
      }
      programId = created.programId;
      program = structuredClone(created.program);
    } else {
      let calculated = calculatedPrograms.get(workoutSignature);
      if (!calculated) {
        calculated = await calculateWorkoutProgram(payload);
        calculatedPrograms.set(workoutSignature, calculated);
      }
      program = structuredClone(calculated);
    }

    if (entry.schedule_date) {
      if (existingByDate.get(entry.schedule_date)?.length) {
        // Still schedule — user confirmed via UI; conflict was shown in preview.
      }
      const sortNo = entry.sort_no ?? 1;
      await scheduleWorkoutOnDate(program, entry.schedule_date, sortNo);
      workoutsScheduled += 1;
      entries.push({
        key: entry.key,
        name: entry.name,
        date: entry.schedule_date,
        programId,
        scheduled: true,
        savedToLibrary: saveToLibrary
      });
    } else {
      entries.push({
        key: entry.key,
        name: entry.name,
        programId,
        scheduled: false,
        savedToLibrary: saveToLibrary
      });
    }
  }

  return {
    planName: draft.name,
    workoutsCreated,
    workoutsScheduled,
    entries
  };
}

async function loadExistingScheduleDates(
  draft: CorosTrainingPlanDraft
): Promise<Map<string, string[]>> {
  const dates = [
    ...new Set(
      draft.workouts
        .map((entry) => entry.schedule_date)
        .filter((day): day is string => Boolean(day))
    )
  ].sort();

  if (dates.length === 0) {
    return new Map();
  }

  const startDay = dates[0]!;
  const endDay = dates[dates.length - 1]!;
  const raw = await trainingHubGet<Record<string, unknown>>(
    "/training/schedule/query",
    {
      startDate: startDay,
      endDate: endDay,
      supportRestExercise: 1
    }
  );

  const workouts = parseUpcomingWorkouts(raw, startDay);
  const byDate = new Map<string, string[]>();

  for (const workout of workouts) {
    const list = byDate.get(workout.happenDay) ?? [];
    list.push(workout.name);
    byDate.set(workout.happenDay, list);
  }

  return byDate;
}

async function trainingHubPost<T>(
  path: string,
  body: unknown,
  options?: { allowEmptyData?: boolean }
): Promise<T | undefined> {
  return trainingHubFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    allowEmptyData: options?.allowEmptyData
  });
}

async function trainingHubPostVoid(path: string, body: unknown): Promise<void> {
  await trainingHubPost(path, body, { allowEmptyData: true });
}

async function listLibraryWorkoutPrograms(): Promise<Record<string, unknown>[]> {
  const data = await trainingHubPost<unknown>("/training/program/query", {});
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

async function findLibraryWorkoutById(
  programId: string
): Promise<Record<string, unknown> | undefined> {
  const programs = await listLibraryWorkoutPrograms();
  return programs.find((program) => String(program.id ?? "") === programId);
}

async function getWorkoutProgramDetail(
  programId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    return await trainingHubGet<Record<string, unknown>>(
      "/training/program/detail",
      { id: programId, supportRestExercise: 1 }
    );
  } catch {
    return undefined;
  }
}

async function findLibraryWorkoutByName(
  name: string
): Promise<Record<string, unknown> | undefined> {
  const programs = await listLibraryWorkoutPrograms();
  const matches = programs.filter((program) => program.name === name);
  if (matches.length === 0) {
    return undefined;
  }

  return matches.sort((left, right) => {
    const leftTs = toOptionalNumber(left.createTimestamp) ?? 0;
    const rightTs = toOptionalNumber(right.createTimestamp) ?? 0;
    return rightTs - leftTs;
  })[0];
}

function upcomingScheduleDateRange(days: number): {
  startDay: string;
  endDay: string;
} {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + Math.max(0, days - 1));

  return {
    startDay: formatScheduleDay(start),
    endDay: formatScheduleDay(end)
  };
}

function formatScheduleDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function parseUpcomingWorkouts(
  raw: Record<string, unknown>,
  todayDay: string
): TrainingHubUpcomingWorkout[] {
  const entities = extractArray(raw, ["entities"]) ?? [];
  const programs = extractArray(raw, ["programs"]) ?? [];
  const { programsByIdInPlan, programsById } = buildScheduledProgramMaps(programs);

  const workouts: TrainingHubUpcomingWorkout[] = [];

  entities.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const entity = item as Record<string, unknown>;
    const status = toOptionalNumber(entity.status);

    if (status === 3) {
      return;
    }

    const happenDay = String(entity.happenDay ?? "");

    if (!/^\d{8}$/.test(happenDay) || happenDay < todayDay) {
      return;
    }

    const idInPlan = String(entity.idInPlan ?? "");
    const planProgramId = String(entity.planProgramId ?? "");
    const program = resolveScheduledProgram(
      entity,
      index,
      programsByIdInPlan,
      programsById,
      programs
    );

    workouts.push({
      happenDay,
      name: resolveUpcomingWorkoutName(program, entity),
      volume: formatUpcomingWorkoutVolume(program, entity),
      trainingLoad: resolveUpcomingWorkoutLoad(program, entity),
      sportType: toOptionalNumber(program?.sportType),
      sortNo: toOptionalNumber(entity.sortNoInSchedule ?? entity.sortNo),
      exercises: parseScheduledExercises(program)
    });
  });

  return workouts.sort((left, right) => {
    if (left.happenDay !== right.happenDay) {
      return left.happenDay.localeCompare(right.happenDay);
    }

    return (left.sortNo ?? 0) - (right.sortNo ?? 0);
  });
}

/**
 * Index schedule/query programs for entity lookup. `idInPlan` values repeat
 * across plans (the response can merge a training plan with the user's ad-hoc
 * schedule plan), so programs are additionally keyed by `planId|idInPlan`.
 */
function buildScheduledProgramMaps(programs: Record<string, unknown>[]): {
  programsByIdInPlan: Map<string, Record<string, unknown>>;
  programsById: Map<string, Record<string, unknown>>;
} {
  const programsByIdInPlan = new Map<string, Record<string, unknown>>();
  const programsById = new Map<string, Record<string, unknown>>();

  for (const item of programs) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const program = item as Record<string, unknown>;
    const idInPlan = program.idInPlan;

    if (idInPlan !== undefined && idInPlan !== null) {
      const planId = program.planId;
      if (planId !== undefined && planId !== null) {
        programsByIdInPlan.set(`${planId}|${idInPlan}`, program);
      }
      if (!programsByIdInPlan.has(String(idInPlan))) {
        programsByIdInPlan.set(String(idInPlan), program);
      }
    }

    if (program.id !== undefined && program.id !== null) {
      programsById.set(String(program.id), program);
    }
  }

  return { programsByIdInPlan, programsById };
}

function resolveScheduledProgram(
  entity: Record<string, unknown>,
  index: number,
  programsByIdInPlan: Map<string, Record<string, unknown>>,
  programsById: Map<string, Record<string, unknown>>,
  programs: Record<string, unknown>[]
): Record<string, unknown> | undefined {
  const planId = String(entity.planId ?? "");
  const planProgramId = String(entity.planProgramId ?? "");
  const idInPlan = String(entity.idInPlan ?? "");

  return (
    (planId && planProgramId
      ? programsByIdInPlan.get(`${planId}|${planProgramId}`)
      : undefined) ??
    (planId && idInPlan
      ? programsByIdInPlan.get(`${planId}|${idInPlan}`)
      : undefined) ??
    (planProgramId ? programsByIdInPlan.get(planProgramId) : undefined) ??
    (idInPlan ? programsByIdInPlan.get(idInPlan) : undefined) ??
    (planProgramId ? programsById.get(planProgramId) : undefined) ??
    (programs[index] && typeof programs[index] === "object"
      ? programs[index]
      : undefined)
  );
}

function resolveUpcomingWorkoutName(
  program: Record<string, unknown> | undefined,
  entity: Record<string, unknown>
): string {
  const sportData = pickObject(entity, ["sportData"]);

  return (
    (sportData ? pickString(sportData, ["name"]) : undefined) ??
    (program ? pickString(program, ["name"]) : undefined) ??
    pickString(entity, ["name"]) ??
    "Scheduled workout"
  );
}

function resolveUpcomingWorkoutLoad(
  program: Record<string, unknown> | undefined,
  entity: Record<string, unknown>
): number | undefined {
  const sportData = pickObject(entity, ["sportData"]);

  return (
    (sportData ? toOptionalNumber(sportData.trainingLoad) : undefined) ??
    (program ? toOptionalNumber(program.trainingLoad) : undefined) ??
    (program ? toOptionalNumber(program.essence) : undefined) ??
    (program ? toOptionalNumber(program.estimatedValue) : undefined)
  );
}

function corosWorkoutDistanceToMeters(value?: number): number {
  if (!value || value <= 0) {
    return 0;
  }

  // COROS schedule workout distance fields are stored in centimeters.
  return value / 100;
}

function formatUpcomingWorkoutVolume(
  program: Record<string, unknown> | undefined,
  entity: Record<string, unknown>
): string | undefined {
  const sportData = pickObject(entity, ["sportData"]);
  const setCount = resolveWorkoutSetCount(program);

  if (setCount > 1) {
    return `${setCount} set(s)`;
  }

  const distanceMeters =
    corosWorkoutDistanceToMeters(toOptionalNumber(sportData?.distance)) ||
    resolveWorkoutDistanceMeters(program);

  if (distanceMeters > 0) {
    return `${(distanceMeters / 1000).toFixed(2)}km`;
  }

  if (setCount > 0) {
    return `${setCount} set(s)`;
  }

  return undefined;
}

function resolveWorkoutDistanceMeters(
  program: Record<string, unknown> | undefined
): number {
  if (!program) {
    return 0;
  }

  const directDistance = corosWorkoutDistanceToMeters(
    toOptionalNumber(program.distance)
  );

  if (directDistance > 0) {
    return directDistance;
  }

  const estimatedDistance = corosWorkoutDistanceToMeters(
    toOptionalNumber(program.estimatedDistance)
  );

  if (estimatedDistance > 0) {
    return estimatedDistance;
  }

  // Simple distance runs come back with distance/estimatedDistance zeroed out —
  // COROS keeps the target only in the program-level targetType/targetValue
  // (targetType 5 = distance, targetValue in centimeters). Read it so the
  // calendar shows the planned km instead of Volume "--".
  const programTargetType = toOptionalNumber(program.targetType);
  const programTargetValue = toOptionalNumber(program.targetValue);

  if (programTargetType === 5 && programTargetValue && programTargetValue > 0) {
    return corosWorkoutDistanceToMeters(programTargetValue);
  }

  const exercises = Array.isArray(program.exercises) ? program.exercises : [];
  let total = 0;

  for (const item of exercises) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const exercise = item as Record<string, unknown>;
    const targetType = toOptionalNumber(exercise.targetType);
    const targetValue = toOptionalNumber(exercise.targetValue);
    const sets = Math.max(1, toOptionalNumber(exercise.sets) ?? 1);

    if (targetType === 5 && targetValue) {
      total += corosWorkoutDistanceToMeters(targetValue) * sets;
    }
  }

  return total;
}

function resolveWorkoutSetCount(
  program: Record<string, unknown> | undefined
): number {
  if (!program) {
    return 0;
  }

  const exerciseNum = toOptionalNumber(program.exerciseNum);

  if (exerciseNum && exerciseNum > 0) {
    return Math.round(exerciseNum);
  }

  const exercises = Array.isArray(program.exercises) ? program.exercises : [];

  for (const item of exercises) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const exercise = item as Record<string, unknown>;

    if (exercise.isGroup) {
      const groupSets = toOptionalNumber(exercise.sets);

      if (groupSets && groupSets > 0) {
        return Math.round(groupSets);
      }
    }
  }

  const totalSets =
    toOptionalNumber(program.totalSets) ??
    toOptionalNumber(program.sets);

  if (totalSets && totalSets > 0) {
    return Math.round(totalSets);
  }

  if (exercises.length === 0) {
    return 0;
  }

  return exercises.reduce((count, item) => {
    if (!item || typeof item !== "object") {
      return count;
    }

    const exercise = item as Record<string, unknown>;
    return count + Math.max(1, toOptionalNumber(exercise.sets) ?? 1);
  }, 0);
}

function mapTrainingHubActivity(
  raw: RawTrainingHubActivity
): TrainingHubActivity {
  const activityId = raw.labelId ?? raw.activityId ?? "";

  return {
    activityId,
    name: raw.name,
    sportType: raw.sportType ?? 0,
    sportName: raw.sportName ?? raw.sport_name,
    startTime: raw.startTime,
    endTime: raw.endTime,
    duration: raw.totalTime,
    distance: raw.distance,
    avgHr: raw.avgHr,
    maxHr: raw.maxHr,
    calories:
      raw.calorie && raw.calorie > 0
        ? Math.round(raw.calorie / 1000)
        : undefined,
    trainingLoad: raw.trainingLoad,
    elevationGain: raw.ascent
  };
}

function pickDailyMetricNumber(
  raw: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = toOptionalNumber(raw[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function normalizeDailyDistanceMeters(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  // COROS detail payloads store distance at 0.01 m precision (see activity detail parsing).
  if (value >= 100_000) {
    return value / 100;
  }

  return value;
}

function normalizeDailyDurationSeconds(value?: number): number | undefined {
  const normalized = normalizePersonalRecordDuration(value);
  return normalized === undefined ? undefined : Math.round(normalized);
}

function parseDailyMetric(raw: RawDailyMetric): TrainingHubDailyMetric {
  const record = raw as Record<string, unknown>;
  const distanceRaw = pickDailyMetricNumber(record, [
    "distance",
    "totalDistance",
    "dis",
    "sportDis",
    "totalDis"
  ]);
  const durationRaw = pickDailyMetricNumber(record, [
    "duration",
    "totalTime",
    "workoutTime",
    "sportTime",
    "time"
  ]);

  return {
    happenDay: String(raw.happenDay ?? raw.date ?? raw.day ?? ""),
    trainingLoad: toOptionalNumber(raw.trainingLoad),
    rhr: toOptionalNumber(raw.rhr),
    avgSleepHrv: toOptionalNumber(raw.avgSleepHrv),
    sleepHrvBase: toOptionalNumber(raw.sleepHrvBase),
    tiredRateNew: toOptionalNumber(raw.tiredRateNew),
    tiredRateStateNew: toOptionalNumber(raw.tiredRateStateNew),
    trainingLoadRatio: toOptionalNumber(raw.trainingLoadRatio),
    staminaLevel: toOptionalNumber(raw.staminaLevel),
    vo2max: toOptionalNumber(raw.vo2max),
    distance: normalizeDailyDistanceMeters(distanceRaw),
    duration: normalizeDailyDurationSeconds(durationRaw)
  };
}

export function parseDailyMetrics(raw: Record<string, unknown>): TrainingHubDailyMetrics {
  const dayList = extractDayList(raw).map((item) =>
    parseDailyMetric(item as RawDailyMetric)
  );
  const weekList = extractArray(raw, ["weekList", "evoLab.weekList"]);

  return {
    dayList,
    weekList,
    raw
  };
}

function parseAnalytics(raw: Record<string, unknown>): TrainingHubAnalytics {
  const dayList = extractDayList(raw).map((item) =>
    parseDailyMetric(item as RawDailyMetric)
  );
  const weekList = extractArray(raw, ["weekList", "evoLab.weekList"]);
  const sportStatistics = extractSportStatistics(raw);
  const summary = pickObject(raw, ["summaryInfo"]) ?? {};

  const fourWeeksAgoSec = Math.floor(
    (Date.now() - 28 * 24 * 60 * 60 * 1000) / 1000
  );
  const rpeDistribution = buildRpeDistribution(
    listTrainingActivityRpeInputs(fourWeeksAgoSec),
    countTrainingActivitiesSince(fourWeeksAgoSec)
  );

  return {
    dayList,
    weekList,
    sportStatistics,
    zoneDistributions: parseZoneDistributions(summary),
    rpeDistribution,
    raw
  };
}

function parseZoneDistributions(
  summary: Record<string, unknown>
): TrainingHubZoneDistributions {
  return {
    hrTrainingLoad: parseZoneDistributionEntries(summary.hrTlAreaList),
    hrDistance: parseZoneDistributionEntries(summary.hrDisAreaList),
    hrTime: parseZoneDistributionEntries(summary.hrTimeAreaList),
    distanceFrequency: parseZoneDistributionEntries(
      summary.distanceCountAreaList
    ),
    distanceTrainingLoad: parseZoneDistributionEntries(
      summary.distanceTlAreaList
    ),
    distanceTime: parseZoneDistributionEntries(summary.distanceTimeAreaList)
  };
}

function parseZoneDistributionEntries(
  raw: unknown
): TrainingHubZoneDistributionEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item): TrainingHubZoneDistributionEntry | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const entry = item as Record<string, unknown>;
      const index = toOptionalNumber(entry.index);

      if (index === undefined) {
        return null;
      }

      const ratio = toOptionalNumber(entry.ratio);
      const value = toOptionalNumber(entry.value);

      return {
        index,
        ...(ratio !== undefined ? { ratio } : {}),
        ...(value !== undefined ? { value } : {})
      };
    })
    .filter(
      (entry): entry is TrainingHubZoneDistributionEntry => entry !== null
    )
    .sort((left, right) => left.index - right.index);
}

const RECORD_TYPE_LABELS: Record<number, string> = {
  2: "Half Marathon",
  3: "15K",
  4: "10K",
  5: "5K",
  6: "3K",
  7: "1K",
  8: "1 Mile",
  9: "2 Mile",
  10: "3 Mile",
  11: "5 Mile",
  12: "10 Mile",
  13: "Marathon",
  101: "Longest Run",
  102: "Best Pace",
  103: "Most Elevation Gain"
};

const DISTANCE_PR_RECORD_TYPES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

const PERSONAL_RECORD_SLOT_TYPES = [103, 2, 13] as const;

const RECORD_TYPE_EXCLUDED = new Set([8, 9, 10, 11, 12, 102]);

const RECORD_DISPLAY_ORDER: Record<number, number> = {
  101: 0,
  103: 1,
  7: 2,
  6: 3,
  5: 4,
  4: 5,
  2: 6,
  13: 7
};

const DISTANCE_PR_DISTANCE_METERS: Record<number, number> = {
  2: 21097.5,
  3: 15000,
  4: 10000,
  5: 5000,
  6: 3000,
  7: 1000,
  8: 1609,
  9: 3218,
  10: 4828.032,
  11: 8046.72,
  12: 16093.44,
  13: 42195
};

const RACE_PREDICTOR_TYPE_LABELS: Record<number, string> = {
  5: "5K",
  4: "10K",
  2: "Half Marathon",
  1: "Marathon"
};

const RACE_PREDICTOR_TYPE_DISTANCE_METERS: Record<number, number> = {
  5: 5000,
  4: 10000,
  2: 21097,
  1: 42195
};

const RACE_PREDICTOR_DISPLAY_ORDER = [5, 4, 2, 1];

const RECORD_GROUP_LABELS: Record<number, string> = {
  1: "4 weeks",
  2: "Half year",
  3: "12 weeks",
  4: "All"
};

const RECORD_GROUP_DISPLAY_ORDER: Record<number, number> = {
  1: 0,
  3: 1,
  2: 2,
  4: 3
};

function parseTrainingDashboard(
  dashboard: TrainingHubDashboardData
): TrainingHubDashboard {
  const summary = dashboard.summaryInfo ?? {};
  const racePredictor = parseRacePredictor(summary);

  return {
    racePredictor,
    rhr: toOptionalNumber(summary.rhr),
    recoveryPct: toOptionalNumber(summary.recoveryPct),
    recoveryState: toOptionalNumber(summary.recoveryState),
    fullRecoveryHours: toOptionalNumber(summary.fullRecoveryHours),
    fitnessMaxHr: toOptionalNumber(summary.fitnessMaxHr),
    runningLevelHr: toOptionalNumber(summary.runningLevelHr),
    lthrZones: parseThresholdZones(summary.lthrZone),
    ltspZones: parseThresholdZones(summary.ltspZone),
    personalRecords: parsePersonalRecordGroups(summary.recordDetailList),
    sleepHrv: parseSleepHrvSummary(summary.sleepHrvData),
    sportDataCount: toOptionalNumber(dashboard.sportDataSummary?.count),
    raw: dashboard as Record<string, unknown>
  };
}

function parseThresholdZones(raw: unknown): TrainingHubThresholdZone[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const zones: TrainingHubThresholdZone[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const zone = item as Record<string, unknown>;
    const index = toOptionalNumber(zone.index);

    if (index === undefined) {
      continue;
    }

    zones.push({
      index,
      hr: toOptionalNumber(zone.hr),
      pace: toOptionalNumber(zone.pace),
      ratio: toOptionalNumber(zone.ratio)
    });
  }

  return zones.sort((left, right) => left.index - right.index);
}

const RECORD_TYPE_BEST_PACE = 102;
const RECORD_TYPE_LONGEST_RUN = 101;
const RECORD_TYPE_ELEVATION_GAIN = 103;

function isPlausiblePaceSecondsPerKm(value: number): boolean {
  return value >= 120 && value <= 900;
}

function corosCentimetersToMeters(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value / 100;
}

function normalizePersonalRecordDuration(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value >= 10_000 ? value / 100 : value;
}

function normalizeExplicitPersonalRecordDuration(
  value?: number
): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  // Current dashboard payloads expose `duration` directly in seconds. Other
  // fields such as legacy `record` values can still be centiseconds.
  return value;
}

function normalizePersonalRecordPace(
  type: number,
  record?: number,
  avgPace?: number
): number | undefined {
  if (avgPace !== undefined) {
    const normalized = normalizePersonalRecordPaceValue(avgPace);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  if (type === RECORD_TYPE_BEST_PACE && record !== undefined) {
    return normalizePersonalRecordPaceValue(record);
  }

  return undefined;
}

function normalizePersonalRecordPaceValue(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  if (isPlausiblePaceSecondsPerKm(value)) {
    return value;
  }

  const fromMilliseconds = value / 1000;
  if (isPlausiblePaceSecondsPerKm(fromMilliseconds)) {
    return fromMilliseconds;
  }

  const fromCentiseconds = value / 100;
  if (isPlausiblePaceSecondsPerKm(fromCentiseconds)) {
    return fromCentiseconds;
  }

  return undefined;
}

function derivePersonalRecordPaceFromDuration(
  type: number,
  duration?: number
): number | undefined {
  const knownDistance = DISTANCE_PR_DISTANCE_METERS[type];

  if (
    duration === undefined ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    knownDistance === undefined
  ) {
    return undefined;
  }

  return duration / (knownDistance / 1000);
}

function derivePersonalRecordPaceFromDistance(
  distanceMeters?: number,
  duration?: number
): number | undefined {
  if (
    distanceMeters === undefined ||
    duration === undefined ||
    distanceMeters <= 0 ||
    duration <= 0
  ) {
    return undefined;
  }

  return duration / (distanceMeters / 1000);
}

function resolveDistancePersonalRecordPace(
  type: number,
  duration?: number,
  rawAvgPace?: number
): number | undefined {
  return (
    derivePersonalRecordPaceFromDuration(type, duration) ??
    normalizePersonalRecordPace(type, undefined, rawAvgPace)
  );
}

function normalizeElevationGainMeters(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  if (value >= 10_000) {
    return Math.round(value / 100);
  }

  // COROS often encodes meters * 100 (8400 → 84 m).
  if (value >= 500 && Number.isInteger(value) && value % 100 === 0) {
    const fromCentimeters = value / 100;
    if (fromCentimeters >= 1 && fromCentimeters <= 5000) {
      return Math.round(fromCentimeters);
    }
  }

  return Math.round(value);
}

function resolveElevationGainMeters(raw: Record<string, unknown>): number | undefined {
  const candidates = [
    "record",
    "recordDis",
    "recordValue",
    "time",
    "distance",
    "ascent",
    "elevGain",
    "totalAscent",
    "value"
  ]
    .map((key) => normalizeElevationGainMeters(toOptionalNumber(raw[key])))
    .filter((value): value is number => value !== undefined && value > 0);

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.max(...candidates);
}

function isCorosFiveKPersonalRecord(
  raw: Record<string, unknown>,
  resolvedType: number
): boolean {
  if (resolvedType !== 5) {
    return true;
  }

  const rawType = toOptionalNumber(raw.type) ?? 0;

  if (rawType === 5) {
    return true;
  }

  const rawRecord = toOptionalNumber(raw.record);

  if (rawRecord !== undefined && rawRecord >= 10_000) {
    return true;
  }

  const distance = pickDistanceScalar(raw);

  if (distance === undefined) {
    return true;
  }

  return Math.abs(distance - 5000) <= 100;
}

function distancePersonalRecordQuality(
  record: TrainingHubPersonalRecord
): number {
  if (record.type !== 5) {
    return 0;
  }

  if (record.apiType === 5) {
    return 3;
  }

  if (
    record.distance !== undefined &&
    Math.abs(record.distance - 5000) <= 100
  ) {
    return 2;
  }

  return 1;
}

function inferDistanceRecordType(
  name: string,
  distanceMeters?: number
): number | undefined {
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "");

  const nameAliases: Record<string, number> = {
    "15k": 3,
    "15km": 3,
    "10k": 4,
    "10km": 4,
    "1k": 7,
    "1km": 7,
    "3k": 6,
    "3km": 6,
    "5k": 5,
    "5km": 5,
    "1mile": 8,
    "2mile": 9,
    "3mile": 10,
    "3mi": 10,
    "5mile": 11,
    "5mi": 11,
    halfmarathon: 2,
    "10mile": 12,
    "10mi": 12,
    marathon: 13
  };

  if (nameAliases[normalizedName]) {
    return nameAliases[normalizedName];
  }

  if (distanceMeters === undefined || distanceMeters <= 0) {
    return undefined;
  }

  const roundedDistance = Math.round(distanceMeters);
  const distanceAliases: Record<number, number> = {
    15000: 3,
    10000: 4,
    1000: 7,
    3000: 6,
    5000: 5,
    1609: 8,
    3218: 9,
    4828: 10,
    8047: 11,
    21097: 2,
    16093: 12,
    42195: 13
  };

  return distanceAliases[roundedDistance];
}

function isCorosBestPaceRecord(raw: Record<string, unknown>): boolean {
  const record = pickRecordScalar(raw);
  const avgPace = toOptionalNumber(raw.avgPace);

  if (record === undefined || avgPace === undefined) {
    return false;
  }

  const normalizedRecord = normalizePersonalRecordPaceValue(record);
  const normalizedAvgPace = normalizePersonalRecordPaceValue(avgPace);

  if (
    normalizedRecord === undefined ||
    normalizedAvgPace === undefined ||
    !isPlausiblePaceSecondsPerKm(normalizedRecord)
  ) {
    return false;
  }

  return Math.abs(normalizedRecord - normalizedAvgPace) <= 2;
}

function resolvePersonalRecordType(
  raw: Record<string, unknown>,
  type: number
): number {
  const name = pickString(raw, ["name", "site"])?.toLowerCase() ?? "";
  const rawDistance = pickDistanceScalar(raw);
  const rawRecord = pickRecordScalar(raw);

  if (name.includes("longest run") || name.includes("longest ride")) {
    return RECORD_TYPE_LONGEST_RUN;
  }

  if (
    name.includes("elevation") ||
    name.includes("elev gain") ||
    name.includes("elevgain") ||
    name.includes("most elev")
  ) {
    return RECORD_TYPE_ELEVATION_GAIN;
  }

  if (name.includes("best pace")) {
    return RECORD_TYPE_BEST_PACE;
  }

  if (type === 100) {
    return RECORD_TYPE_LONGEST_RUN;
  }

  // COROS uses type 102 for both best pace and most elevation gain.
  if (type === RECORD_TYPE_BEST_PACE) {
    return isCorosBestPaceRecord(raw)
      ? RECORD_TYPE_BEST_PACE
      : RECORD_TYPE_ELEVATION_GAIN;
  }

  // Earlier Training Hub payloads encoded metric 5K/10K records as types 10/11
  // without a distance and in centiseconds. Current payloads include the distance,
  // where those types correctly mean 3 and 5 miles respectively.
  if (rawDistance === undefined && rawRecord !== undefined && rawRecord >= 10_000) {
    if (type === 10) {
      return 5;
    }

    if (type === 11) {
      return 4;
    }
  }

  if (RECORD_TYPE_LABELS[type]) {
    return type;
  }

  const inferredType = inferDistanceRecordType(name, rawDistance);

  if (inferredType !== undefined) {
    return inferredType;
  }

  return type;
}

function normalizePersonalRecordLabelKey(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, "").replace(/\.0km$/, "km");

  const labelAliases: Record<string, string> = {
    "5k": "5km",
    "10k": "10km",
    "3k": "3km",
    "1k": "1km"
  };

  return labelAliases[normalized] ?? normalized;
}

function canonicalPersonalRecordKey(record: TrainingHubPersonalRecord): string {
  const aliases: Record<number, string> = {
    2: "halfmarathon",
    3: "15km",
    4: "10km",
    5: "5km",
    6: "3km",
    7: "1km",
    8: "1mile",
    9: "2mile",
    10: "3mile",
    11: "5mile",
    12: "10mile",
    13: "marathon",
    101: "longestrun",
    102: "bestpace",
    103: "mostelevationgain"
  };

  if (aliases[record.type]) {
    return aliases[record.type];
  }

  const inferredType = inferDistanceRecordType(record.label, record.distance);

  if (inferredType !== undefined && aliases[inferredType]) {
    return aliases[inferredType];
  }

  return normalizePersonalRecordLabelKey(record.label);
}

function isNativePersonalRecordType(
  apiType: number | undefined,
  resolvedType: number
): boolean {
  // Older Training Hub payloads used 10/11 for metric 5K/10K records.
  if (
    (apiType === 10 && resolvedType === 5) ||
    (apiType === 11 && resolvedType === 4)
  ) {
    return true;
  }

  return apiType === resolvedType && RECORD_TYPE_LABELS[resolvedType] !== undefined;
}

function isBetterPersonalRecord(
  candidate: TrainingHubPersonalRecord,
  current: TrainingHubPersonalRecord
): boolean {
  if (candidate.type === RECORD_TYPE_BEST_PACE) {
    return (
      (candidate.avgPace ?? Number.POSITIVE_INFINITY) <
      (current.avgPace ?? Number.POSITIVE_INFINITY)
    );
  }

  if (candidate.type === RECORD_TYPE_LONGEST_RUN) {
    return (candidate.distance ?? 0) > (current.distance ?? 0);
  }

  if (candidate.type === RECORD_TYPE_ELEVATION_GAIN) {
    const candidateNative = isNativePersonalRecordType(candidate.apiType, candidate.type);
    const currentNative = isNativePersonalRecordType(current.apiType, current.type);

    if (candidateNative && !currentNative) {
      return true;
    }

    if (!candidateNative && currentNative) {
      return false;
    }

    return (candidate.distance ?? 0) > (current.distance ?? 0);
  }

  if (DISTANCE_PR_RECORD_TYPES.has(candidate.type)) {
    const candidateQuality = distancePersonalRecordQuality(candidate);
    const currentQuality = distancePersonalRecordQuality(current);

    if (candidateQuality !== currentQuality) {
      return candidateQuality > currentQuality;
    }

    const candidateNative = isNativePersonalRecordType(candidate.apiType, candidate.type);
    const currentNative = isNativePersonalRecordType(current.apiType, current.type);

    if (candidateNative && !currentNative) {
      return true;
    }

    if (!candidateNative && currentNative) {
      return false;
    }

    const candidateDuration = candidate.duration ?? Number.POSITIVE_INFINITY;
    const currentDuration = current.duration ?? Number.POSITIVE_INFINITY;

    if (
      candidateNative &&
      currentNative &&
      candidate.happenDay &&
      candidate.happenDay === current.happenDay &&
      candidateDuration !== currentDuration
    ) {
      // Same-day duplicates are usually overlapping segments; COROS keeps the validated effort.
      return candidateDuration > currentDuration;
    }

    return candidateDuration < currentDuration;
  }

  return false;
}

function createPersonalRecordPlaceholder(
  type: number
): TrainingHubPersonalRecord {
  return {
    type,
    label: RECORD_TYPE_LABELS[type] ?? `Record ${type}`,
    duration: undefined,
    distance: undefined,
    avgPace: undefined,
    happenDay: undefined
  };
}

function ensurePersonalRecordSlots(
  records: TrainingHubPersonalRecord[]
): TrainingHubPersonalRecord[] {
  const presentTypes = new Set(records.map((record) => record.type));
  const placeholders = PERSONAL_RECORD_SLOT_TYPES.filter(
    (type) => !presentTypes.has(type)
  ).map((type) => createPersonalRecordPlaceholder(type));

  return [...records, ...placeholders];
}

function finalizePersonalRecords(
  records: TrainingHubPersonalRecord[]
): TrainingHubPersonalRecord[] {
  const deduped = new Map<string, TrainingHubPersonalRecord>();

  for (const record of records) {
    if (RECORD_TYPE_EXCLUDED.has(record.type)) {
      continue;
    }

    const key = canonicalPersonalRecordKey(record);
    const existing = deduped.get(key);

    if (!existing || isBetterPersonalRecord(record, existing)) {
      deduped.set(key, record);
    }
  }

  const sorted = [...deduped.values()].sort((left, right) => {
    const leftOrder = RECORD_DISPLAY_ORDER[left.type] ?? 99;
    const rightOrder = RECORD_DISPLAY_ORDER[right.type] ?? 99;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.label.localeCompare(right.label);
  });

  return ensurePersonalRecordSlots(sorted);
}

function isPersonalRecordEntryPopulated(
  record: TrainingHubPersonalRecord
): boolean {
  if (record.type === RECORD_TYPE_BEST_PACE) {
    return record.avgPace !== undefined && record.avgPace > 0;
  }

  if (record.type === RECORD_TYPE_LONGEST_RUN || record.type === RECORD_TYPE_ELEVATION_GAIN) {
    return record.distance !== undefined && record.distance > 0;
  }

  if (
    record.type === 5 &&
    record.distance !== undefined &&
    record.distance > 0 &&
    Math.abs(record.distance - 5000) > 100
  ) {
    return false;
  }

  return record.duration !== undefined && record.duration > 0;
}

export function parsePersonalRecordGroups(raw: unknown): TrainingHubPersonalRecordGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const group = item as Record<string, unknown>;
      const type = toOptionalNumber(group.type) ?? 0;
      const recordList = extractArray(group, ["recordList"]) ?? [];

      return {
        type,
        label: RECORD_GROUP_LABELS[type] ?? `Period ${type}`,
        records: finalizePersonalRecords(
          recordList
            .map((record) =>
              parsePersonalRecord(record as Record<string, unknown>, type)
            )
            .filter(
              (record, index) =>
                isPersonalRecordEntryPopulated(record) &&
                isCorosFiveKPersonalRecord(
                  recordList[index] as Record<string, unknown>,
                  record.type
                )
            )
        )
      };
    })
    .filter((group): group is TrainingHubPersonalRecordGroup => group !== null)
    .sort((left, right) => {
      const leftOrder = RECORD_GROUP_DISPLAY_ORDER[left.type] ?? 99;
      const rightOrder = RECORD_GROUP_DISPLAY_ORDER[right.type] ?? 99;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.type - right.type;
    });
}

function parsePersonalRecord(
  raw: Record<string, unknown>,
  _periodGroupType = 4
): TrainingHubPersonalRecord {
  const rawType = toOptionalNumber(raw.type) ?? 0;
  const type = resolvePersonalRecordType(raw, rawType);
  const rawRecord = pickRecordScalar(raw);
  const rawAvgPace = toOptionalNumber(raw.avgPace);
  const rawDistance = pickDistanceScalar(raw);
  const happenDay = normalizePersonalRecordDay(raw);
  let label = RECORD_TYPE_LABELS[type];

  if (!label && rawDistance && rawDistance > 0) {
    label =
      rawDistance >= 1000
        ? `${(rawDistance / 1000).toFixed(rawDistance % 1000 === 0 ? 0 : 1)} km`
        : `${Math.round(rawDistance)} m`;
  }

  if (!label) {
    label = pickString(raw, ["name", "site"]) ?? `Record ${type}`;
  }

  if (RECORD_TYPE_LABELS[type]) {
    label = RECORD_TYPE_LABELS[type];
  }

  if (type === RECORD_TYPE_BEST_PACE) {
    return {
      type,
      apiType: rawType,
      label,
      name: pickString(raw, ["name", "site"]),
      duration: undefined,
      distance: undefined,
      avgPace: normalizePersonalRecordPace(type, rawRecord, rawAvgPace),
      happenDay,
      activityId: pickString(raw, ["labelIdStr", "labelId"])
    };
  }

  if (type === RECORD_TYPE_LONGEST_RUN) {
    const distanceMeters = resolveLongestRunDistanceMeters(raw);
    const duration = resolveLongestRunDuration(raw, distanceMeters);
    const avgPace = resolveLongestRunAvgPace(
      raw,
      rawRecord,
      rawAvgPace,
      distanceMeters,
      duration
    );

    return {
      type,
      apiType: rawType,
      label,
      name: pickString(raw, ["name", "site"]),
      distance: distanceMeters,
      duration,
      avgPace,
      happenDay,
      activityId: pickString(raw, ["labelIdStr", "labelId"])
    };
  }

  if (type === RECORD_TYPE_ELEVATION_GAIN) {
    const elevationMeters = resolveElevationGainMeters(raw);
    const duration = normalizeExplicitPersonalRecordDuration(
      toOptionalNumber(raw.duration)
    );

    return {
      type,
      apiType: rawType,
      label,
      name: pickString(raw, ["name", "site"]),
      distance: elevationMeters,
      duration,
      avgPace: normalizePersonalRecordPace(type, rawRecord, rawAvgPace),
      happenDay,
      activityId: pickString(raw, ["labelIdStr", "labelId"])
    };
  }

  const duration = resolveDistancePersonalRecordDuration(type, raw);
  const avgPace = resolveDistancePersonalRecordPace(type, duration, rawAvgPace);

  return {
    type,
    apiType: rawType,
    label,
    name: pickString(raw, ["name", "site"]),
    distance: rawDistance && rawDistance > 0 ? rawDistance : undefined,
    duration,
    avgPace,
    happenDay,
    activityId: pickString(raw, ["labelIdStr", "labelId"])
  };
}

function parseSleepHrvSummary(
  raw: unknown
): TrainingHubSleepHrvSummary | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const data = raw as Record<string, unknown>;
  const readings: TrainingHubSleepHrvReading[] = [];

  if (Array.isArray(data.sleepHrvList)) {
    for (const item of data.sleepHrvList) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const reading = item as Record<string, unknown>;
      const happenDay = normalizeHappenDay(reading.happenDay);

      if (!happenDay) {
        continue;
      }

      readings.push({
        happenDay,
        avgSleepHrv: toOptionalNumber(reading.avgSleepHrv),
        sleepHrvBase: toOptionalNumber(reading.sleepHrvBase)
      });
    }
  }

  return {
    happenDay: normalizeHappenDay(data.happenDay),
    avgSleepHrv: toOptionalNumber(data.avgSleepHrv),
    sleepHrvBase: toOptionalNumber(data.sleepHrvBase),
    remainWearDays: toOptionalNumber(data.remainWearDays),
    recentReadings: readings
  };
}

function normalizeHappenDay(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = String(value).trim();

  if (/^\d{8}$/.test(text) && text !== "00000000") {
    return text;
  }

  return undefined;
}

function normalizePersonalRecordDay(
  raw: Record<string, unknown>
): string | undefined {
  for (const key of ["happenDay", "date", "recordDay", "day"]) {
    const happenDay = normalizeHappenDay(raw[key]);

    if (happenDay) {
      return happenDay;
    }
  }

  return undefined;
}

function pickRecordScalar(raw: Record<string, unknown>): number | undefined {
  for (const key of ["record", "recordValue", "value", "best"]) {
    const value = toOptionalNumber(raw[key]);

    if (value !== undefined && value > 0) {
      return value;
    }
  }

  return undefined;
}

function pickNormalizedPersonalRecordDuration(
  raw: Record<string, unknown>,
  key: string
): number | undefined {
  const value = toOptionalNumber(raw[key]);
  return key === "duration"
    ? normalizeExplicitPersonalRecordDuration(value)
    : normalizePersonalRecordDuration(value);
}

function resolveDistancePersonalRecordDuration(
  type: number,
  raw: Record<string, unknown>
): number | undefined {
  const explicitDuration = pickNormalizedPersonalRecordDuration(raw, "duration");

  if (explicitDuration !== undefined) {
    return explicitDuration;
  }

  const validatedDuration = pickNormalizedPersonalRecordDuration(raw, "best");

  if (validatedDuration !== undefined) {
    return validatedDuration;
  }

  const candidates = [
    pickNormalizedPersonalRecordDuration(raw, "record"),
    pickNormalizedPersonalRecordDuration(raw, "time"),
    pickNormalizedPersonalRecordDuration(raw, "recordValue"),
    pickNormalizedPersonalRecordDuration(raw, "duration")
  ].filter((value): value is number => value !== undefined && value > 0);

  if (candidates.length === 0) {
    return undefined;
  }

  let duration = Math.max(...candidates);

  const knownDistance = DISTANCE_PR_DISTANCE_METERS[type];
  const normalizedPace = normalizePersonalRecordPaceValue(toOptionalNumber(raw.avgPace));

  if (knownDistance !== undefined && normalizedPace !== undefined) {
    const durationFromPace = normalizedPace * (knownDistance / 1000);
    const delta = durationFromPace - duration;

    // COROS sometimes stores average-pace extrapolation in `record` (e.g. timer * 5km / distance)
    // while the validated best-effort time matches `avgPace` (see activity 478506322034196580.fit).
    if (delta > 5 && delta < 120) {
      duration = durationFromPace;
    }
  }

  return duration;
}

function resolveLongestRunDuration(
  raw: Record<string, unknown>,
  distanceMeters?: number
): number | undefined {
  const explicitDuration = normalizeExplicitPersonalRecordDuration(
    toOptionalNumber(raw.duration)
  );

  if (explicitDuration !== undefined) {
    return explicitDuration;
  }

  const timeDuration = normalizePersonalRecordDuration(toOptionalNumber(raw.time));

  if (
    timeDuration !== undefined &&
    distanceMeters !== undefined &&
    isPlausiblePaceSecondsPerKm(timeDuration / (distanceMeters / 1000))
  ) {
    return timeDuration;
  }

  return undefined;
}

function resolveLongestRunAvgPace(
  raw: Record<string, unknown>,
  rawRecord?: number,
  rawAvgPace?: number,
  distanceMeters?: number,
  duration?: number
): number | undefined {
  const fromApi = normalizePersonalRecordPace(
    RECORD_TYPE_LONGEST_RUN,
    rawRecord,
    rawAvgPace
  );

  if (fromApi !== undefined) {
    return fromApi;
  }

  const derived = derivePersonalRecordPaceFromDistance(distanceMeters, duration);

  if (derived !== undefined && isPlausiblePaceSecondsPerKm(derived)) {
    return derived;
  }

  return undefined;
}

function pickDistanceScalar(raw: Record<string, unknown>): number | undefined {
  for (const key of ["distance", "totalDistance", "dis", "recordDis"]) {
    const value = toOptionalNumber(raw[key]);

    if (value !== undefined && value > 0) {
      return value;
    }
  }

  return undefined;
}

function normalizeLongestRunDistanceScalar(value: number): number | undefined {
  if (value >= 100_000) {
    return value / 100;
  }

  if (value >= 1000) {
    return value;
  }

  if (value >= 100) {
    return value * 10;
  }

  const fromCentimeters = value / 100;

  if (fromCentimeters >= 1) {
    return fromCentimeters;
  }

  return undefined;
}

function resolveLongestRunDistanceMeters(
  raw: Record<string, unknown>
): number | undefined {
  const rawRecord = pickRecordScalar(raw);

  if (rawRecord !== undefined) {
    const fromRecord = normalizeLongestRunDistanceScalar(rawRecord);

    if (fromRecord !== undefined) {
      return fromRecord;
    }
  }

  const rawDistance = pickDistanceScalar(raw);

  if (rawDistance !== undefined) {
    return normalizeLongestRunDistanceScalar(rawDistance);
  }

  return undefined;
}

export function parseRacePredictor(
  summary: Record<string, unknown>
): TrainingHubRacePredictor {
  const rawList = Array.isArray(summary.runScoreList) ? summary.runScoreList : [];
  const parsedByType = new Map<number, TrainingHubRaceScore>();

  for (const item of rawList) {
    const parsed = parseRaceScore(item as RawRaceScore);

    if (parsed.predictSeconds === undefined) {
      continue;
    }

    const raceType = resolveRacePredictorType(item as RawRaceScore);

    if (raceType !== undefined) {
      parsedByType.set(raceType, parsed);
    } else {
      parsedByType.set(parsedByType.size, parsed);
    }
  }

  const runScoreList = RACE_PREDICTOR_DISPLAY_ORDER.map((type) =>
    parsedByType.get(type)
  ).filter((entry): entry is TrainingHubRaceScore => entry !== undefined);

  if (runScoreList.length === 0) {
    for (const entry of parsedByType.values()) {
      runScoreList.push(entry);
    }
  }

  return {
    staminaLevel: toOptionalNumber(summary.staminaLevel),
    recoveryPct: toOptionalNumber(summary.recoveryPct),
    aerobicEnduranceScore: toOptionalNumber(summary.aerobicEnduranceScore),
    lactateThresholdCapacityScore: toOptionalNumber(
      summary.lactateThresholdCapacityScore
    ),
    anaerobicEnduranceScore: toOptionalNumber(summary.anaerobicEnduranceScore),
    anaerobicCapacityScore: toOptionalNumber(summary.anaerobicCapacityScore),
    lthr: toOptionalNumber(summary.lthr),
    ltsp: toOptionalNumber(summary.ltsp),
    runScoreList,
    raw: summary
  };
}

function resolveRacePredictorType(raw: RawRaceScore): number | undefined {
  const raceType = toOptionalNumber(raw.type) ?? toOptionalNumber(raw.raceType);

  if (raceType === undefined) {
    return undefined;
  }

  return Math.trunc(raceType);
}

function parseRaceScore(raw: RawRaceScore): TrainingHubRaceScore {
  const raceType = resolveRacePredictorType(raw);
  const distance =
    toOptionalNumber(raw.distance) ??
    (raceType !== undefined
      ? RACE_PREDICTOR_TYPE_DISTANCE_METERS[raceType]
      : undefined);
  const predictSeconds =
    toOptionalNumber(raw.duration) ??
    toOptionalNumber(raw.predictSecond) ??
    toOptionalNumber(raw.predictTime) ??
    toOptionalNumber(raw.time);
  const distanceLabel =
    (raceType !== undefined ? RACE_PREDICTOR_TYPE_LABELS[raceType] : undefined) ??
    formatRaceDistanceLabel(distance, raw.raceName, raw.raceType);

  return {
    distance,
    distanceLabel,
    predictSeconds,
    avgPace: toOptionalNumber(raw.avgPace),
    score: toOptionalNumber(raw.score),
    raw
  };
}

function normalizeActivityDuration(value?: number): number | undefined {
  const normalized = normalizePersonalRecordDuration(value);
  return normalized === undefined ? undefined : Math.round(normalized);
}

// Epoch-second bounds for a sane activity date (2001-01-01 .. 2100-01-01).
const MIN_ACTIVITY_EPOCH_SECONDS = 978_307_200;
const MAX_ACTIVITY_EPOCH_SECONDS = 4_102_444_800;

function normalizeActivityStartTimeSeconds(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  // COROS mixes units per endpoint: the list API sends epoch seconds while
  // detail payloads store startTimestamp at 0.01 s precision (same x100
  // convention as distance/totalTime). Scale by whichever divisor lands in a
  // sane date range; anything else is garbage and the list value wins.
  for (const divisor of [1, 100, 1000]) {
    const seconds = value / divisor;
    if (
      seconds >= MIN_ACTIVITY_EPOCH_SECONDS &&
      seconds < MAX_ACTIVITY_EPOCH_SECONDS
    ) {
      return Math.round(seconds);
    }
  }

  return undefined;
}

function normalizeCorosDetailDistanceMeters(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  // COROS detail payloads store distance at 0.01 m precision (see splitlog cmToKm / 100_000).
  return value / 100;
}

function normalizeActivityDistanceMeters(value?: number): number | undefined {
  return normalizeCorosDetailDistanceMeters(value);
}

function normalizeActivityElevationMeters(value?: number): number | undefined {
  return normalizeElevationGainMeters(value);
}

function normalizeActivityCalories(value: unknown): number | undefined {
  const numeric = toOptionalNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  return numeric > 1000 ? Math.round(numeric / 1000) : Math.round(numeric);
}

function pickActivityCalories(
  raw: Record<string, unknown>,
  summary: Record<string, unknown>
): number | undefined {
  return normalizeActivityCalories(
    raw.calorie ?? raw.calories ?? summary.calorie ?? summary.calories
  );
}

function pickActivityNumber(
  raw: Record<string, unknown>,
  summary: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const fromRaw = toOptionalNumber(raw[key]);
    if (fromRaw !== undefined) {
      return fromRaw;
    }

    const fromSummary = toOptionalNumber(summary[key]);
    if (fromSummary !== undefined) {
      return fromSummary;
    }
  }

  return undefined;
}

function isPopulatedActivityLap(lap: TrainingHubActivityLap): boolean {
  return (
    (lap.distance !== undefined && lap.distance > 0) ||
    (lap.duration !== undefined && lap.duration > 0)
  );
}

function flattenLapItems(entry: unknown): Record<string, unknown>[] {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  const lap = entry as Record<string, unknown>;
  const nested = pickArray(lap, ["lapItemList", "itemList", "items"]);

  if (nested?.length) {
    return nested.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object"
    );
  }

  return [lap];
}

function lapGroupSignature(items: Record<string, unknown>[]): string {
  return JSON.stringify(
    items.map((item) => [
      item.distance ?? item.totalDistance,
      item.totalTime ?? item.duration
    ])
  );
}

function hasNestedLapItems(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const lap = entry as Record<string, unknown>;
  const nested = pickArray(lap, ["lapItemList", "itemList", "items"]);
  return Boolean(nested?.length);
}

function extractActivityLaps(raw: Record<string, unknown>): TrainingHubActivityLap[] {
  const summary = pickObject(raw, ["summaryInfo", "summary", "activitySummary"]) ?? raw;
  const candidateGroups: Record<string, unknown>[][] = [];
  const seen = new Set<string>();

  for (const source of [raw, summary]) {
    const lapList = pickArray(source, ["lapList", "laps", "lapInfoList"]) ?? [];

    if (lapList.length === 0) {
      continue;
    }

    const usesNestedLaps = lapList.some((entry) => hasNestedLapItems(entry));

    if (!usesNestedLaps) {
      const flatLaps = lapList.map((item, index) => parseActivityLap(item, index));

      if (flatLaps.some(isPopulatedActivityLap)) {
        return flatLaps.map((lap, index) => ({ ...lap, index: index + 1 }));
      }
    }

    for (const entry of lapList) {
      const items = flattenLapItems(entry);
      if (items.length === 0) {
        continue;
      }

      const signature = lapGroupSignature(items);
      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      candidateGroups.push(items);
    }
  }

  let bestLaps: TrainingHubActivityLap[] = [];

  for (const items of candidateGroups) {
    const parsed = items.map((item, index) => parseActivityLap(item, index));
    const populatedCount = parsed.filter(isPopulatedActivityLap).length;
    const bestPopulatedCount = bestLaps.filter(isPopulatedActivityLap).length;

    if (
      populatedCount > bestPopulatedCount ||
      (populatedCount === bestPopulatedCount && parsed.length > bestLaps.length)
    ) {
      bestLaps = parsed;
    }
  }

  return bestLaps.map((lap, index) => ({ ...lap, index: index + 1 }));
}

function normalizeGpsCoordinate(value: number): number | undefined {
  if (!Number.isFinite(value) || value === 0) {
    return undefined;
  }

  const abs = Math.abs(value);
  if (abs <= 180) {
    return value;
  }

  if (abs < 1e10) {
    return value / 1e7;
  }

  return undefined;
}

function normalizeTrackElevation(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  const abs = Math.abs(value);

  if (abs > 500) {
    return value / 100;
  }

  return value;
}

function pickNumberArray(
  obj: Record<string, unknown>,
  keys: string[]
): number[] | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    const numbers = value
      .map((entry) => toOptionalNumber(entry))
      .filter((entry): entry is number => entry !== undefined);

    if (numbers.length > 0) {
      return numbers;
    }
  }

  return undefined;
}

function decimateTrackPoints(
  points: TrainingHubTrackPoint[],
  maxPoints = 400
): TrainingHubTrackPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = points.length / maxPoints;
  const result: TrainingHubTrackPoint[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    result.push(points[Math.floor(index * step)]!);
  }

  const lastPoint = points[points.length - 1]!;
  if (result[result.length - 1] !== lastPoint) {
    result.push(lastPoint);
  }

  return result;
}

function buildTrackFromParallelArrays(
  lats: number[],
  lons: number[],
  altitudes?: number[],
  distances?: number[]
): TrainingHubTrackPoint[] {
  const length = Math.min(lats.length, lons.length);
  const points: TrainingHubTrackPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const lat = normalizeGpsCoordinate(lats[index]!);
    const lon = normalizeGpsCoordinate(lons[index]!);

    if (lat === undefined || lon === undefined) {
      continue;
    }

    if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) {
      continue;
    }

    const elevation = altitudes?.[index];
    const distance = distances?.[index];

    points.push({
      lat,
      lon,
      elevation:
        elevation !== undefined ? normalizeTrackElevation(elevation) : undefined,
      distance:
        distance !== undefined
          ? normalizeActivityDistanceMeters(distance)
          : undefined
    });
  }

  return points;
}

function normalizeFrequencyDistanceMeters(value?: number): number | undefined {
  return normalizeCorosDetailDistanceMeters(value);
}

function parseTrackPointObject(raw: Record<string, unknown>): TrainingHubTrackPoint | undefined {
  const lat = normalizeGpsCoordinate(
    toOptionalNumber(raw.lat ?? raw.latitude ?? raw.gpsLat ?? raw.y) ?? 0
  );
  const lon = normalizeGpsCoordinate(
    toOptionalNumber(raw.lon ?? raw.longitude ?? raw.gpsLon ?? raw.x) ?? 0
  );
  const elevation = normalizeTrackElevation(
    toOptionalNumber(raw.altitude ?? raw.alt ?? raw.elev ?? raw.elevation)
  );
  const distance = normalizeFrequencyDistanceMeters(
    toOptionalNumber(raw.distance ?? raw.totalDistance ?? raw.dis)
  );

  if (
    lat === undefined &&
    lon === undefined &&
    elevation === undefined &&
    distance === undefined
  ) {
    return undefined;
  }

  const point: TrainingHubTrackPoint = {};

  if (lat !== undefined && lon !== undefined) {
    point.lat = lat;
    point.lon = lon;
  }

  if (elevation !== undefined) {
    point.elevation = elevation;
  }

  if (distance !== undefined) {
    point.distance = distance;
  }

  return point;
}

function parseTrackFromFrequencyList(raw: unknown): TrainingHubTrackPoint[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const points: TrainingHubTrackPoint[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const point = parseTrackPointObject(item as Record<string, unknown>);
    if (point) {
      points.push(point);
    }
  }

  return points;
}

function mergeActivityTracks(
  existing: TrainingHubActivityTrack | undefined,
  incoming: TrainingHubActivityTrack
): TrainingHubActivityTrack {
  if (!existing?.points.length) {
    return incoming;
  }

  const existingHasGps = existing.points.some(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  const incomingHasGps = incoming.points.some(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  const existingHasElevation = existing.points.some(
    (point) => point.elevation !== undefined
  );
  const incomingHasElevation = incoming.points.some(
    (point) => point.elevation !== undefined
  );

  if (existingHasGps && existingHasElevation) {
    return existing;
  }

  if (incomingHasGps && !existingHasGps) {
    if (existingHasElevation && !incomingHasElevation) {
      return {
        points: incoming.points.map((point, index) => ({
          ...point,
          elevation: point.elevation ?? existing.points[index]?.elevation
        }))
      };
    }

    return incoming;
  }

  if (incomingHasElevation && !existingHasElevation) {
    return {
      points: existing.points.map((point, index) => ({
        ...point,
        elevation: point.elevation ?? incoming.points[index]?.elevation,
        distance: point.distance ?? incoming.points[index]?.distance
      }))
    };
  }

  return existing.points.length >= incoming.points.length ? existing : incoming;
}

async function fetchActivityTrackFromGpx(
  activityId: string,
  sportType: number
): Promise<TrainingHubActivityTrack | undefined> {
  try {
    const fileUrl = await getTrainingHubActivityFileUrl(activityId, sportType, 1);
    const response = await fetch(fileUrl);

    if (!response.ok) {
      return undefined;
    }

    return parseGpxTrack(await response.text());
  } catch {
    return undefined;
  }
}

function parseGpxTrack(gpx: string): TrainingHubActivityTrack | undefined {
  const points: TrainingHubTrackPoint[] = [];
  const trackPointPattern =
    /<trkpt[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;

  for (const match of gpx.matchAll(trackPointPattern)) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const body = match[3] ?? "";
    const elevationMatch = /<ele>([^<]+)<\/ele>/i.exec(body);
    const elevation = elevationMatch ? Number(elevationMatch[1]) : undefined;

    points.push({
      lat,
      lon,
      elevation:
        elevation !== undefined && Number.isFinite(elevation)
          ? elevation
          : undefined
    });
  }

  if (points.length < 2) {
    return undefined;
  }

  return { points: decimateTrackPoints(points) };
}

function hasRoutePoints(points: TrainingHubTrackPoint[]): boolean {
  return (
    points.filter((point) => point.lat !== undefined && point.lon !== undefined)
      .length >= 2
  );
}

function hasElevationPoints(points: TrainingHubTrackPoint[]): boolean {
  return (
    points.filter((point) => point.elevation !== undefined).length >= 2
  );
}

function parseTrackFromSeriesObject(source: Record<string, unknown>): TrainingHubTrackPoint[] {
  const lats = pickNumberArray(source, [
    "latitude",
    "lat",
    "gpsLat",
    "gpsLatList",
    "latList"
  ]);
  const lons = pickNumberArray(source, [
    "longitude",
    "lon",
    "gpsLon",
    "gpsLonList",
    "lonList"
  ]);

  if (!lats || !lons) {
    return [];
  }

  return buildTrackFromParallelArrays(
    lats,
    lons,
    pickNumberArray(source, [
      "altitude",
      "elev",
      "elevation",
      "altitudeList",
      "altList"
    ]),
    pickNumberArray(source, ["distance", "distanceList", "disList"])
  );
}

function parseTrackFromPointList(source: Record<string, unknown>): TrainingHubTrackPoint[] {
  const pointList =
    pickArray(source, ["pointList", "points", "gpsList", "trackList"]) ?? [];
  const points: TrainingHubTrackPoint[] = [];

  for (const entry of pointList) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const point = entry as Record<string, unknown>;
    const lat = normalizeGpsCoordinate(
      toOptionalNumber(point.latitude ?? point.lat ?? point.gpsLat) ?? 0
    );
    const lon = normalizeGpsCoordinate(
      toOptionalNumber(point.longitude ?? point.lon ?? point.gpsLon) ?? 0
    );

    if (lat === undefined || lon === undefined) {
      continue;
    }

    points.push({
      lat,
      lon,
      elevation: normalizeTrackElevation(
        toOptionalNumber(point.altitude ?? point.elev ?? point.elevation)
      ),
      distance: normalizeActivityDistanceMeters(
        toOptionalNumber(point.distance ?? point.totalDistance)
      )
    });
  }

  return points;
}

function trackCandidateScore(points: TrainingHubTrackPoint[]): number {
  let score = 0;

  for (const point of points) {
    if (point.lat !== undefined && point.lon !== undefined) {
      score += 100;
    }

    if (point.elevation !== undefined) {
      score += 1;
    }
  }

  return score;
}

function combineTrackCandidates(
  candidates: TrainingHubTrackPoint[][]
): TrainingHubTrackPoint[] {
  const ranked = candidates
    .filter((points) => points.length > 0)
    .sort((left, right) => trackCandidateScore(right) - trackCandidateScore(left));

  if (ranked.length === 0) {
    return [];
  }

  const best = ranked[0]!;
  const elevationSource =
    ranked.find((points) =>
      points.some((point) => point.elevation !== undefined)
    ) ?? best;
  const gpsSource =
    ranked.find((points) =>
      points.some((point) => point.lat !== undefined && point.lon !== undefined)
    ) ?? best;

  const length = Math.max(best.length, elevationSource.length, gpsSource.length);
  const combined: TrainingHubTrackPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const gpsPoint = gpsSource[index];
    const elevationPoint = elevationSource[index];
    const basePoint = best[index] ?? gpsPoint ?? elevationPoint;

    if (!basePoint && !gpsPoint && !elevationPoint) {
      continue;
    }

    combined.push({
      lat: gpsPoint?.lat ?? basePoint?.lat,
      lon: gpsPoint?.lon ?? basePoint?.lon,
      elevation: elevationPoint?.elevation ?? basePoint?.elevation,
      distance: elevationPoint?.distance ?? basePoint?.distance ?? gpsPoint?.distance
    });
  }

  return combined;
}

function collectGraphListCandidates(graphList: unknown): TrainingHubTrackPoint[][] {
  const candidates: TrainingHubTrackPoint[][] = [];

  if (Array.isArray(graphList)) {
    for (const item of graphList) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const series = item as Record<string, unknown>;
      candidates.push(parseTrackFromFrequencyList(series.frequencyList));
      candidates.push(parseTrackFromSeriesObject(series));
      candidates.push(parseTrackFromPointList(series));
    }
  } else if (graphList && typeof graphList === "object") {
    const series = graphList as Record<string, unknown>;
    candidates.push(parseTrackFromFrequencyList(series.frequencyList));
    candidates.push(parseTrackFromSeriesObject(series));
    candidates.push(parseTrackFromPointList(series));
  }

  return candidates;
}

function parseActivityTrack(raw: Record<string, unknown>): TrainingHubActivityTrack | undefined {
  const candidates: TrainingHubTrackPoint[][] = [];

  if (Array.isArray(raw.frequencyList)) {
    candidates.push(parseTrackFromFrequencyList(raw.frequencyList));
  }

  candidates.push(...collectGraphListCandidates(raw.graphList));

  const gpsLightDuration = raw.gpsLightDuration;
  if (Array.isArray(gpsLightDuration)) {
    candidates.push(parseTrackFromFrequencyList(gpsLightDuration));
  } else if (gpsLightDuration && typeof gpsLightDuration === "object") {
    candidates.push(
      parseTrackFromSeriesObject(gpsLightDuration as Record<string, unknown>)
    );
  }

  const points = combineTrackCandidates(candidates);

  if (!hasRoutePoints(points) && !hasElevationPoints(points)) {
    return undefined;
  }

  return { points: decimateTrackPoints(points) };
}

function parseNumericSeries(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const numbers: number[] = [];
  for (const item of value) {
    const parsed = toOptionalNumber(item);
    if (parsed !== undefined) {
      numbers.push(parsed);
    }
  }

  return numbers.length > 0 ? numbers : undefined;
}

function pickNumericSeries(
  source: Record<string, unknown>,
  keys: string[]
): number[] | undefined {
  for (const key of keys) {
    const series = parseNumericSeries(source[key]);
    if (series) {
      return series;
    }
  }
  return undefined;
}

function mergeSeriesArrays(
  distance?: number[],
  hr?: number[],
  pace?: number[],
  power?: number[]
): TrainingHubActivitySeriesPoint[] {
  const length = Math.max(
    distance?.length ?? 0,
    hr?.length ?? 0,
    pace?.length ?? 0,
    power?.length ?? 0
  );

  if (length === 0) {
    return [];
  }

  const points: TrainingHubActivitySeriesPoint[] = [];
  for (let index = 0; index < length; index += 1) {
    const point: TrainingHubActivitySeriesPoint = {};
    if (distance && distance[index] !== undefined) {
      point.distance = normalizeActivityDistanceMeters(distance[index]);
    }
    if (hr && hr[index] !== undefined) {
      point.hr = Math.round(hr[index]!);
    }
    if (pace && pace[index] !== undefined) {
      const normalized = normalizeActivityDuration(pace[index]!) ?? pace[index]!;
      if (isPlausiblePaceSecondsPerKm(normalized)) {
        point.pace = normalized;
      }
    }
    if (power && power[index] !== undefined) {
      point.power = Math.round(power[index]!);
    }
    if (
      point.distance !== undefined ||
      point.hr !== undefined ||
      point.pace !== undefined ||
      point.power !== undefined
    ) {
      points.push(point);
    }
  }

  return points;
}

function collectSeriesCandidates(raw: Record<string, unknown>): TrainingHubActivitySeriesPoint[][] {
  const candidates: TrainingHubActivitySeriesPoint[][] = [];
  const rootDistance = pickNumericSeries(raw, ["distanceList", "distance"]);
  const rootHr = pickNumericSeries(raw, [
    "heartRateList",
    "hrList",
    "heartRates",
    "avgHrList"
  ]);
  const rootPace = pickNumericSeries(raw, ["paceList", "speedList", "avgPaceList"]);
  const rootPower = pickNumericSeries(raw, ["powerList", "wattsList", "avgPowerList"]);

  const rootSeries = mergeSeriesArrays(rootDistance, rootHr, rootPace, rootPower);
  if (rootSeries.length > 0) {
    candidates.push(rootSeries);
  }

  const graphList = raw.graphList;
  const graphItems = Array.isArray(graphList)
    ? graphList
    : graphList && typeof graphList === "object"
      ? [graphList]
      : [];

  for (const item of graphItems) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const series = item as Record<string, unknown>;
    const distance =
      pickNumericSeries(series, ["distanceList", "distance"]) ??
      (Array.isArray(series.frequencyList)
        ? series.frequencyList
            .map((point) =>
              point && typeof point === "object"
                ? normalizeActivityDistanceMeters(
                    toOptionalNumber((point as Record<string, unknown>).distance)
                  )
                : undefined
            )
            .filter((value): value is number => value !== undefined)
        : undefined);
    const hr = pickNumericSeries(series, [
      "heartRateList",
      "hrList",
      "heartRates",
      "heartRate",
      "avgHrList"
    ]);
    const pace = pickNumericSeries(series, ["paceList", "speedList", "avgPaceList"]);
    const power = pickNumericSeries(series, ["powerList", "wattsList", "avgPowerList"]);
    const merged = mergeSeriesArrays(distance, hr, pace, power);
    if (merged.length > 0) {
      candidates.push(merged);
    }
  }

  if (Array.isArray(raw.frequencyList)) {
    const distance = raw.frequencyList
      .map((point) =>
        point && typeof point === "object"
          ? normalizeActivityDistanceMeters(
              toOptionalNumber((point as Record<string, unknown>).distance)
            )
          : undefined
      )
      .filter((value): value is number => value !== undefined);
    const hr = raw.frequencyList
      .map((point) =>
        point && typeof point === "object"
          ? toOptionalNumber((point as Record<string, unknown>).heartRate) ??
            toOptionalNumber((point as Record<string, unknown>).hr) ??
            toOptionalNumber((point as Record<string, unknown>).avgHr)
          : undefined
      )
      .filter((value): value is number => value !== undefined);
    const pace = raw.frequencyList
      .map((point) =>
        point && typeof point === "object"
          ? toOptionalNumber((point as Record<string, unknown>).pace) ??
            toOptionalNumber((point as Record<string, unknown>).speed)
          : undefined
      )
      .filter((value): value is number => value !== undefined);
    const merged = mergeSeriesArrays(distance, hr, pace, undefined);
    if (merged.length > 0) {
      candidates.push(merged);
    }
  }

  return candidates;
}

export function parseActivitySeries(
  raw: Record<string, unknown>
): TrainingHubActivitySeriesPoint[] {
  const candidates = collectSeriesCandidates(raw);
  if (candidates.length === 0) {
    return [];
  }

  return candidates.sort((left, right) => right.length - left.length)[0] ?? [];
}

export function downsampleActivitySeries(
  points: TrainingHubActivitySeriesPoint[],
  maxPoints = 60
): TrainingHubActivitySeriesPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const bucketSize = points.length / maxPoints;
  const sampled: TrainingHubActivitySeriesPoint[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    const start = Math.floor(index * bucketSize);
    const end = Math.min(points.length, Math.floor((index + 1) * bucketSize));
    const bucket = points.slice(start, end);
    if (bucket.length === 0) {
      continue;
    }

    const point: TrainingHubActivitySeriesPoint = {};
    const distances = bucket
      .map((item) => item.distance)
      .filter((value): value is number => value !== undefined);
    const hrs = bucket.map((item) => item.hr).filter((value): value is number => value !== undefined);
    const paces = bucket
      .map((item) => item.pace)
      .filter((value): value is number => value !== undefined);
    const powers = bucket
      .map((item) => item.power)
      .filter((value): value is number => value !== undefined);

    if (distances.length > 0) {
      point.distance = distances[distances.length - 1];
    }
    if (hrs.length > 0) {
      point.hr = Math.round(hrs.reduce((sum, value) => sum + value, 0) / hrs.length);
    }
    if (paces.length > 0) {
      point.pace = Math.round(paces.reduce((sum, value) => sum + value, 0) / paces.length);
    }
    if (powers.length > 0) {
      point.power = Math.round(powers.reduce((sum, value) => sum + value, 0) / powers.length);
    }

    if (
      point.distance !== undefined ||
      point.hr !== undefined ||
      point.pace !== undefined ||
      point.power !== undefined
    ) {
      sampled.push(point);
    }
  }

  return sampled;
}

function formatPaceSeconds(paceSecondsPerKm: number): string {
  const total = Math.max(0, Math.round(paceSecondsPerKm));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

export function formatActivitySeriesForChat(
  points: TrainingHubActivitySeriesPoint[]
): string {
  if (points.length === 0) {
    return "Time series: no HR/pace/power samples available.";
  }

  const header = "Distance | HR | Pace | Power";
  const rows = points.map((point) =>
    [
      point.distance !== undefined ? `${(point.distance / 1000).toFixed(2)} km` : "—",
      point.hr !== undefined ? `${point.hr}` : "—",
      point.pace !== undefined ? formatPaceSeconds(point.pace) : "—",
      point.power !== undefined ? `${point.power} W` : "—"
    ].join(" | ")
  );

  return ["Time series (downsampled):", header, ...rows].join("\n");
}

export function parseScheduledExercises(
  program: Record<string, unknown> | undefined
): TrainingHubScheduledExercise[] {
  if (!program) {
    return [];
  }

  const exercises = Array.isArray(program.exercises) ? program.exercises : [];
  const parsed: TrainingHubScheduledExercise[] = [];

  for (const item of exercises) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const exercise = item as Record<string, unknown>;
    const name =
      pickString(exercise, ["name", "exerciseName", "title"]) ?? "Exercise";
    const targetType = toOptionalNumber(exercise.targetType);
    const sets = toOptionalNumber(exercise.sets) ?? 1;
    const reps =
      toOptionalNumber(exercise.reps) ??
      (targetType === 1 ? toOptionalNumber(exercise.targetValue) : undefined);
    const weight =
      toOptionalNumber(exercise.weight) ??
      toOptionalNumber(exercise.weightValue) ??
      (targetType === 6 ? toOptionalNumber(exercise.targetValue) : undefined);
    const targetLabel = formatScheduledExerciseTarget(exercise, targetType);

    parsed.push({
      name,
      sets,
      reps,
      weight,
      targetType,
      targetLabel
    });
  }

  return parsed;
}

function formatScheduledExerciseTarget(
  exercise: Record<string, unknown>,
  targetType?: number
): string | undefined {
  const targetValue = toOptionalNumber(exercise.targetValue);
  if (targetType === 5 && targetValue) {
    return `${(corosWorkoutDistanceToMeters(targetValue) / 1000).toFixed(2)} km`;
  }
  if (targetType === 2 && targetValue) {
    const seconds = normalizeActivityDuration(targetValue) ?? targetValue;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }
  if (targetType === 1 && targetValue) {
    return `${Math.round(targetValue)} reps`;
  }
  if (targetType === 6 && targetValue) {
    return `${Math.round(targetValue)} kg`;
  }
  const intensity = pickString(exercise, ["intensityText", "intensity"]);
  return intensity;
}

export function formatScheduledExercisesForChat(
  exercises: TrainingHubScheduledExercise[]
): string | undefined {
  if (exercises.length === 0) {
    return undefined;
  }

  return exercises
    .map((exercise) => {
      const parts = [exercise.name];
      if (exercise.sets && exercise.sets > 1) {
        parts.push(`${exercise.sets} sets`);
      }
      if (exercise.reps) {
        parts.push(`${Math.round(exercise.reps)} reps`);
      }
      if (exercise.weight) {
        parts.push(`${Math.round(exercise.weight)} kg`);
      } else if (exercise.targetLabel) {
        parts.push(exercise.targetLabel);
      }
      return parts.join(" · ");
    })
    .join("; ");
}

function isImplausibleMetricRatio(
  detailValue?: number,
  listValue?: number
): boolean {
  if (
    detailValue === undefined ||
    listValue === undefined ||
    detailValue <= 0 ||
    listValue <= 0
  ) {
    return false;
  }

  const ratio = detailValue / listValue;
  return ratio > 10 || ratio < 0.1;
}

function coalesceActivityMetric(
  detailValue: number | undefined,
  listValue: number | undefined
): number | undefined {
  if (detailValue === undefined) {
    return listValue;
  }

  if (listValue === undefined) {
    return detailValue;
  }

  if (isImplausibleMetricRatio(detailValue, listValue)) {
    return listValue;
  }

  return detailValue;
}

export function mergeActivityDetailWithList(
  detail: TrainingHubActivityDetail,
  listActivity: TrainingHubActivity
): TrainingHubActivityDetail {
  return {
    ...detail,
    activityId: detail.activityId ?? listActivity.activityId,
    name: detail.name ?? listActivity.name,
    sportType: detail.sportType ?? listActivity.sportType,
    sportName:
      detail.sportName ??
      listActivity.sportName ??
      corosSportName(
        detail.sportType ?? listActivity.sportType,
        undefined
      ),
    startTime: detail.startTime ?? listActivity.startTime,
    duration: coalesceActivityMetric(detail.duration, listActivity.duration),
    distance: coalesceActivityMetric(detail.distance, listActivity.distance),
    avgHr: coalesceActivityMetric(detail.avgHr, listActivity.avgHr),
    maxHr: coalesceActivityMetric(detail.maxHr, listActivity.maxHr),
    calories: coalesceActivityMetric(detail.calories, listActivity.calories),
    elevationGain: coalesceActivityMetric(
      detail.elevationGain,
      listActivity.elevationGain
    ),
    trainingLoad: coalesceActivityMetric(
      detail.trainingLoad,
      listActivity.trainingLoad
    )
  };
}

export function parseActivityDetail(raw: Record<string, unknown>): TrainingHubActivityDetail {
  const summary = pickObject(raw, ["summaryInfo", "summary", "activitySummary"]) ?? raw;
  const laps = extractActivityLaps(raw);
  const track = parseActivityTrack(raw);

  const durationRaw = pickActivityNumber(raw, summary, [
    "totalTime",
    "duration",
    "workoutTime"
  ]);
  const distanceRaw = pickActivityNumber(raw, summary, ["distance", "totalDistance"]);
  const elevationRaw = pickActivityNumber(raw, summary, [
    "ascent",
    "elevationGain",
    "totalAscent",
    "elevGain"
  ]);

  return {
    activityId:
      pickString(raw, ["labelId", "activityId"]) ??
      pickString(summary, ["labelId", "activityId"]),
    name: pickString(raw, ["name"]) ?? pickString(summary, ["name"]),
    sportType:
      toOptionalNumber(raw.sportType) ?? toOptionalNumber(summary.sportType),
    sportName:
      pickString(raw, ["sportName", "sport_name"]) ??
      pickString(summary, ["sportName", "sport_name", "modeName"]),
    startTime: normalizeActivityStartTimeSeconds(
      toOptionalNumber(raw.startTime) ??
        toOptionalNumber(summary.startTime) ??
        toOptionalNumber(summary.startTimestamp)
    ),
    duration: normalizeActivityDuration(durationRaw),
    distance: normalizeActivityDistanceMeters(distanceRaw),
    avgHr:
      toOptionalNumber(raw.avgHr) ??
      toOptionalNumber(summary.avgHr),
    maxHr:
      toOptionalNumber(raw.maxHr) ??
      toOptionalNumber(summary.maxHr),
    calories: pickActivityCalories(raw, summary),
    elevationGain: normalizeActivityElevationMeters(elevationRaw),
    trainingLoad:
      toOptionalNumber(raw.trainingLoad) ??
      toOptionalNumber(summary.trainingLoad),
    laps,
    track,
    series: parseActivitySeries(raw),
    strength: parseStrengthDetail(raw),
    raw
  };
}

function parseActivityLap(raw: unknown, index: number): TrainingHubActivityLap {
  if (!raw || typeof raw !== "object") {
    return { index: index + 1 };
  }

  const lap = raw as Record<string, unknown>;
  const distanceRaw =
    toOptionalNumber(lap.distance) ?? toOptionalNumber(lap.totalDistance);
  const durationRaw =
    toOptionalNumber(lap.totalTime) ??
    toOptionalNumber(lap.time) ??
    toOptionalNumber(lap.duration);

  let duration = normalizeActivityDuration(durationRaw);

  if (!duration) {
    const startTimestamp = toOptionalNumber(lap.startTimestamp);
    const endTimestamp = toOptionalNumber(lap.endTimestamp);

    if (
      startTimestamp !== undefined &&
      endTimestamp !== undefined &&
      endTimestamp > startTimestamp
    ) {
      duration = normalizeActivityDuration(endTimestamp - startTimestamp);
    }
  }

  const avgPace = toOptionalNumber(lap.avgPace);

  return {
    index: index + 1,
    distance: normalizeActivityDistanceMeters(distanceRaw),
    duration,
    avgHr: toOptionalNumber(lap.avgHr),
    maxHr: toOptionalNumber(lap.maxHr),
    pace:
      (avgPace !== undefined &&
      isPlausiblePaceSecondsPerKm(normalizeActivityDuration(avgPace) ?? avgPace)
        ? normalizeActivityDuration(avgPace) ?? avgPace
        : undefined) ??
      toOptionalNumber(lap.avgSpeed),
    elevationGain: normalizeActivityElevationMeters(
      toOptionalNumber(lap.ascent) ??
        toOptionalNumber(lap.elevationGain) ??
        toOptionalNumber(lap.elevGain)
    )
  };
}

function extractDayList(raw: Record<string, unknown>): unknown[] {
  return extractArray(raw, [
    "dayList",
    "dayDetailList",
    "dataList",
    "evoLab.dayList",
    "evoLab.dayDetailList"
  ]);
}

function extractSportStatistics(
  raw: Record<string, unknown>
): TrainingHubSportStatistic[] {
  const list = extractArray(raw, [
    "sportStatistic",
    "sportStatistics",
    "evoLab.sportStatistic",
    "evoLab.sportStatistics"
  ]);

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      sportType: toOptionalNumber(item.sportType),
      sportName: pickString(item, ["sportName", "name"]),
      distance: toOptionalNumber(item.distance),
      duration: toOptionalNumber(item.duration),
      count: toOptionalNumber(item.count),
      trainingLoad: toOptionalNumber(item.trainingLoad)
    }));
}

function extractArray(raw: Record<string, unknown>, paths: string[]): Record<string, unknown>[] {
  for (const path of paths) {
    const value = pickPath(raw, path);
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object"
      );
    }
  }

  return [];
}

function pickPath(raw: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = raw;

  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function pickObject(
  raw: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return undefined;
}

function pickArray(raw: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return undefined;
}

function pickString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeCalories(value: unknown): number | undefined {
  const numeric = toOptionalNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  return numeric > 1000 ? Math.round(numeric / 1000) : Math.round(numeric);
}

function formatRaceDistanceLabel(
  distance?: number,
  raceName?: string,
  raceType?: number | string
): string | undefined {
  if (raceName?.trim()) {
    return raceName.trim();
  }

  if (distance) {
    if (distance >= 40_000) {
      return "Marathon";
    }
    if (distance >= 20_000) {
      return "Half Marathon";
    }
    if (distance >= 9_000) {
      return "10K";
    }
    if (distance >= 4_000) {
      return "5K";
    }

    return `${(distance / 1000).toFixed(1)} km`;
  }

  if (raceType !== undefined) {
    return String(raceType);
  }

  return undefined;
}

async function trainingHubGet<T>(
  path: string,
  params?: Record<string, string | number>
): Promise<T> {
  return trainingHubRequest<T>(path, { method: "GET", params });
}

interface TrainingHubRequestOptions extends RequestInit {
  params?: Record<string, string | number>;
  allowEmptyData?: boolean;
}

async function trainingHubFetch<T>(
  path: string,
  options: TrainingHubRequestOptions = {}
): Promise<T> {
  return trainingHubRequest<T>(path, options);
}

async function trainingHubRequest<T>(
  path: string,
  options: TrainingHubRequestOptions = {}
): Promise<T> {
  const auth = getStoredAuth();
  if (!auth) {
    throw new Error("Log in to COROS Training Hub first.");
  }

  try {
    return await executeTrainingHubRequest<T>(auth, path, options);
  } catch (error) {
    const retryReason = getTrainingHubRetryReason(error);
    if (!retryReason) {
      throw error;
    }

    const resolvedBaseUrl = await resolveTrainingHubBaseUrl(
      auth.accessToken,
      auth.baseUrl
    );
    if (resolvedBaseUrl === auth.baseUrl) {
      if (retryReason === "token") {
        return recoverExpiredTrainingHubSession<T>(path, options);
      }

      throw error;
    }

    setSetting(SETTINGS.baseUrl, resolvedBaseUrl);

    try {
      return await executeTrainingHubRequest<T>(
        { ...auth, baseUrl: resolvedBaseUrl },
        path,
        options
      );
    } catch (retryError) {
      if (retryReason === "token") {
        return recoverExpiredTrainingHubSession<T>(path, options);
      }

      throw retryError;
    }
  }
}

async function recoverExpiredTrainingHubSession<T>(
  path: string,
  options: TrainingHubRequestOptions
): Promise<T> {
  const refreshed = await reauthenticateFromStoredCredentials();
  if (!refreshed) {
    clearTrainingHubAuth();
    throw new Error("COROS session expired. Log in again.");
  }

  try {
    return await executeTrainingHubRequest<T>(refreshed, path, options);
  } catch (error) {
    if (getTrainingHubRetryReason(error) === "token") {
      clearTrainingHubAuth();
      throw new Error("COROS session expired. Log in again.");
    }
    throw error;
  }
}

async function executeTrainingHubRequest<T>(
  auth: TrainingHubAuthState,
  path: string,
  options: TrainingHubRequestOptions = {}
): Promise<T> {
  const { params, allowEmptyData, ...requestOptions } = options;
  const url = new URL(`${auth.baseUrl}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    ...buildTrainingHubHeaders(auth.accessToken, auth.userId),
    ...(requestOptions.headers as Record<string, string> | undefined)
  };

  if (requestOptions.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return fetchJson<T>(url.toString(), {
    ...requestOptions,
    headers
  }, { allowEmptyData, contextPath: path });
}

async function resolveTrainingHubBaseUrl(
  accessToken: string,
  loginBaseUrl: string
): Promise<string> {
  if (await probeTrainingHubBaseUrl(accessToken, loginBaseUrl)) {
    return loginBaseUrl;
  }

  for (const baseUrl of REGION_PROBE_URLS) {
    if (baseUrl === loginBaseUrl) {
      continue;
    }

    if (await probeTrainingHubBaseUrl(accessToken, baseUrl)) {
      return baseUrl;
    }
  }

  return (
    REGION_BASE_URLS["1"] ??
    loginBaseUrl ??
    GLOBAL_BASE_URL
  );
}

async function probeTrainingHubBaseUrl(
  accessToken: string,
  baseUrl: string
): Promise<boolean> {
  const candidates = [
    `${baseUrl}/activity/query?size=1&pageNumber=1`,
    `${baseUrl}/account/query`
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: buildTrainingHubHeaders(accessToken)
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as TrainingHubApiResponse<unknown>;
      const result = String(payload.result ?? payload.apiCode ?? "");

      if (result === RESULT_SUCCESS) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function getTrainingHubRetryReason(
  error: unknown
): "token" | "not-found" | null {
  if (error instanceof InvalidTrainingHubTokenError) {
    return "token";
  }

  if (
    error instanceof Error &&
    error.message.includes("COROS API request failed: 404")
  ) {
    return "not-found";
  }

  return null;
}

class InvalidTrainingHubTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTrainingHubTokenError";
  }
}

function isInvalidTokenMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("access token is invalid") ||
    normalized.includes("token is invalid")
  );
}

export function parseTrainingHubApiResponse<T>(
  payload: TrainingHubApiResponse<T>,
  options?: { allowEmptyData?: boolean; contextPath?: string }
): T | undefined {
  const result = String(payload.result ?? payload.apiCode ?? "");

  if (AUTH_ERROR_CODES.has(result)) {
    throw new InvalidTrainingHubTokenError(
      payload.message || "COROS session expired."
    );
  }

  if (result !== RESULT_SUCCESS) {
    const message = payload.message || "COROS API request failed.";
    if (isInvalidTokenMessage(message)) {
      throw new InvalidTrainingHubTokenError(message);
    }
    throw new Error(message);
  }

  if (payload.data === undefined || payload.data === null) {
    if (options?.allowEmptyData) {
      return undefined;
    }
    const context = options?.contextPath ?? "API request";
    throw new Error(`COROS ${context} succeeded but returned no data.`);
  }

  return payload.data;
}

async function fetchJson<T>(
  url: string,
  options: RequestInit,
  fetchOptions?: { allowEmptyData?: boolean; contextPath?: string }
): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(
      `COROS API request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TrainingHubApiResponse<T>;
  const data = parseTrainingHubApiResponse<T>(payload, fetchOptions);
  return data as T;
}

function getStoredAuth(): TrainingHubAuthState | null {
  const accessToken = getSetting(SETTINGS.accessToken);
  const userId = getSetting(SETTINGS.userId);
  const regionId = getSetting(SETTINGS.regionId);
  const baseUrl = getSetting(SETTINGS.baseUrl);

  if (!accessToken || !userId || !regionId || !baseUrl) {
    return null;
  }

  return {
    accessToken,
    userId,
    regionId,
    baseUrl
  };
}

function buildTrainingHubHeaders(
  accessToken: string,
  userId?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    accesstoken: accessToken,
    Accept: "application/json, text/plain, */*"
  };
  if (userId) {
    headers.yfheader = JSON.stringify({ userId });
  }
  return headers;
}

function clearTrainingHubAuth(): void {
  deleteSettings([
    SETTINGS.accessToken,
    SETTINGS.userId,
    SETTINGS.regionId,
    SETTINGS.baseUrl
  ]);
}

// A single in-flight re-authentication shared by all concurrent callers.
// When a token expires, every parallel request would otherwise trigger its own
// full COROS login; because COROS invalidates the previous token each time a new
// one is minted, those concurrent logins cannibalise each other and the retried
// requests end up using an already-stale token. De-duplicating re-auth here means
// all callers await the same login and reuse the same fresh token.
let pendingReauth: Promise<TrainingHubAuthState | null> | null = null;

function reauthenticateFromStoredCredentials(): Promise<TrainingHubAuthState | null> {
  if (!pendingReauth) {
    pendingReauth = performReauthentication().finally(() => {
      pendingReauth = null;
    });
  }
  return pendingReauth;
}

async function performReauthentication(): Promise<TrainingHubAuthState | null> {
  const credentials = getStoredCorosCredentials();
  if (!credentials) {
    console.warn(
      "[trainingHub] COROS access token expired but no stored credentials " +
        "are available to refresh it (was 'Remember me' enabled and is secure " +
        "storage available?). The user must log in again."
    );
    return null;
  }

  try {
    const session = await establishTrainingHubSession(
      credentials.account,
      credentials.pwdHash
    );
    persistTrainingHubSession(session);
    return session;
  } catch (error) {
    console.warn(
      "[trainingHub] Automatic re-login with stored COROS credentials failed; " +
        "the user must log in again.",
      error
    );
    return null;
  }
}
