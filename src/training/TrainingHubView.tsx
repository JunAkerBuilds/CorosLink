import { widgetPreset } from "./dashboardLayout";
import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowRightFromLine,
  ChartNoAxesColumnIncreasing,
  Eye,
  EyeOff,
  ExternalLink,
  ArrowLeft,
  KeyRound,
  LockKeyhole,
  Loader2,
  Mail,
  Monitor,
  ShieldCheck,
  Trophy,
  RefreshCw
} from "lucide-react";
import { CoachChartsPanel } from "./components/CoachChartsPanel";
import { FitnessScoresPanel } from "./components/FitnessScoresPanel";
import { FitnessTrendPanel } from "./components/FitnessTrendPanel";
import { PersonalRecordsPanel } from "./components/PersonalRecordsPanel";
import {
  PersonalRecordCelebrationOverlay,
  usePersonalRecordCelebration
} from "./components/PersonalRecordCelebration";
import { RacePredictorCards } from "./components/RacePredictorCards";
import { RecoveryRing } from "./components/RecoveryRing";
import { HealthInsightsPanel } from "./components/HealthInsightsPanel";
import { SleepSummaryPanel } from "./components/SleepSummaryPanel";
import { TrainingHeatmapPanel } from "./components/TrainingHeatmapPanel";
import { TrainingSummaryTiles } from "./components/TrainingSummaryTiles";
import { TrainingActivities } from "./components/TrainingActivities";
import { TrainingTrendCharts } from "./components/TrainingTrendChart";
import {
  PerceivedEffortPanel,
  TrainingZoneDistributionCharts
} from "./components/TrainingZoneDistributionCharts";
import { UpcomingWorkoutsPanel } from "./components/UpcomingWorkoutsPanel";
import { Vo2MaxWidget } from "./components/Vo2MaxWidget";
import { TrainingHubHeader, type TrainingHubTab } from "./components/TrainingHubHeader";
import "./trainingHub.css";
import { CustomizableDashboard } from "./components/CustomizableDashboard";
import type { TrainingHubViewProps } from "./types";
import type { TrainingHubActivity } from "../../electron/types";
import { createTrainingHubSampleData, type TrainingHubSampleData } from "./sampleData";
import loginPageBackground from "../../public/assets/training-hub/Login-page-bg.png";

export function TrainingHubView(props: TrainingHubViewProps) {
  return import.meta.env.DEV
    ? <TrainingHubPreview {...props} />
    : <TrainingHubContent {...props} />;
}

function TrainingHubPreview(props: TrainingHubViewProps) {
  const [sample, setSample] = useState<TrainingHubSampleData | null>(null);
  const [selectedSample, setSelectedSample] = useState<TrainingHubActivity | null>(null);
  const selectedActivity = selectedSample ?? sample?.activities[0] ?? null;
  const previewProps: TrainingHubViewProps = sample ? {
    ...props,
    snapshot: sample.snapshot,
    activities: sample.activities,
    sportTypes: sample.sportTypes,
    upcomingWorkouts: sample.upcomingWorkouts,
    selectedActivity,
    activityDetail: selectedActivity
      ? sample.activityDetails.get(selectedActivity.activityId) ?? null
      : null,
    busy: null,
    sleepConnecting: false,
    rpeBackfill: null,
    onLoadDetail: setSelectedSample,
    onExportFile: () => {},
    onRefresh: () => {},
    onLogout: () => {}
  } : props;

  return (
    <TrainingHubContent
      key={sample ? "sample" : "live"}
      {...previewProps}
      sampleMode={sample !== null}
      sampleDetails={sample?.activityDetails}
      onToggleSample={() => {
        setSelectedSample(null);
        setSample(current => current ? null : createTrainingHubSampleData());
      }}
    />
  );
}

