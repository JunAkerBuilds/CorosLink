import { t, useLanguage } from "../i18n";
import {
  Bike,
  Bug,
  ChevronDown,
  Code2,
  Coffee,
  Dumbbell,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  Footprints,
  Globe2,
  HardDrive,
  HeartPulse,
  Info,
  Languages,
  Loader2,
  CloudSun,
  Mountain,
  Palette,
  PanelLeft,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
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
import { WATCH_SETTING_LABELS, WatchSystemSettings } from "./WatchSystemSettings";
import { LanguageSettings } from "./LanguageSettings";
import { SidebarSettings } from "./SidebarSettings";
import { WatchfaceAutomationSettings } from "./WatchfaceAutomationSettings";
import { WorkoutAutomationSettings } from "./WorkoutAutomationSettings";
import {
  ABOUT_PANE,
  SETTINGS_GROUPS,
  groupTitleForPane,
  paneForSection,
  paneMatches,
  type SettingsPane,
  type SettingsPaneEntry,
  type SettingsSection,
} from "./settingsNav";
import "./settingsView.css";

export type { SettingsSection } from "./settingsNav";

const PANE_ICONS: Record<SettingsPane, LucideIcon> = {
  language: Languages,
  colors: Palette,
  sidebar: PanelLeft,
  profile: HeartPulse,
  watch: SlidersHorizontal,
  weather: CloudSun,
  accounts: UserRound,
  ai: PlugZap,
  privacy: ShieldCheck,
  storage: HardDrive,
  logs: Bug,
  about: Info,
};

/** Panes holding more than one panel keep each panel's own title. */
const MULTI_PANEL_PANES: ReadonlySet<SettingsPane> = new Set(["language", "ai"]);

/** Two weeks of made-up days for the Activity colors preview: none, one sport, or several. */
const COLOR_PREVIEW_DAYS: readonly (readonly SportColorCategory[])[] = [
  ["run"], [], ["strength"], ["run", "strength"], [], ["bike"], ["trail"],
  ["run"], ["other"], [], ["strength", "bike", "run"], ["run"], [], ["trail", "other"],
];

function previewDayBackground(day: readonly SportColorCategory[], colors: Record<SportColorCategory, string>): string | undefined {
  if (!day.length) return undefined;
  if (day.length === 1) return colors[day[0]!];
  const share = 100 / day.length;
  return `conic-gradient(${day.map((sport, index) => `${colors[sport]} ${index * share}% ${(index + 1) * share}%`).join(", ")})`;
}

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
  const [pane, setPane] = useState<SettingsPane>(
    initialAccountScreen && onOpenAccount ? "accounts" : "language",
  );
  const [query, setQuery] = useState("");
  const paneRef = useRef<HTMLDivElement>(null);

  function openPane(next: SettingsPane) {
    setPane(next);
    const element = paneRef.current;
    if (!element) return;
    // Each pane starts at its top. In a narrow window the rail sits above the pane, so bring the pane up to it.
    const rail = element.previousElementSibling;
    const railAbove = rail ? rail.getBoundingClientRect().bottom <= element.getBoundingClientRect().top : false;
    if (railAbove) element.scrollIntoView({ block: "start" });
    else scrollParent(element)?.scrollTo({ top: 0 });
  }

  // A link from elsewhere (watch menu, weather card, Local-Only button) opens the pane holding its section.
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);
  useEffect(() => {
    if (!focusSection) return;
    setPane(paneForSection(focusSection.section));
    setPendingSection(focusSection.section);
    onSectionFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSection?.key]);
  useEffect(() => {
    if (!pendingSection) return;
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
  }, [pendingSection]);
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

  const visibleGroups = SETTINGS_GROUPS.map((group) => ({
    title: group.title,
    panes: group.panes.filter((entry) => paneIsAvailable(entry.id) && matchesSearch(entry)),
  })).filter((group) => group.panes.length);
  const aboutVisible = matchesSearch(ABOUT_PANE);
  const firstMatch = visibleGroups[0]?.panes[0] ?? (aboutVisible ? ABOUT_PANE : undefined);
  const updateWaiting = updateSnapshot.status === "available" || updateSnapshot.status === "downloading" || updateSnapshot.status === "downloaded";

  function paneIsAvailable(id: SettingsPane): boolean {
    return id !== "accounts" || Boolean(onOpenAccount);
  }

  function matchesSearch(entry: SettingsPaneEntry): boolean {
    return paneMatches(entry, query, (text) => t(text), entry.id === "watch" ? WATCH_SETTING_LABELS : []);
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query) {
      event.stopPropagation();
      setQuery("");
    } else if (event.key === "Enter" && firstMatch) {
      openPane(firstMatch.id);
    }
  }

  function railItem(entry: SettingsPaneEntry, badge = false) {
    const Icon = PANE_ICONS[entry.id];
    return (
      <button
        key={entry.id}
        className="settings-rail-item"
        type="button"
        aria-current={pane === entry.id ? "page" : undefined}
        onClick={() => openPane(entry.id)}
      >
        <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
        <span>{t(entry.label)}</span>
        {badge ? <span className="settings-rail-badge" title={updateStatusText ?? undefined} /> : null}
      </button>
    );
  }

  const activeEntry = pane === "about"
    ? ABOUT_PANE
    : SETTINGS_GROUPS.flatMap((group) => group.panes).find((entry) => entry.id === pane)!;
  const activeGroup = groupTitleForPane(pane);

  return (
    <section className="settings-view settings-workspace">
      <aside className="settings-rail" aria-label={t("Settings")}>
        <h1>{t("Settings")}</h1>
        <label className="settings-rail-search">
          <Search size={16} aria-hidden="true" />
          <input
            id="settings-search"
            type="search"
            value={query}
            placeholder={t("Search settings")}
            aria-label={t("Search settings")}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKey}
          />
        </label>
        {visibleGroups.map((group) => (
          <div className="settings-rail-group" key={group.title}>
            <p>{t(group.title)}</p>
            <div>{group.panes.map((entry) => railItem(entry))}</div>
          </div>
        ))}
        {aboutVisible ? <div className="settings-rail-group"><div>{railItem(ABOUT_PANE, updateWaiting)}</div></div> : null}
        {!firstMatch ? <p className="settings-rail-empty" role="status">{t("No setting matches that search.")}</p> : null}
      </aside>

      <div
        ref={paneRef}
        className={`settings-pane${MULTI_PANEL_PANES.has(pane) ? "" : " is-single-panel"}`}
        key={pane}
      >
        <header className="settings-pane-head">
          <div>
            {activeGroup ? <p>{t(activeGroup)}</p> : null}
            <h2>{t(activeEntry.label)}</h2>
          </div>
          {pane === "storage" ? (
            <button
              className="icon-button"
              type="button"
              title={t("Refresh storage sizes")}
              aria-label={t("Refresh storage sizes")}
              onClick={() => void loadAppInfo()}
              disabled={loading}
            >
              <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
            </button>
          ) : null}
        </header>

        {pane === "language" ? (
          <>
            <LanguageSettings />
            <div className="panel settings-units-panel">
              <div className="settings-units-heading">
                <div>
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
          </>
        ) : null}

        {pane === "colors" ? (
          <div className="panel settings-sport-panel">
            <div className="section-heading settings-sport-heading">
              <p className="settings-sport-hint">
                {t("Color activities by sport across the training load heatmap and calendar. A day with one sport uses a solid color; days with several sports are split into a color wheel.")} </p>
              <button
                className="secondary-button"
                type="button"
                onClick={resetSportColors}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {t("Reset to defaults")} </button>
            </div>
            <div className="settings-color-preview" role="img" aria-label={t("Preview")}>
              {COLOR_PREVIEW_DAYS.map((day, index) => {
                const background = previewDayBackground(day, sportColors);
                return <span key={index} className={background ? "has-sport" : undefined} style={background ? { background } : undefined} />;
              })}
            </div>
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
          </div>
        ) : null}

        {pane === "sidebar" ? <SettingsAnchor section="sidebar"><SidebarSettings showDevelopmentItems={showDevelopmentItems} /></SettingsAnchor> : null}
        {pane === "profile" ? <WatchProfileSettings api={api} /> : null}
        {pane === "watch" ? <SettingsAnchor section="watch"><WatchSystemSettings api={api} /></SettingsAnchor> : null}
        {pane === "weather" ? <SettingsAnchor section="weather"><WeatherLocationSettings api={api} /></SettingsAnchor> : null}
        {pane === "accounts" && onOpenAccount ? <AccountsSettings api={api} onOpenAccount={onOpenAccount} /> : null}
        {pane === "ai" ? <><WatchfaceAutomationSettings api={api} /><WorkoutAutomationSettings api={api} /></> : null}
        {pane === "privacy" ? <SettingsAnchor section="privacy"><PrivacySettings api={api} /></SettingsAnchor> : null}

        {pane === "storage" ? (
          <div className="panel settings-storage-detail-panel">
            <p className="settings-subpage-description">
              {t("Review storage use or open an app location on your computer.")} </p>
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
        ) : null}

        {pane === "logs" ? <DiagnosticsSettings api={api} /> : null}

        {pane === "about" ? (
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
        ) : null}
      </div>
    </section>
  );
}

function SettingsAnchor({ section, children }: { section: SettingsSection; children: ReactNode }) {
  return <div id={`settings-section-${section}`} className="settings-section-anchor" tabIndex={-1}>{children}</div>;
}

/** The nearest ancestor that scrolls `element`, if any. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** The top edge of the area that scrolls `element`: its nearest scrolling ancestor, or the window. */
function scrollParentTop(element: HTMLElement): number {
  return scrollParent(element)?.getBoundingClientRect().top ?? 0;
}
