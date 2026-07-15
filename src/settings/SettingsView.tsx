import {
  ArrowLeft,
  Bike,
  Bug,
  ChevronDown,
  ChevronRight,
  Code2,
  Coffee,
  Dumbbell,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  Footprints,
  Globe2,
  HardDrive,
  Loader2,
  Mountain,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { AppInfo, AppUpdateSnapshot } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatBytes } from "../media/libraryUtils";
import {
  DEFAULT_SPORT_COLORS,
  SPORT_COLOR_CATEGORIES,
  SPORT_COLOR_LABELS,
  applySportColors,
  readStoredSportColors,
  storeSportColors,
  type SportColorCategory,
} from "../training/sportColors";
import appLogo from "../../build/icon.png";

const ABOUT_LINKS = [
  {
    label: "Website",
    href: "https://coros-link.vercel.app/",
    icon: Globe2,
  },
  {
    label: "Source on GitHub",
    href: "https://github.com/JunAkerBuilds/CorosLink",
    icon: Code2,
  },
  {
    label: "Report an issue",
    href: "https://github.com/JunAkerBuilds/CorosLink/issues",
    icon: Bug,
  },
  {
    label: "Support the project",
    href: "https://www.buymeacoffee.com/addridoa",
    icon: Coffee,
  },
];

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const SPORT_COLOR_DETAILS: Record<
  SportColorCategory,
  { description: string; icon: LucideIcon }
> = {
  strength: {
    description: "Weight training, strength sessions, gym workouts",
    icon: Dumbbell,
  },
  trail: {
    description: "Trail running, hiking, off-road activities",
    icon: Mountain,
  },
  run: {
    description: "Outdoor runs, track runs, intervals",
    icon: Footprints,
  },
  bike: {
    description: "Road cycling, indoor cycling, e-bike",
    icon: Bike,
  },
  other: {
    description: "Yoga, pilates, mobility, mixed and other activities",
    icon: Ellipsis,
  },
};

function platformLabel(info: AppInfo): string {
  const name = PLATFORM_LABELS[info.platform] ?? info.platform;
  return `${name} (${info.arch})`;
}

interface SettingsViewProps {
  api: CorosLinkApi;
  updateSnapshot: AppUpdateSnapshot;
  updateBusy: boolean;
  onCheckForUpdates: () => void;
  onError: (message: string) => void;
}

