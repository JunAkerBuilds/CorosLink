import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRightFromLine,
  ChartNoAxesColumnIncreasing,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  FlaskConical,
  ArrowLeft,
  Globe2,
  KeyRound,
  LockKeyhole,
  Loader2,
  LogOut,
  Mail,
  Monitor,
  ShieldCheck,
  Trophy,
  User,
  RefreshCw
} from "lucide-react";
import { ActivityDetailPanel } from "./components/ActivityDetailPanel";
import { CoachChartsPanel } from "./components/CoachChartsPanel";
import { FitnessScoresPanel } from "./components/FitnessScoresPanel";
import { FitnessTrendPanel } from "./components/FitnessTrendPanel";
import { PersonalRecordsPanel } from "./components/PersonalRecordsPanel";
import { RacePredictorCards } from "./components/RacePredictorCards";
import { RecoveryRing } from "./components/RecoveryRing";
import { SleepSummaryPanel } from "./components/SleepSummaryPanel";
import { TrainingHeatmapPanel } from "./components/TrainingHeatmapPanel";
import { TrainingSummaryTiles } from "./components/TrainingSummaryTiles";
import { TrainingActivityTable } from "./components/TrainingActivityTable";
import { TrainingTrendCharts } from "./components/TrainingTrendChart";
import {
  PerceivedEffortPanel,
  TrainingZoneDistributionCharts
} from "./components/TrainingZoneDistributionCharts";
import { UpcomingWorkoutsPanel } from "./components/UpcomingWorkoutsPanel";
import { Vo2MaxWidget } from "./components/Vo2MaxWidget";
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
    <div className="stack">
      <div className="training-preview-toolbar">
        <p role="status">
          {sample
            ? "Showing sample data across the whole Training Hub."
            : "Preview the whole Training Hub with sample data."}
        </p>
        <button
          type="button"
          className="training-preview-toggle"
          role="switch"
          aria-checked={sample !== null}
          onClick={() => {
            setSelectedSample(null);
            setSample(current => current ? null : createTrainingHubSampleData());
          }}
        >
          <FlaskConical size={14} aria-hidden="true" />
          Sample data
        </button>
      </div>
      <TrainingHubContent
        key={sample ? "sample" : "live"}
        {...previewProps}
        sampleMode={sample !== null}
      />
    </div>
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
  sampleMode = false
}: TrainingHubViewProps & { sampleMode?: boolean }) {
  const connected = sampleMode || Boolean(status?.authenticated);
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
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const signInBackgroundStyle = connected
    ? undefined
    : ({
        "--training-signin-bg": `url(${loginPageBackground})`
      } as CSSProperties);
  const activityCountLabel = `${activities.length} recent ${
    activities.length === 1 ? "activity" : "activities"
  }`;
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
      <section
        className={`panel training-command-center ${
          connected ? "is-connected is-compact" : "is-disconnected"
        }`}
        style={signInBackgroundStyle}
      >
        {connected ? (
          <div className="training-connection-shell">
            <div className="training-connection-bar">
              <div className="training-connection-primary">
                <span
                  className="training-status-dot is-connected"
                  aria-hidden="true"
                />
                <span className="training-connection-label">
                  {sampleMode ? "Training Hub preview" : "COROS account connected"}
                </span>
                <span className="badge ready">
                  {sampleMode ? <FlaskConical size={12} aria-hidden="true" /> : <ShieldCheck size={12} aria-hidden="true" />}
                  {sampleMode ? "Sample data" : "Authenticated"}
                </span>
              </div>
              {!sampleMode ? <div className="training-connection-actions settings-actions">
                <button
                  className="training-details-button"
                  type="button"
                  onClick={() => setShowConnectionDetails((current) => !current)}
                >
                  {showConnectionDetails ? (
                    <EyeOff size={14} aria-hidden="true" />
                  ) : (
                    <Eye size={14} aria-hidden="true" />
                  )}
                  {showConnectionDetails ? "Hide" : "Details"}
                </button>
                <button
                  className="secondary-button training-connection-button"
                  type="button"
                  disabled={busy === "training-refresh"}
                  onClick={onRefresh}
                >
                  {busy === "training-refresh" ? (
                    <Loader2 className="spin" size={15} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={15} aria-hidden="true" />
                  )}
                  Refresh
                </button>
                <button
                  className="secondary-button danger-button training-connection-button"
                  type="button"
                  disabled={busy === "training-logout"}
                  onClick={onLogout}
                >
                  <LogOut size={15} aria-hidden="true" />
                  Disconnect
                </button>
              </div> : null}
            </div>
            {!sampleMode && showConnectionDetails ? (
              <div className="training-connection-meta">
                <span className="training-connection-meta-item">
                  <User size={14} aria-hidden="true" />
                  <span>User ID</span>
                  <strong>{status?.userId ?? "Unknown"}</strong>
                </span>
                <span className="training-connection-meta-item">
                  <Globe2 size={14} aria-hidden="true" />
                  <span>Region</span>
                  <strong>{status?.regionId ?? "Unknown"}</strong>
                </span>
                <span className="training-connection-meta-item">
                  <Database size={14} aria-hidden="true" />
                  <span>API host</span>
                  <strong>{status?.baseUrl ?? "Unknown"}</strong>
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <>
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
          </>
        )}
      </section>

      {connected ? (
        <>
          <section className="training-intelligence">
            <div className="training-intelligence-header">
              <p className="eyebrow">Training Intelligence</p>
              {busy === "training-refresh" ? (
                <span className="training-sync-pill is-syncing">
                  <span className="training-sync-dot" aria-hidden="true" />
                  Syncing data
                </span>
              ) : null}
            </div>
            <div className="training-intelligence-grid">
              <div className="training-recovery-column">
                <RecoveryRing summary={summary} />
                <TrainingSummaryTiles
                  summary={summary}
                  trendPoints={snapshot?.trendPoints}
                  healthRecords={snapshot?.dailyHealth?.records}
                  layout="stack"
                  metrics={["load", "heart", "steps", "calories"]}
                  className="training-recovery-stats"
                />
              </div>
              <FitnessTrendPanel snapshot={snapshot} activities={activities} />
              <SleepSummaryPanel
                sleep={snapshot?.sleep}
                connecting={sleepConnecting}
                refreshing={busy === "training-refresh"}
              />
              <Vo2MaxWidget snapshot={snapshot} />
            </div>
          </section>

          <div className="training-heatmap-wrap">
            <TrainingHeatmapPanel
              snapshot={snapshot}
              activities={activities}
              rpeBackfill={rpeBackfill}
            />
          </div>
          <TrainingTrendCharts points={snapshot?.trendPoints ?? []} sleepRecords={snapshot?.sleep?.records} />
          {sampleMode ? null : (
            <CoachChartsPanel api={api} refreshToken={hubRefreshCount} />
          )}
          <TrainingZoneDistributionCharts
            lthrZones={snapshot?.dashboard?.lthrZones ?? []}
            activities={activities}
            analytics={snapshot?.analytics ?? null}
          />

          <div className="training-secondary-grid">
            <FitnessScoresPanel
              dashboard={snapshot?.dashboard ?? null}
              racePredictor={snapshot?.racePredictor ?? null}
            />
            <RacePredictorCards racePredictor={snapshot?.racePredictor ?? null} />
            <PerceivedEffortPanel
              distribution={snapshot?.analytics?.rpeDistribution}
            />
          </div>

          <div className="training-planning-grid">
            <UpcomingWorkoutsPanel workouts={upcomingWorkouts} />
            <PersonalRecordsPanel dashboard={snapshot?.dashboard ?? null} />
          </div>

          <section className="panel training-activities-split-panel">
            <div className="training-activities-split">
              <div className="training-activities-list">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Recent Activities</p>
                    <h2>{activityCountLabel}</h2>
                  </div>
                  <Activity size={22} aria-hidden="true" />
                </div>
                <TrainingActivityTable
                  activities={activities}
                  sportTypes={sportTypes}
                  selectedActivityId={selectedActivity?.activityId ?? null}
                  busy={busy}
                  exportDisabled={sampleMode}
                  onLoadDetail={onLoadDetail}
                  onExportFile={onExportFile}
                />
              </div>
              <div className="training-activities-detail">
                <ActivityDetailPanel
                  detail={activityDetail}
                  listActivity={selectedActivity}
                  sportTypes={sportTypes}
                  busy={busy}
                  embedded
                />
              </div>
            </div>
          </section>

        </>
      ) : null}
    </div>
  );
}

export type { TrainingHubViewProps };