function TrainingHubContent({
  api,
  status,
  email,
  password,
  remember,
  twoFactorEmail,
  twoFactorCode,
  activities,
  upcomingWorkouts,
  snapshot,
  sportTypes,
  rpeBackfill,
  activityDetail,
  selectedActivity,
  busy,
  sleepConnecting,
  onEmailChange,
  onPasswordChange,
  onRememberChange,
  onLogin,
  onTwoFactorCodeChange,
  onVerifyTwoFactor,
  onResendTwoFactor,
  onCancelTwoFactor,
  onReconnect,
  onLogout,
  onRefresh,
  onLoadDetail,
  onExportFile,
  sampleMode = false,
  sampleDetails,
  onToggleSample
}: TrainingHubViewProps & { sampleMode?: boolean; sampleDetails?: TrainingHubSampleData["activityDetails"]; onToggleSample?: () => void }) {
  const loadActivityPreview = useCallback((activity: TrainingHubActivity) => {
    if (sampleDetails) {
      const detail = sampleDetails.get(activity.activityId);
      return detail ? Promise.resolve(detail) : Promise.reject(new Error("Sample route unavailable"));
    }
    return api.getTrainingHubActivityDetail(activity.activityId, activity.sportType, activity);
  }, [api, sampleDetails]);
  const connected = sampleMode || Boolean(status?.authenticated);
  // Sample records are regenerated relative to today, so never celebrate them.
  const prCelebration = usePersonalRecordCelebration(
    snapshot?.dashboard ?? null,
    connected && !sampleMode
  );
  // Counts completed hub refreshes so pinned live charts re-resolve alongside them.
  const [hubRefreshCount, setHubRefreshCount] = useState(0);
  const wasRefreshingRef = useRef(false);
  useEffect(() => {
    if (busy === "training-refresh") {
      wasRefreshingRef.current = true;
      return;
    }
    if (wasRefreshingRef.current) {
      wasRefreshingRef.current = false;
      setHubRefreshCount((count) => count + 1);
    }
  }, [busy]);
  const canReconnect =
    !connected && Boolean(status?.rememberCredentials) && Boolean(status?.email);
  const reconnecting = busy === "training-reconnect";
  const awaitingTwoFactor = Boolean(twoFactorEmail);
  const verifying = busy === "training-verify";
  const resending = busy === "training-resend";
  const [dashboardToolbarTarget, setDashboardToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TrainingHubTab>("overview");
  const [visitedTabs, setVisitedTabs] = useState<TrainingHubTab[]>(["overview"]);
  const tabIdPrefix = useId();
  const changeTab = (tab: TrainingHubTab) => {
    setActiveTab(tab);
    setVisitedTabs(current => current.includes(tab) ? current : [...current, tab]);
  };
  const [showPassword, setShowPassword] = useState(false);
  const signInBackgroundStyle = connected
    ? undefined
    : ({
        "--training-signin-bg": `url(${loginPageBackground})`
      } as CSSProperties);
  const summary = useMemo(
    () =>
      snapshot?.summary ?? {
        staminaLevel: undefined,
        recoveryPct: undefined,
        todayLoad: undefined,
        weekLoadTotal: undefined,
        latestRhr: undefined,
        rhrDelta: undefined
      },
    [snapshot]
  );

  return (
    <div className="stack training-dashboard">
      {connected || onToggleSample ? (
        <TrainingHubHeader
          connected={connected}
          status={status}
          busy={busy}
          sampleMode={sampleMode}
          activeTab={activeTab}
          dashboardToolbarRef={setDashboardToolbarTarget}
          tabIdPrefix={tabIdPrefix}
          activityCount={activities.length}
          onTabChange={changeTab}
          onRefresh={onRefresh}
          onLogout={onLogout}
          onToggleSample={onToggleSample}
          onTestPrCelebration={import.meta.env.DEV ? prCelebration.test : undefined}
        />
      ) : null}
      {!connected ? (
        <section
          className="panel training-command-center is-disconnected"
          style={signInBackgroundStyle}
        >
          <div className="training-command-copy">
            <div className="training-signin-copy-inner">
              <div className="training-command-kicker">
                <Monitor size={18} aria-hidden="true" />
                <p className="eyebrow">Training Hub</p>
              </div>
              <h2>
                <span>COROS</span>
                <span>
                  <em>Training</em> Hub
                </span>
              </h2>
              <p className="training-signin-lead">
                Desktop access to training load, recovery, activity detail, and
                race readiness.
              </p>

              <div className="training-signin-feature-list">
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <ChartNoAxesColumnIncreasing size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Deep Insights</strong>
                    <p>
                      Track recovery, training load, VO2 max, and more with
                      advanced analytics.
                    </p>
                  </div>
                </div>
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <Trophy size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>All Your Data</strong>
                    <p>
                      Sync activities, view PRs, and analyze performance over
                      time.
                    </p>
                  </div>
                </div>
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <ShieldCheck size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Secure &amp; Private</strong>
                    <p>
                      Remembered credentials are encrypted and stored locally
                      on this device.
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {awaitingTwoFactor ? (
            <form
              className="training-login-panel"
              onSubmit={onVerifyTwoFactor}
            >
              <div className="training-login-panel-header">
                <strong>Verify it's you</strong>
                <p>
                  Enter the 6-digit code we emailed to{" "}
                  <strong>{twoFactorEmail}</strong>.
                </p>
              </div>

              <div className="training-login-fields">
                <label className="field training-login-field">
                  <span>Verification code</span>
                  <div className="training-login-input">
                    <KeyRound size={18} aria-hidden="true" />
                    <input
                      value={twoFactorCode}
                      onChange={(event) =>
                        onTwoFactorCodeChange(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      placeholder="123456"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      disabled={verifying}
                    />
                  </div>
                </label>
              </div>

              <div className="settings-actions training-login-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={twoFactorCode.trim().length < 6 || verifying}
                >
                  {verifying ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <ArrowRightFromLine size={17} aria-hidden="true" />
                  )}
                  Verify and sign in
                </button>
              </div>

              <div className="training-login-2fa-actions">
                <button
                  className="training-login-text-button"
                  type="button"
                  onClick={onResendTwoFactor}
                  disabled={resending || verifying}
                >
                  {resending ? (
                    <Loader2 className="spin" size={15} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={15} aria-hidden="true" />
                  )}
                  Resend code
                </button>
                <button
                  className="training-login-text-button"
                  type="button"
                  onClick={onCancelTwoFactor}
                  disabled={verifying}
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  Use a different account
                </button>
              </div>

              <p className="training-login-footer">
                <ShieldCheck size={16} aria-hidden="true" />
                Your credentials are encrypted and never shared.
              </p>
            </form>
          ) : (
          <form className="training-login-panel" onSubmit={onLogin}>
            <div className="training-login-panel-header">
              <strong>Welcome back</strong>
              <p>Sign in to access your COROS Training Hub data</p>
            </div>

            {canReconnect ? (
              <div className="training-login-reconnect">
                <div className="training-login-reconnect-text">
                  <strong>Saved COROS account: {status?.email}</strong>
                  <small>
                    Create a Training Hub session using your saved COROS
                    credentials — no password needed.
                  </small>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={onReconnect}
                  disabled={reconnecting}
                >
                  {reconnecting ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={17} aria-hidden="true" />
                  )}
                  Sign in
                </button>
              </div>
            ) : null}

            <div className="training-login-fields">
              <label className="field training-login-field">
                <span>Email</span>
                <div className="training-login-input">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="username"
                    disabled={busy === "training-login"}
                  />
                </div>
              </label>
              <label className="field training-login-field">
                <span>Password</span>
                <div className="training-login-input">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    placeholder="COROS password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    disabled={busy === "training-login"}
                  />
                  <button
                    className="training-login-visibility"
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((current) => !current)}
                    disabled={busy === "training-login"}
                  >
                    {showPassword ? (
                      <EyeOff size={17} aria-hidden="true" />
                    ) : (
                      <Eye size={17} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
            </div>

            <label className="training-login-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => onRememberChange(event.target.checked)}
                disabled={busy === "training-login"}
              />
              <span>
                Save this COROS account
                <small>
                  Securely stores an encrypted password digest so Training
                  Hub and Watch Face Studio can each create their own session.
                </small>
              </span>
            </label>

            <div className="settings-actions training-login-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={!email.trim() || !password || busy === "training-login"}
              >
                {busy === "training-login" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <ArrowRightFromLine size={17} aria-hidden="true" />
                )}
                Sign in to COROS
              </button>
            </div>

            <div className="training-login-divider">
              <span>or</span>
            </div>

            <a
              className="training-login-browser-link"
              href="https://t.coros.com/"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} aria-hidden="true" />
              Open COROS Training Hub in Browser
            </a>

            <p className="training-login-footer">
              <ShieldCheck size={16} aria-hidden="true" />
              Your credentials are encrypted and never shared.
            </p>
          </form>
          )}
        </section>
      ) : null}

      {connected ? (
        <>
          <div
            id={`${tabIdPrefix}-panel-overview`}
            className="stack training-hub-tab-panel"
            role="tabpanel"
            aria-labelledby={`${tabIdPrefix}-tab-overview`}
            tabIndex={0}
            hidden={activeTab !== "overview"}
          >
            <CustomizableDashboard toolbarTarget={dashboardToolbarTarget} sampleMode={sampleMode} renderWidget={widget => {
              switch (widget.id) {
                case "recovery": return <RecoveryRing summary={summary} />;
                case "daily-load": case "daily-heart": case "daily-steps": case "daily-calories":
                  return <TrainingSummaryTiles summary={summary} trendPoints={snapshot?.trendPoints}
                    healthRecords={snapshot?.dailyHealth?.records} layout="stack"
                    metrics={[widget.id.slice(6) as "load" | "heart" | "steps" | "calories"]} className="hub-daily-stat" />;
                case "fitness": return <FitnessTrendPanel snapshot={snapshot} activities={activities} />;
                case "sleep": return <SleepSummaryPanel sleep={snapshot?.sleep} connecting={sleepConnecting} refreshing={busy === "training-refresh"} />;
                case "vo2": return <Vo2MaxWidget snapshot={snapshot} />;
                case "heatmap": return <TrainingHeatmapPanel snapshot={snapshot} activities={activities} rpeBackfill={rpeBackfill} />;
                case "stress": case "sleepHrv": case "healthCheck": case "cycle": return <HealthInsightsPanel size={widgetPreset(widget).chartSize} kind={widget.id} api={api} refreshToken={hubRefreshCount} sampleMode={sampleMode} />;
                case "trend-load": case "trend-rpe": case "trend-hrv": case "trend-sleep": {
                  const cutoff = new Date();
                  cutoff.setDate(cutoff.getDate() - widget.days + 1);
                  const date = `${cutoff.getFullYear()}${String(cutoff.getMonth() + 1).padStart(2, "0")}${String(cutoff.getDate()).padStart(2, "0")}`;
                  const points = (snapshot?.trendPoints ?? []).filter(point => !widget.days || point.date >= date);
                  return <TrainingTrendCharts size={widgetPreset(widget).chartSize} metric={widget.id.slice(6) as "load" | "rpe" | "hrv" | "sleep"} rangeLabel={widget.days ? `Last ${widget.days} days` : "Available history"} points={points} sleepRecords={snapshot?.sleep?.records} />;
                }
                case "coach": return sampleMode ? <section className="panel"><h2>Coach charts</h2><p>Charts pinned from your coach conversations appear here when using your training data.</p></section> : <CoachChartsPanel api={api} refreshToken={hubRefreshCount} showEmpty />;
                case "zones-heart": case "zones-distance": return <TrainingZoneDistributionCharts size={widgetPreset(widget).chartSize} variant={widget.id === "zones-heart" ? "heart" : "distance"} lthrZones={snapshot?.dashboard?.lthrZones ?? []} activities={activities} analytics={snapshot?.analytics ?? null} />;
                case "scores": return <FitnessScoresPanel size={widgetPreset(widget).chartSize} dashboard={snapshot?.dashboard ?? null} racePredictor={snapshot?.racePredictor ?? null} />;
                case "race": return <RacePredictorCards size={widgetPreset(widget).chartSize} racePredictor={snapshot?.racePredictor ?? null} />;
                case "effort": return <PerceivedEffortPanel size={widgetPreset(widget).chartSize} distribution={snapshot?.analytics?.rpeDistribution} />;
                case "upcoming": return <UpcomingWorkoutsPanel size={widgetPreset(widget).chartSize} workouts={upcomingWorkouts} />;
              }
            }} />
          </div>

          <div
            id={`${tabIdPrefix}-panel-activities`}
            className="stack training-hub-tab-panel"
            role="tabpanel"
            aria-labelledby={`${tabIdPrefix}-tab-activities`}
            tabIndex={0}
            hidden={activeTab !== "activities"}
          >
            {visitedTabs.includes("activities") ? (
              <TrainingActivities
                activities={activities}
                sportTypes={sportTypes}
                selectedActivity={selectedActivity}
                activityDetail={activityDetail}
                busy={busy}
                sampleMode={sampleMode}
                loadPreview={loadActivityPreview}
                resolveLocation={api.reverseGeocodeRouteLocation}
                onLoadDetail={onLoadDetail}
                onExportFile={onExportFile}
              />
            ) : null}
          </div>

          <div
            id={`${tabIdPrefix}-panel-records`}
            className="stack training-hub-tab-panel"
            role="tabpanel"
            aria-labelledby={`${tabIdPrefix}-tab-records`}
            tabIndex={0}
            hidden={activeTab !== "records"}
          >
            {visitedTabs.includes("records") ? (
              <PersonalRecordsPanel
                dashboard={snapshot?.dashboard ?? null}
                celebration={prCelebration.cardCelebration}
                onCelebrate={prCelebration.replay}
              />
            ) : null}
          </div>
        </>
      ) : null}

      {prCelebration.overlayRecord ? (
        <PersonalRecordCelebrationOverlay
          key={prCelebration.overlayNonce}
          record={prCelebration.overlayRecord}
          onDismiss={prCelebration.dismiss}
        />
      ) : null}
    </div>
  );
}

export type { TrainingHubViewProps };