export function SettingsView({
  api,
  updateSnapshot,
  updateBusy,
  onCheckForUpdates,
  onError,
}: SettingsViewProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingLocationId, setOpeningLocationId] = useState<string | null>(
    null,
  );
  const [settingsPage, setSettingsPage] = useState<"main" | "storage">("main");
  const [sportColors, setSportColors] = useState(() => readStoredSportColors());

  function updateSportColor(cat: SportColorCategory, value: string) {
    const next = { ...sportColors, [cat]: value };
    setSportColors(next);
    storeSportColors(next);
    applySportColors(next);
  }

  function resetSportColors() {
    const next = { ...DEFAULT_SPORT_COLORS };
    setSportColors(next);
    storeSportColors(next);
    applySportColors(next);
  }

  const loadAppInfo = useCallback(async () => {
    setLoading(true);
    try {
      setAppInfo(await api.getAppInfo());
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : "Could not load app info.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => {
    void loadAppInfo();
  }, [loadAppInfo]);

  async function handleOpenLocation(id: string) {
    setOpeningLocationId(id);
    try {
      await api.openAppStorageLocation(id);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not open that folder.",
      );
    } finally {
      setOpeningLocationId(null);
    }
  }

  const updateStatusText =
    updateSnapshot.status === "available" ||
    updateSnapshot.status === "downloading"
      ? `Version ${updateSnapshot.availableVersion} is available.`
      : updateSnapshot.status === "downloaded"
        ? `Version ${updateSnapshot.availableVersion} is ready to install.`
        : updateSnapshot.status === "not-available"
          ? "You're on the latest version."
          : null;

  if (settingsPage === "storage") {
    return (
      <section className="settings-view settings-subpage">
        <button
          className="settings-subpage-back"
          type="button"
          onClick={() => setSettingsPage("main")}
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
          Settings
        </button>

        <div className="panel settings-storage-detail-panel">
          <div className="section-heading settings-storage-detail-heading">
            <div>
              <p className="eyebrow">Storage</p>
              <h2>On this computer</h2>
              <p className="settings-subpage-description">
                Review storage use or open an app location on your computer.
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Refresh storage sizes"
              aria-label="Refresh storage sizes"
              onClick={() => void loadAppInfo()}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
                className={loading ? "spin" : ""}
              />
            </button>
          </div>

          {appInfo ? (
            <ul className="settings-storage-list">
              {appInfo.storageLocations.map((location) => (
                <li className="settings-storage-row" key={location.id}>
                  <div className="settings-storage-info">
                    <div className="settings-storage-title">
                      <strong>{location.label}</strong>
                      <span className="settings-storage-size">
                        {location.exists
                          ? location.sizeBytes !== null
                            ? formatBytes(location.sizeBytes)
                            : "Size unavailable"
                          : "Not created yet"}
                      </span>
                    </div>
                    <p>{location.description}</p>
                    <code className="settings-storage-path">
                      {location.path}
                    </code>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void handleOpenLocation(location.id)}
                    disabled={
                      openingLocationId === location.id ||
                      (location.kind === "file" && !location.exists)
                    }
                  >
                    {openingLocationId === location.id ? (
                      <Loader2 size={15} aria-hidden="true" className="spin" />
                    ) : (
                      <FolderOpen size={15} aria-hidden="true" />
                    )}
                    Open in Folder
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-storage-loading">
              <Loader2 size={16} aria-hidden="true" className="spin" />
              Loading storage locations…
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="settings-view">
      <div className="panel settings-about-panel">
        <div className="settings-about-header">
          <img
            className="settings-about-logo"
            src={appLogo}
            alt=""
            aria-hidden="true"
          />
          <div className="settings-about-copy">
            <h3>CorosLink</h3>
            <p>
              Unofficial COROS companion for media, watch sync, and training
              analytics.
            </p>
            {updateStatusText ? (
              <p className="settings-update-status">{updateStatusText}</p>
            ) : null}
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={onCheckForUpdates}
            disabled={updateBusy}
          >
            <RefreshCw
              size={15}
              aria-hidden="true"
              className={updateBusy ? "spin" : ""}
            />
            Check for updates
          </button>
        </div>

        <dl className="settings-version-grid">
          <div>
            <dt>App version</dt>
            <dd>{appInfo?.version ?? updateSnapshot.currentVersion}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{appInfo ? platformLabel(appInfo) : "Not available"}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{appInfo?.electronVersion ?? "Not available"}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{appInfo?.chromeVersion ?? "Not available"}</dd>
          </div>
          <div>
            <dt>Node.js</dt>
            <dd>{appInfo?.nodeVersion ?? "Not available"}</dd>
          </div>
        </dl>

        <div className="settings-about-links">
          {ABOUT_LINKS.map(({ label, href, icon: Icon }) => (
            <a
              key={href}
              className="settings-about-link"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ))}
        </div>
      </div>

      <div className="panel settings-sport-panel">
        <div className="section-heading settings-sport-heading">
          <div>
            <p className="eyebrow">Appearance</p>
            <h2>Activity colors</h2>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={resetSportColors}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Reset to defaults
          </button>
        </div>
        <p className="settings-sport-hint">
          Color activities by sport across the training load heatmap and
          calendar. A day with one sport uses a solid color; days with several
          sports are split into a color wheel.
        </p>
        <ul className="settings-sport-list">
          {SPORT_COLOR_CATEGORIES.map((cat) => {
            const { description, icon: SportIcon } = SPORT_COLOR_DETAILS[cat];
            const colorStyle = {
              "--sport-color": sportColors[cat],
            } as CSSProperties;

            return (
              <li
                className="settings-sport-row"
                key={cat}
                style={colorStyle}
              >
                <span className="settings-sport-icon" aria-hidden="true">
                  <SportIcon size={21} strokeWidth={2.1} />
                </span>
                <span className="settings-sport-copy">
                  <strong>{SPORT_COLOR_LABELS[cat]}</strong>
                  <span>{description}</span>
                </span>
                <label className="settings-sport-picker">
                  <input
                    type="color"
                    className="settings-sport-input"
                    value={sportColors[cat]}
                    onChange={(event) =>
                      updateSportColor(cat, event.target.value)
                    }
                    aria-label={`${SPORT_COLOR_LABELS[cat]} color`}
                  />
                  <span className="settings-sport-swatch" aria-hidden="true" />
                  <span className="settings-sport-hex">
                    {sportColors[cat].toUpperCase()}
                  </span>
                  <ChevronDown size={18} strokeWidth={2} aria-hidden="true" />
                </label>
              </li>
            );
          })}
        </ul>
        <div className="settings-sport-tip">
          <Sparkles size={18} strokeWidth={1.8} aria-hidden="true" />
          <p>
            <strong>Tip:</strong> These colors are used in your training load
            heatmap and calendar.
          </p>
        </div>
      </div>

      <div className="panel settings-storage-panel">
        <p className="eyebrow">Storage</p>
        <button
          className="settings-storage-link"
          type="button"
          onClick={() => setSettingsPage("storage")}
        >
          <span className="settings-storage-link-icon" aria-hidden="true">
            <HardDrive size={22} strokeWidth={1.9} />
          </span>
          <span className="settings-storage-link-copy">
            <strong>On this computer</strong>
            <span>
              {appInfo
                ? `${appInfo.storageLocations.length} storage locations`
                : "Downloads, projects, caches, and app data"}
            </span>
          </span>
          <ChevronRight
            className="settings-storage-link-chevron"
            size={20}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>
    </section>
  );
}
