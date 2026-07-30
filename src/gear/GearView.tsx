import {
  Bike,
  CalendarDays,
  Check,
  Footprints,
  Gauge,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CorosGear,
  CorosGearCatalog,
  CorosGearType,
  CorosWatchfaceRegion,
  CorosWatchfaceStatus
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { resolveSportName } from "../training/sportTypes";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  displayDistanceToMeters,
  distanceUnit,
  formatDistanceValue,
  metersToDisplayDistance
} from "../units/units";
import "./gear.css";

const REGION_OPTIONS: ReadonlyArray<{
  value: CorosWatchfaceRegion;
  label: string;
}> = [
  { value: "us", label: "United States" },
  { value: "eu", label: "Europe" },
  { value: "cn", label: "China / Asia-Pacific" }
];

const FALLBACK_SPORTS: Record<CorosGearType, number[]> = {
  1: [100, 101, 102, 103, 104, 900, 105],
  2: [200, 201, 203, 204, 202, 205]
};

function localCalendarDay(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function typeLabel(type: CorosGearType): string {
  return type === 1 ? "Running shoes" : "Bike";
}

function sportLabel(sportType: number): string {
  return resolveSportName({ sportType }) ?? `Sport ${sportType}`;
}

export function GearView({ api }: { api: CorosLinkApi }) {
  const { unitSystem } = useUnitSystem();
  const unit = distanceUnit(unitSystem);
  const [status, setStatus] = useState<CorosWatchfaceStatus | null>(null);
  const [catalog, setCatalog] = useState<CorosGearCatalog | null>(null);
  const [busy, setBusy] = useState<
    "login" | "saved-login" | "query" | "save" | "logout" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [region, setRegion] = useState<CorosWatchfaceRegion>("us");
  const [regionTouched, setRegionTouched] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<CorosGearType>(1);
  const [sportTypes, setSportTypes] = useState<number[]>([100]);
  const [firstUseDay, setFirstUseDay] = useState(localCalendarDay);
  const [initialDistance, setInitialDistance] = useState("0");
  const [lifeDistance, setLifeDistance] = useState(() =>
    String(Math.round(metersToDisplayDistance(700_000, unitSystem)))
  );
  const [notify, setNotify] = useState(true);

  const connected = Boolean(status?.authenticated);
  const availableSports = useMemo(
    () =>
      catalog?.supportedInfo.find((entry) => entry.type === type)
        ?.sportTypeList ?? FALLBACK_SPORTS[type],
    [catalog?.supportedInfo, type]
  );

  async function loadGear() {
    setBusy("query");
    setError(null);
    try {
      setCatalog(await api.queryCorosGear());
    } catch (caught) {
      setError(messageFrom(caught));
      void api.getCorosWatchfaceStatus().then(setStatus).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void api
      .getCorosWatchfaceStatus()
      .then((nextStatus) => {
        if (cancelled) return;
        setStatus(nextStatus);
        if (!regionTouched) {
          setRegion(nextStatus.region ?? nextStatus.suggestedRegion);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(messageFrom(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api, regionTouched]);

  useEffect(() => {
    if (connected && catalog === null) {
      void loadGear();
    }
    // `loadGear` intentionally runs once when an authenticated session appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    setSportTypes((current) => {
      const supported = current.filter((sport) => availableSports.includes(sport));
      return supported.length > 0 ? supported : [availableSports[0]!];
    });
  }, [availableSports]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");
    setError(null);
    setNotice(null);
    try {
      const nextStatus = await api.loginCorosWatchfaces(
        email.trim(),
        password,
        region,
        remember
      );
      setStatus(nextStatus);
      setPassword("");
      setCatalog(null);
      setNotice("COROS mobile account connected.");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSavedLogin() {
    setBusy("saved-login");
    setError(null);
    setNotice(null);
    try {
      const nextStatus = await api.loginCorosWatchfacesWithSavedCredentials(region);
      setStatus(nextStatus);
      setCatalog(null);
      setNotice("COROS mobile account connected.");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    setBusy("logout");
    setError(null);
    try {
      setStatus(await api.logoutCorosWatchfaces());
      setCatalog(null);
      setNotice("COROS mobile account disconnected.");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const initialValue = Number(initialDistance);
      const lifeValue = Number(lifeDistance);
      const nextCatalog = await api.saveCorosGear({
        brandName: name.trim(),
        type,
        sportTypeList: sportTypes,
        firstUseDay,
        initialDistanceMeters: displayDistanceToMeters(initialValue, unitSystem),
        lifeDistanceMeters: displayDistanceToMeters(lifeValue, unitSystem),
        notify
      });
      setCatalog(nextCatalog);
      setName("");
      setInitialDistance("0");
      setNotice(`${typeLabel(type)} added to your COROS account.`);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  }

  const loadingStatus = status === null;

  return (
    <div className="gear-view">
      <header className="gear-header">
        <div>
          <p className="eyebrow">Equipment lifecycle</p>
          <h1>Gear</h1>
          <p>Track shoe and bike mileage in the same gear library as the COROS app.</p>
        </div>
        {connected ? (
          <div className="gear-header-actions">
            <span className="gear-connected-pill">
              <ShieldCheck size={15} aria-hidden="true" />
              COROS connected
            </span>
            <button
              className="secondary-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void loadGear()}
            >
              {busy === "query" ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <RefreshCw size={16} aria-hidden="true" />
              )}
              Refresh
            </button>
            <button
              className="secondary-button danger-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void handleLogout()}
            >
              <LogOut size={16} aria-hidden="true" />
              Disconnect
            </button>
          </div>
        ) : null}
      </header>

      {error ? <div className="gear-message is-error" role="alert">{error}</div> : null}
      {notice ? <div className="gear-message is-success" role="status">{notice}</div> : null}

      {loadingStatus ? (
        <section className="panel gear-loading" aria-busy="true">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          Checking your COROS mobile session…
        </section>
      ) : !connected ? (
        <section className="gear-auth-layout">
          <div className="gear-auth-copy">
            <span className="gear-auth-icon"><Footprints size={30} /></span>
            <p className="eyebrow">One account, every mile</p>
            <h2>Connect your COROS mobile account</h2>
            <p>
              Gear uses the mobile COROS API. The encrypted session is shared
              with Watch Face Studio and stays on this computer.
            </p>
            <div className="gear-auth-points">
              <span><Check size={16} /> Read your current gear library</span>
              <span><Check size={16} /> Add running shoes and bikes</span>
              <span><Check size={16} /> Set mileage alerts and activity types</span>
            </div>
          </div>

          <form className="panel gear-auth-card" onSubmit={handleLogin}>
            <div>
              <p className="eyebrow">COROS sign-in</p>
              <h2>Connect account</h2>
            </div>
            {status.savedCredentialsAvailable ? (
              <button
                className="secondary-button gear-saved-login"
                type="button"
                disabled={busy !== null}
                onClick={() => void handleSavedLogin()}
              >
                {busy === "saved-login" ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <RefreshCw size={16} />
                )}
                Use saved account{status.savedEmail ? ` · ${status.savedEmail}` : ""}
              </button>
            ) : null}
            <label className="field">
              <span>Email</span>
              <span className="gear-input-icon">
                <Mail size={17} aria-hidden="true" />
                <input
                  type="email"
                  value={email}
                  autoComplete="username"
                  placeholder="you@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </span>
            </label>
            <label className="field">
              <span>Password</span>
              <span className="gear-input-icon">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  placeholder="COROS password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </span>
            </label>
            <label className="field">
              <span>Account region</span>
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
            <label className="gear-checkbox gear-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>Save this account securely on this computer</span>
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={busy !== null || !email.trim() || !password}
            >
              {busy === "login" ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              Connect to COROS
            </button>
          </form>
        </section>
      ) : (
        <div className="gear-dashboard">
          <section className="gear-library" aria-labelledby="gear-library-title">
            <div className="gear-section-heading">
              <div>
                <p className="eyebrow">Your equipment</p>
                <h2 id="gear-library-title">
                  {catalog?.gear.length ?? 0} active{" "}
                  {(catalog?.gear.length ?? 0) === 1 ? "item" : "items"}
                </h2>
              </div>
              <Gauge size={23} aria-hidden="true" />
            </div>

            {catalog === null || busy === "query" ? (
              <div className="panel gear-loading">
                <Loader2 className="spin" size={22} />
                Loading COROS gear…
              </div>
            ) : catalog.gear.length === 0 ? (
              <div className="panel gear-empty">
                <Footprints size={28} aria-hidden="true" />
                <h3>No gear yet</h3>
                <p>Add your first pair of shoes or bike with the form.</p>
              </div>
            ) : (
              <div className="gear-card-grid">
                {catalog.gear.map((item) => (
                  <GearCard key={item.gearId} gear={item} unitSystem={unitSystem} />
                ))}
              </div>
            )}
          </section>

          <form className="panel gear-add-card" onSubmit={handleSave}>
            <div className="gear-add-heading">
              <span><Plus size={20} aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">New equipment</p>
                <h2>Add gear</h2>
              </div>
            </div>

            <label className="field">
              <span>Name</span>
              <input
                value={name}
                maxLength={80}
                placeholder={type === 1 ? "Adizero Boston 13" : "Road bike"}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <div className="gear-type-picker" role="group" aria-label="Gear type">
              {([1, 2] as CorosGearType[]).map((gearType) => {
                const Icon = gearType === 1 ? Footprints : Bike;
                return (
                  <button
                    key={gearType}
                    type="button"
                    className={type === gearType ? "is-active" : ""}
                    aria-pressed={type === gearType}
                    onClick={() => setType(gearType)}
                  >
                    <Icon size={18} />
                    {typeLabel(gearType)}
                  </button>
                );
              })}
            </div>

            <label className="field">
              <span>First use</span>
              <span className="gear-input-icon">
                <CalendarDays size={17} aria-hidden="true" />
                <input
                  type="date"
                  value={firstUseDay}
                  onChange={(event) => setFirstUseDay(event.target.value)}
                />
              </span>
            </label>

            <div className="gear-distance-fields">
              <label className="field">
                <span>Starting distance ({unit})</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={initialDistance}
                  onChange={(event) => setInitialDistance(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Replace after ({unit})</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={lifeDistance}
                  onChange={(event) => setLifeDistance(event.target.value)}
                />
              </label>
            </div>

            <fieldset className="gear-sports">
              <legend>Count these activities</legend>
              <div>
                {availableSports.map((sport) => (
                  <label className="gear-sport-chip" key={sport}>
                    <input
                      type="checkbox"
                      checked={sportTypes.includes(sport)}
                      onChange={(event) =>
                        setSportTypes((current) =>
                          event.target.checked
                            ? [...current, sport]
                            : current.filter((item) => item !== sport)
                        )
                      }
                    />
                    <span>{sportLabel(sport)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="gear-checkbox">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
              />
              <span>
                Alert me at the replacement distance
                <small>COROS will use this limit for its gear notification.</small>
              </span>
            </label>

            <button
              className="primary-button gear-save-button"
              type="submit"
              disabled={
                busy !== null ||
                !name.trim() ||
                !firstUseDay ||
                sportTypes.length === 0 ||
                !Number.isFinite(Number(initialDistance)) ||
                !Number.isFinite(Number(lifeDistance))
              }
            >
              {busy === "save" ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <Plus size={17} />
              )}
              Add to COROS
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function GearCard({
  gear,
  unitSystem
}: {
  gear: CorosGear;
  unitSystem: "metric" | "imperial";
}) {
  const Icon = gear.type === 1 ? Footprints : Bike;
  const usedMeters = Math.max(
    0,
    gear.initialDistanceMeters + gear.realDistanceMeters
  );
  const progress =
    gear.lifeDistanceMeters > 0
      ? Math.min(100, (usedMeters / gear.lifeDistanceMeters) * 100)
      : 0;
  const sportNames = gear.sportTypeList.map(sportLabel);

  return (
    <article className="panel gear-card">
      <div className="gear-card-top">
        <span className="gear-card-icon"><Icon size={22} /></span>
        <div>
          <span>{typeLabel(gear.type)}</span>
          <h3>{gear.name}</h3>
        </div>
        {gear.notify ? <span className="gear-alert-pill">Alert on</span> : null}
      </div>
      <div className="gear-distance-summary">
        <strong>{formatDistanceValue(usedMeters, unitSystem, { digits: 1 })}</strong>
        <span>of {formatDistanceValue(gear.lifeDistanceMeters, unitSystem, { digits: 0 })}</span>
      </div>
      <div
        className="gear-progress"
        role="progressbar"
        aria-label={`${gear.name} lifespan`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="gear-card-meta">
        <span>Since {new Date(`${gear.firstUseDay}T00:00:00`).toLocaleDateString()}</span>
        <span>{sportNames.join(" · ") || "No activities"}</span>
      </div>
    </article>
  );
}
