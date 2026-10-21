import { t, useLanguage } from "../i18n";
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
  Ruler,
  Sparkles,
  UserRound,
  Music,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
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
import appLogo from "../../build/icon-animated.svg";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { AccountsSettings, type AccountDestination } from "./AccountsSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { PrivacySettings } from "./PrivacySettings";
import { WatchProfileSettings } from "./WatchProfileSettings";
import { WeatherLocationSettings } from "./WeatherLocationSettings";
import { WatchSystemSettings } from "./WatchSystemSettings";
import { LanguageSettings } from "./LanguageSettings";
import { SidebarSettings } from "./SidebarSettings";

const ABOUT_LINKS = [
  {
    label: "Website",
    href: "https://coroslink.com/",
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

/** Settings sections other screens link straight to. */
export type SettingsSection = "watch" | "weather" | "privacy" | "sidebar";

interface SettingsViewProps {
  api: CorosLinkApi;
  /** Scrolls to this section; `key` changes on every request, so asking twice works. */
  focusSection?: { section: SettingsSection; key: number };
  onSectionFocused?: () => void;
  updateSnapshot: AppUpdateSnapshot;
  updateBusy: boolean;
  onCheckForUpdates: () => void;
  onError: (message: string) => void;
  initialAccountScreen?: boolean;
  onOpenAccount?: (destination: AccountDestination) => void;
  showDevelopmentItems?: boolean;
}

export function SettingsView({
  api,
  updateSnapshot,
  updateBusy,
  onCheckForUpdates,
  onError,
  onOpenAccount,
  initialAccountScreen = false,
  focusSection,
  onSectionFocused,
  showDevelopmentItems = false,
}: SettingsViewProps) {
  useLanguage();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingLocationId, setOpeningLocationId] = useState<string | null>(
    null,
  );
  const [settingsPage, setSettingsPage] = useState<"accounts" | "main" | "storage">(
    initialAccountScreen && onOpenAccount ? "accounts" : "main",
  );

  // A link from elsewhere (watch menu, weather card, Local-Only button) opens the main page at its section.
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);
  useEffect(() => {
    if (!focusSection) return;
    setSettingsPage("main");
    setPendingSection(focusSection.section);
    onSectionFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSection?.key]);
  useEffect(() => {
    if (!pendingSection || settingsPage !== "main") return;
    setPendingSection(null);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      const element = document.getElementById(`settings-section-${pendingSection}`);
      if (!element) return;
      element.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      element.focus({ preventScroll: true });
      element.classList.add("is-targeted");
      window.setTimeout(() => element.classList.remove("is-targeted"), 1600);
      // Panels above load a moment later and can push the section down; settle on it once they have.
      window.setTimeout(() => {
        if (Math.abs(element.getBoundingClientRect().top - scrollParentTop(element)) > 40) element.scrollIntoView({ block: "start" });
      }, 700);
    });
  }, [pendingSection, settingsPage]);
  const [sportColors, setSportColors] = useState(() => readStoredSportColors());
  const { unitSystem, setUnitSystem } = useUnitSystem();

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
        caught instanceof Error ? caught.message : t("Could not load app info."),
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
          : t("Could not open that folder."),
      );
    } finally {
      setOpeningLocationId(null);
    }
  }

  const updateStatusText =
    updateSnapshot.status === "available" ||
    updateSnapshot.status === "downloading"
      ? t("Version {{version}} is available.", { version: updateSnapshot.availableVersion })
      : updateSnapshot.status === "downloaded"
        ? t("Version {{version}} is ready to install.", { version: updateSnapshot.availableVersion })
        : updateSnapshot.status === "not-available"
          ? t("You're on the latest version.")
          : null;

  if (settingsPage === "accounts" && onOpenAccount) {
    return (
      <section className="settings-view">
        <AccountsSettings api={api} onOpenAccount={onOpenAccount} onBack={() => setSettingsPage("main")} />
      </section>
    );
  }

  if (settingsPage === "storage") {
    return (
      <section className="settings-view settings-subpage">
        <button
          className="settings-subpage-back"
          type="button"
          onClick={() => setSettingsPage("main")}
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
          {t("Settings")} </button>

        <div className="panel settings-storage-detail-panel">
          <div className="section-heading settings-storage-detail-heading">
            <div>
              <p className="eyebrow">{t("Storage")}</p>
              <h2>{t("On this computer")}</h2>
              <p className="settings-subpage-description">
                {t("Review storage use or open an app location on your computer.")} </p>
            </div>
            <button
              className="icon-button"
              type="button"
              title={t("Refresh storage sizes")}
              aria-label={t("Refresh storage sizes")}
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
                      <strong>{t(location.label)}</strong>
                      <span className="settings-storage-size">
                        {location.exists
                          ? location.sizeBytes !== null
                            ? formatBytes(location.sizeBytes)
                            : t("Size unavailable")
                          : t("Not created yet")}
                      </span>
                    </div>
                    <p>{t(location.description)}</p>
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
                    {t("Open in Folder")} </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-storage-loading">
              <Loader2 size={16} aria-hidden="true" className="spin" />
              {t("Loading storage locations…")} </p>
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
              {t("Unofficial COROS companion for media, watch sync, and training analytics.")} </p>
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
            {t("Check for updates")} </button>
        </div>

        <dl className="settings-version-grid">
          <div>
            <dt>{t("App version")}</dt>
            <dd>{appInfo?.version ?? updateSnapshot.currentVersion}</dd>
          </div>
          <div>
            <dt>{t("Platform")}</dt>
            <dd>{appInfo ? platformLabel(appInfo) : t("Not available")}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{appInfo?.electronVersion ?? t("Not available")}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{appInfo?.chromeVersion ?? t("Not available")}</dd>
          </div>
          <div>
            <dt>Node.js</dt>
            <dd>{appInfo?.nodeVersion ?? t("Not available")}</dd>
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
              <span>{t(label)}</span>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ))}
        </div>
      </div>

      {onOpenAccount ? (
        <button className="settings-account-entry" type="button" onClick={() => setSettingsPage("accounts")}>
          <span className="settings-account-entry-icon"><UserRound size={26} aria-hidden="true" /></span>
          <span className="settings-account-entry-copy"><strong>{t("Accounts & API")}</strong><span>{t("Manage accounts, API keys, and connected services")}</span></span>
          <span className="settings-account-entry-services" aria-hidden="true"><Music size={18} /><CalendarDays size={18} /><Sparkles size={18} /></span>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      ) : null}


      <LanguageSettings />

      <div className="panel settings-units-panel">
        <div className="settings-units-heading">
          <span className="settings-units-icon" aria-hidden="true">
            <Ruler size={22} strokeWidth={1.9} />
          </span>
          <div>
            <p className="eyebrow">{t("Measurements")}</p>
            <h2>{t("Units")}</h2>
            <p>
              {t("Choose how distance, pace, elevation, swimming, and strength values appear throughout CorosLink.")} </p>
          </div>
        </div>
        <div className="settings-unit-options" role="radiogroup" aria-label={t("Unit system")}>
          {([
            {
              value: "metric" as const,
              label: t("Metric"),
              detail: t("Kilometres, metres, min/km, kilograms")
            },
            {
              value: "imperial" as const,
              label: t("Imperial"),
              detail: t("Miles, feet, min/mi, pounds, yards")
            }
          ]).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={unitSystem === option.value}
              className={unitSystem === option.value ? "is-active" : ""}
              onClick={() => setUnitSystem(option.value)}
            >
              <span className="settings-unit-radio" aria-hidden="true" />
              <span>
                <strong>{t(option.label)}</strong>
                <small>{option.detail}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <SettingsAnchor section="sidebar"><SidebarSettings showDevelopmentItems={showDevelopmentItems} /></SettingsAnchor>

      <div className="panel settings-sport-panel">
        <div className="section-heading settings-sport-heading">
          <div>
            <p className="eyebrow">{t("Appearance")}</p>
            <h2>{t("Activity colors")}</h2>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={resetSportColors}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {t("Reset to defaults")} </button>
        </div>
        <p className="settings-sport-hint">
          {t("Color activities by sport across the training load heatmap and calendar. A day with one sport uses a solid color; days with several sports are split into a color wheel.")} </p>
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
                  <strong>{t(SPORT_COLOR_LABELS[cat])}</strong>
                  <span>{t(description)}</span>
                </span>
                <label className="settings-sport-picker">
                  <input
                    type="color"
                    className="settings-sport-input"
                    value={sportColors[cat]}
                    onChange={(event) =>
                      updateSportColor(cat, event.target.value)
                    }
                    aria-label={t("{{value0}} color", { value0: t(SPORT_COLOR_LABELS[cat]) })}
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
            <strong>{t("Tip:")}</strong> {t("These colors are used in your training load heatmap and calendar.")} </p>
        </div>
      </div>

      <WatchProfileSettings api={api} />

      <SettingsAnchor section="weather"><WeatherLocationSettings api={api} /></SettingsAnchor>

      <SettingsAnchor section="watch"><WatchSystemSettings api={api} /></SettingsAnchor>

      <SettingsAnchor section="privacy"><PrivacySettings api={api} /></SettingsAnchor>

      <div className="panel settings-storage-panel">
        <p className="eyebrow">{t("Storage")}</p>
        <button
          className="settings-storage-link"
          type="button"
          onClick={() => setSettingsPage("storage")}
        >
          <span className="settings-storage-link-icon" aria-hidden="true">
            <HardDrive size={22} strokeWidth={1.9} />
          </span>
          <span className="settings-storage-link-copy">
            <strong>{t("On this computer")}</strong>
            <span>
              {appInfo
                ? t("{{value0}} storage locations", { value0: appInfo.storageLocations.length })
                : t("Downloads, projects, caches, and app data")}
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

      <DiagnosticsSettings api={api} />
    </section>
  );
}

function SettingsAnchor({ section, children }: { section: SettingsSection; children: ReactNode }) {
  return <div id={`settings-section-${section}`} className="settings-section-anchor" tabIndex={-1}>{children}</div>;
}

/** The top edge of the area that scrolls `element`: its nearest scrolling ancestor, or the window. */
function scrollParentTop(element: HTMLElement): number {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node.getBoundingClientRect().top;
  }
  return 0;
}
