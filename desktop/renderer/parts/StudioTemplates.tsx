// Studio home's Templates tab: COROS's editable templates for the chosen watch (bundled with the app; the live list
// with the advanced filters once signed in), COROS's official faces and the faces saved to the COROS account. Each
// opens as a new project.
import { useEffect, useMemo, useState } from "react";
import { Button, Field, Segmented, Select } from "@/components/ui";
import { msg, t, tx } from "@/lib/i18n";
import { WATCHFACE_TARGETS, type WatchfaceTarget } from "../../watchface/watchfaceTargets";
import { FaceView } from "./FaceView";
import { Icon } from "./StudioIcon";
import {
  corosPicture, listCorosFaces, listTemplates, said, StudioProblem, templatePicture, type AccountStatus, type CorosCatalog, type CorosFilters,
} from "../studio";

export interface TemplateItem { id: string; name: string; category?: string; templateType?: number; picture: string | null }
export type TemplateSort = "coros" | "name";

/** COROS names templates in capitals ("PAPER CLIP"); shown as "Paper clip". */
export function titleCase(name: string): string {
  return /[a-z]/.test(name) ? name : name.charAt(0) + name.slice(1).toLowerCase();
}
const kind = (tp: TemplateItem) => (tp.templateType === 2 ? msg("Analog") : tp.templateType === 1 ? msg("Digital") : tp.category);

const LANGUAGES = [["en-US", "English"], ["zh-CN", "简体中文"], ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["es-ES", "Español"], ["it-IT", "Italiano"], ["ja-JP", "日本語"], ["ko-KR", "한국어"]] as const;
/** Special-edition watches with their own exclusive faces; COROS unlocks them by the watch's serial (CorosLink's presets). */
const EXCLUSIVES = [
  { sn: "W51E005280", firmwareType: "COROS W541", label: "APEX 4 · SATISFY" },
  { sn: "W36C018325", firmwareType: "COROS W336", label: "PACE 4 · Jakob Ingebrigtsen Edition" },
] as const;

export function TemplatesTab({ watch, target, query, onQuery, sort, onSort, account, onSignIn, onSignedOut, onStart, onOpen, starting }: {
  watch: string; target: WatchfaceTarget; query: string; onQuery: (q: string) => void; sort: TemplateSort; onSort: (s: TemplateSort) => void; account: AccountStatus | null;
  onSignIn: () => void; starting: string | null;
  /** COROS answered that the session is gone: the page reads the account again. */
  onSignedOut: () => void;
  /** A template (or blank on the watch's first digital one) as a new project. */
  onStart: (template: TemplateItem, blank: boolean, all: TemplateItem[]) => void;
  /** An official or saved COROS face as a new project. */
  onOpen: (catalog: CorosCatalog, face: TemplateItem) => void;
}) {
  const signedIn = Boolean(account?.signedIn);
  const [source, setSource] = useState<CorosCatalog>("editable");
  // The category and the list belong to the watch and source they were picked for.
  const [picked, setPicked] = useState({ at: "", category: "all" });
  const category = picked.at === `${watch}|${source}` ? picked.category : "all";
  const setCategory = (c: string) => setPicked({ at: `${watch}|${source}`, category: c });
  const [advanced, setAdvanced] = useState(false);
  const [filters, setFilters] = useState<CorosFilters>({});
  // Firmware type as typed: any COROS firmware string ("COROS W332"), with the known watches suggested.
  const [firmwareDraft, setFirmwareDraft] = useState<string | null>(null);
  const live = signedIn;
  const filterKey = JSON.stringify(filters);
  const listKey = JSON.stringify([watch, source, signedIn, filterKey]);
  const [loaded, setLoaded] = useState<{ key: string; items: TemplateItem[] | null; problem: string | null }>({ key: "", items: null, problem: null });
  const items = loaded.key === listKey ? loaded.items : null;
  const problem = loaded.key === listKey ? loaded.problem : null;

  useEffect(() => {
    let current = true;
    let note: string | null = null;
    const bundled = () => listTemplates(watch).then((tp) => tp.templates.map((x): TemplateItem => ({ ...x, picture: templatePicture(watch, x.id) })));
    const load = async (): Promise<TemplateItem[]> => {
      if (source !== "editable") {
        if (!signedIn) return [];
        const faces = await listCorosFaces(source, watch, filters);
        return faces.map((f) => ({ ...f, picture: f.picture ? corosPicture(source, f.id) : null }));
      }
      if (!live) return bundled();
      try {
        const faces = await listCorosFaces("editable", watch, filters);
        return faces.map((f) => ({ ...f, picture: f.picture ? templatePicture(watch, f.id) : null }));
      } catch (e) {
        if (e instanceof StudioProblem && e.code === "signedOut") onSignedOut();
        note = `${said(e)} ${t("Showing the templates that come with C-LINK.")}`;
        return bundled();
      }
    };
    load().then((list) => { if (current) setLoaded({ key: listKey, items: list, problem: note }); }, (e) => {
      if (e instanceof StudioProblem && e.code === "signedOut") onSignedOut();
      if (current) setLoaded({ key: listKey, items: [], problem: said(e) });
    });
    return () => { current = false; };
    // filterKey stands for the filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tp of items ?? []) { const k = kind(tp); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (items ?? []).filter((tp) => (category === "all" || kind(tp) === category) &&
      (!q || tp.name.toLowerCase().includes(q) || tp.id.includes(q) || (kind(tp) ?? "").toLowerCase().includes(q)));
    return sort === "name" ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list;
  }, [items, category, query, sort]);

  const set = (patch: CorosFilters) => setFilters((f) => ({ ...f, ...patch }));
  const needsSignIn = source !== "editable" && !signedIn;
  const firmware = filters.firmwareType || target.firmwareType;
  const commitFirmware = () => {
    if (firmwareDraft === null) return;
    const typed = firmwareDraft.trim().replace(/\s+/g, " ");
    setFirmwareDraft(null);
    set({ firmwareType: !typed || typed === target.firmwareType ? undefined : typed });
  };
  // One list for the watch the faces are for: COROS's watches, then (for official and saved faces) the special editions,
  // which are a watch's firmware plus the edition's serial. Anything typed in Advanced filters shows as Custom.
  const usesSerial = source !== "editable";
  const sn = usesSerial ? filters.sn ?? "" : "";
  const edition = EXCLUSIVES.find((x) => x.sn === sn && x.firmwareType === firmware);
  const watchPick = sn ? (edition ? `ex:${edition.sn}` : "custom")
    : WATCHFACE_TARGETS.some((tp) => tp.firmwareType === firmware) ? `fw:${firmware}` : "custom";
  const pickWatch = (value: string) => {
    if (value === "custom") { setAdvanced(true); return; }
    const ex = EXCLUSIVES.find((x) => `ex:${x.sn}` === value);
    const fw = ex ? ex.firmwareType : value.slice(3);
    setFirmwareDraft(null);
    set({ firmwareType: fw === target.firmwareType ? undefined : fw, sn: ex?.sn });
  };

  return (
    <div className="st-tab">
      <div className="st-filter-row">
        <Segmented small label={t("Faces from")} value={source} onChange={setSource}
          options={[{ value: "editable", label: t("Templates") }, { value: "official", label: t("Official") }, { value: "custom", label: t("Your COROS faces") }]} />
        {source === "editable" && categories.length > 1 ? (
          <div role="group" aria-label={t("Template categories")} className="st-chips">
            <button type="button" className="chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t("All")}<span className="st-count">{items?.length ?? 0}</span></button>
            {categories.map(([name, n]) => (
              <button key={name} type="button" className="chip" aria-pressed={category === name} onClick={() => setCategory(name)}>{t(name)}<span className="st-count">{n}</span></button>
            ))}
          </div>
        ) : null}
        <label className="st-search st-tpl-search"><Icon name="search" size={15} />
          <input type="search" aria-label={t("Search templates")} placeholder={t("Template name, ID or category")} value={query} onChange={(e) => onQuery(e.target.value)} />
        </label>
        {signedIn ? (
          <label className="st-watch-pick"><Icon name="watch" size={16} />
            <Select field aria-label={t("Watch")} value={watchPick} onChange={(e) => pickWatch(e.target.value)}>
              <optgroup label={t("Watches")}>
                {WATCHFACE_TARGETS.map((tp) => <option key={tp.firmwareType} value={`fw:${tp.firmwareType}`}>{tp.label}</option>)}
              </optgroup>
              {usesSerial ? (
                <optgroup label={t("Exclusive editions")}>
                  {EXCLUSIVES.map((x) => <option key={x.sn} value={`ex:${x.sn}`}>{x.label}</option>)}
                </optgroup>
              ) : null}
              <option value="custom">{watchPick === "custom" ? `${t("Custom")} · ${firmware.replace(/^COROS /, "")}${sn ? ` · ${sn}` : ""}` : t("Custom…")}</option>
            </Select>
          </label>
        ) : null}
        <Select field aria-label={t("Sort")} value={sort} onChange={(e) => onSort(e.target.value as TemplateSort)} className="st-sort">
          <option value="coros">{t("COROS order")}</option><option value="name">{t("Name")}</option>
        </Select>
        {signedIn ? (
          <button type="button" className="chip" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)}><Icon name="sliders" size={15} />{t("Advanced filters")}</button>
        ) : null}
      </div>

      {advanced && signedIn ? (
        <div className="st-advanced pop">
          <label className="st-form-row"><span>{t("Firmware type")}</span>
            <Field list="st-fw-list" spellCheck={false} autoComplete="off" placeholder={target.firmwareType} value={firmwareDraft ?? firmware}
              onChange={(e) => setFirmwareDraft(e.target.value)} onBlur={commitFirmware}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setFirmwareDraft(null); e.currentTarget.blur(); } }} />
            <datalist id="st-fw-list">
              {WATCHFACE_TARGETS.map((tp) => <option key={tp.firmwareType} value={tp.firmwareType}>{tp.label}</option>)}
            </datalist></label>
          <label className="st-form-row"><span>{t("Language")}</span>
            <Select field value={filters.language ?? "en-US"} onChange={(e) => set({ language: e.target.value === "en-US" ? undefined : e.target.value })}>
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select></label>
          <label className="st-form-row"><span>{t("Maximum version")}</span>
            <Select field value={filters.maxVersion ?? "5"} onChange={(e) => set({ maxVersion: e.target.value === "5" ? undefined : e.target.value })}>
              {["5", "4", "3", "2", "1", "0"].map((v) => <option key={v} value={v}>{v === "5" ? tx("version", "Latest") : t("Version {n}", { n: v })}</option>)}
            </Select></label>
          {source !== "editable" ? (
            <>
              <label className="st-form-row"><span>{t("Watch serial")}</span><Field key={sn} defaultValue={sn} autoComplete="off" spellCheck={false} placeholder={t("For an exclusive edition")} onBlur={(e) => set({ sn: e.target.value.trim() || undefined })} /></label>
              <label className="st-form-row"><span>{t("Model version")}</span><Field defaultValue={filters.modelVersion ?? ""} placeholder="W332-3.1708.0" onBlur={(e) => set({ modelVersion: e.target.value.trim() || undefined })} /></label>
            </>
          ) : null}
          {filterKey !== "{}" ? <button type="button" className="st-link" onClick={() => { setFilters({}); setFirmwareDraft(null); }}>{t("Reset")}</button> : null}
        </div>
      ) : null}

      {problem ? <div className="notice" role="alert">{problem}</div> : null}

      {needsSignIn ? (
        <div className="st-empty">
          <Icon name="user" size={26} />
          <b>{source === "official" ? t("COROS's official faces") : t("Faces saved to your COROS account")}</b>
          <span>{t("Sign in to COROS to open them in Studio.")}</span>
          <Button variant="primary" onClick={onSignIn}>{t("Sign in")}</Button>
        </div>
      ) : (
        <>
          <span className="st-hint">{source === "editable" ? t("COROS templates for {watch}.", { watch: target.label }) : source === "official" ? t("COROS's own faces for {watch}. They open as an editable copy.", { watch: target.label }) : t("Faces you saved to COROS.")}</span>
          <div className="st-grid">
            {source === "editable" ? (
              <button type="button" className="st-card st-new-tile" disabled={!!starting || !items?.length} onClick={() => items?.length && onStart(items[0], true, items)}>
                <span className="st-new-icon"><Icon name="plus" size={22} width={2.2} /></span>
                <b>{t("Start blank")}</b>
                <span>{starting === "blank" ? t("Getting the template…") : t("An empty face")}</span>
              </button>
            ) : null}
            {shown.map((tp) => (
              <article key={tp.id} className="st-card">
                <button type="button" className="st-stage" disabled={!!starting} onClick={() => (source === "editable" ? onStart(tp, false, items ?? []) : onOpen(source, tp))} aria-label={t("Open {name}", { name: tp.name })}>
                  <FaceView src={tp.picture} size={136} label={tp.name} />
                </button>
                <div className="st-card-foot">
                  <div className="st-card-text"><h3>{titleCase(tp.name)}</h3><span>{starting === tp.id ? t("Getting it from COROS…") : [`ID ${tp.id}`, kind(tp) && t(kind(tp)!)].filter(Boolean).join(" · ")}</span></div>
                  <button type="button" className="st-pill" disabled={!!starting} onClick={() => (source === "editable" ? onStart(tp, false, items ?? []) : onOpen(source, tp))}>{source === "editable" ? t("Use") : t("Open")}</button>
                </div>
              </article>
            ))}
          </div>
          {items === null ? <p className="st-hint">{t("Loading…")}</p> : null}
          {items && !shown.length ? <p className="st-hint">{items.length ? t("Nothing matches.") : source === "editable" ? t("No editable templates for {watch} yet.", { watch: target.label }) : t("Nothing here for {watch}.", { watch: target.label })}</p> : null}
        </>
      )}
    </div>
  );
}
