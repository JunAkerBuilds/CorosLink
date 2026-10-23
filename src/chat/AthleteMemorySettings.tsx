import { formatDate, t, useLanguage } from "../i18n/tools";
import { useEffect, useId, useMemo, useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  ATHLETE_FACT_CATEGORIES,
  ATHLETE_FACT_CATEGORY_LABELS,
  MAX_ATHLETE_FACT_LENGTH,
  MAX_ATHLETE_FACTS,
  type AthleteFact,
  type AthleteFactCategory
} from "../../electron/athleteMemoryModel";
import type { CorosLinkApi } from "../coroslink-api";
import { ChatSettingsSectionHeader, chatSettingsSectionDomId } from "./chatSettingsSections";
import "./athleteMemory.css";

function errorText(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "";
  return message || fallback;
}

function FactRow({
  fact,
  busy,
  onSave,
  onDelete
}: {
  fact: AthleteFact;
  busy: boolean;
  onSave: (category: AthleteFactCategory, text: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.text);
  const [category, setCategory] = useState<AthleteFactCategory>(fact.category);
  useEffect(() => {
    if (!editing) {
      setDraft(fact.text);
      setCategory(fact.category);
    }
  }, [editing, fact.text, fact.category]);
  const meta = `${fact.author === "athlete" ? t("Written by you") : t("Saved by Coach")} · ${formatDate(new Date(fact.updatedAt), { month: "short", day: "numeric" })}`;

  if (editing) {
    const save = async () => {
      if (await onSave(category, draft)) setEditing(false);
    };
    return (
      <li className="chat-memory-fact is-editing">
        <div className="chat-memory-edit">
          <select
            aria-label={t("Category")}
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value as AthleteFactCategory)}
          >
            {ATHLETE_FACT_CATEGORIES.map((value) => (
              <option key={value} value={value}>{t(ATHLETE_FACT_CATEGORY_LABELS[value])}</option>
            ))}
          </select>
          <input
            aria-label={t("Fact")}
            value={draft}
            maxLength={MAX_ATHLETE_FACT_LENGTH}
            disabled={busy}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
              }
            }}
          />
        </div>
        <div className="chat-memory-actions">
          <button type="button" className="chat-memory-icon" aria-label={t("Cancel")} title={t("Cancel")} disabled={busy} onClick={() => setEditing(false)}>
            <X size={14} aria-hidden="true" />
          </button>
          <button type="button" className="chat-memory-icon is-confirm" aria-label={t("Save fact")} title={t("Save fact")} disabled={busy || !draft.trim()} onClick={() => void save()}>
            {busy ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="chat-memory-fact">
      <div className="chat-memory-fact-text">
        <p>{fact.text}</p>
        <span>{meta}</span>
      </div>
      <div className="chat-memory-actions">
        <button type="button" className="chat-memory-icon" aria-label={t("Edit fact")} title={t("Edit fact")} disabled={busy} onClick={() => setEditing(true)}>
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button type="button" className="chat-memory-icon is-danger" aria-label={t("Delete fact")} title={t("Delete fact")} disabled={busy} onClick={onDelete}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/**
 * What the Coach remembers between conversations. The Coach saves facts as
 * the athlete shares them; here the athlete reads, corrects, adds and deletes them.
 */
export function AthleteMemorySettings({ api }: { api: CorosLinkApi | undefined }) {
  const { language } = useLanguage();
  const descriptionId = useId();
  const [facts, setFacts] = useState<AthleteFact[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState<AthleteFactCategory>("goal");
  const [newText, setNewText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.listAthleteFacts().then(
      (value) => { if (!cancelled) { setFacts(value); setLoadError(false); } },
      () => { if (!cancelled) setLoadError(true); }
    );
    const stop = api.onAthleteMemoryChanged?.((value) => setFacts(value));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [api]);

  const groups = useMemo(() => {
    const byCategory = new Map<AthleteFactCategory, AthleteFact[]>();
    for (const fact of facts ?? []) byCategory.set(fact.category, [...(byCategory.get(fact.category) ?? []), fact]);
    return ATHLETE_FACT_CATEGORIES.filter((category) => byCategory.has(category)).map((category) => ({
      category,
      label: t(ATHLETE_FACT_CATEGORY_LABELS[category]),
      facts: byCategory.get(category)!
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, language]);

  const run = async (id: string, task: () => Promise<void>): Promise<boolean> => {
    if (!api || busyId) return false;
    setBusyId(id);
    setError(null);
    try {
      await task();
      return true;
    } catch (caught) {
      setError(errorText(caught, t("Could not update your coach's memory. Try again.")));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const save = (id: string | undefined, category: AthleteFactCategory, text: string) =>
    run(id ?? "new", async () => {
      await api!.saveAthleteFact({ ...(id ? { id } : {}), category, text });
      setFacts(await api!.listAthleteFacts());
    });

  const count = facts?.length ?? 0;
  const full = count >= MAX_ATHLETE_FACTS;

  return (
    <section
      className="chat-settings-section chat-memory-section"
      id={chatSettingsSectionDomId("memory")}
      data-settings-section="memory"
    >
      <ChatSettingsSectionHeader id="memory" />
      <p className="chat-settings-copy" id={descriptionId}>
        {t("Your coach saves lasting things you tell it, like goals, injuries, the days you can train and your equipment, and reads them in every conversation with any provider. Saved on this computer. Correct or delete anything here.")}
      </p>

      {loadError ? (
        <p className="chat-memory-error" role="alert">{t("Could not load your coach's memory.")}</p>
      ) : facts === null ? (
        <p className="chat-settings-copy" role="status">{t("Loading…")}</p>
      ) : groups.length === 0 ? (
        <div className="chat-memory-empty">
          <p>{t("Nothing saved yet.")}</p>
          <span>{t("Tell your coach about a goal race or a niggle and it will remember it next time.")}</span>
        </div>
      ) : (
        <div className="chat-memory-groups" aria-describedby={descriptionId}>
          {groups.map((group) => (
            <div key={group.category} className="chat-memory-group">
              <h4>{group.label}</h4>
              <ul>
                {group.facts.map((fact) => (
                  <FactRow
                    key={fact.id}
                    fact={fact}
                    busy={busyId === fact.id}
                    onSave={(category, text) => save(fact.id, category, text)}
                    onDelete={() => void run(fact.id, async () => setFacts(await api!.deleteAthleteFact(fact.id)))}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <form
        className="chat-memory-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newText.trim() || full) return;
          void save(undefined, newCategory, newText).then((ok) => { if (ok) setNewText(""); });
        }}
      >
        <select
          aria-label={t("Category")}
          value={newCategory}
          disabled={!api || full}
          onChange={(event) => setNewCategory(event.target.value as AthleteFactCategory)}
        >
          {ATHLETE_FACT_CATEGORIES.map((value) => (
            <option key={value} value={value}>{t(ATHLETE_FACT_CATEGORY_LABELS[value])}</option>
          ))}
        </select>
        <input
          aria-label={t("New fact")}
          placeholder={t("Valencia Marathon on 7 December, aiming for 3:15")}
          value={newText}
          maxLength={MAX_ATHLETE_FACT_LENGTH}
          disabled={!api || full}
          onChange={(event) => setNewText(event.target.value)}
        />
        <button type="submit" className="chat-local-action" disabled={!api || full || !newText.trim() || busyId !== null}>
          {busyId === "new" ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {t("Add")}
        </button>
      </form>

      {error ? <p className="chat-memory-error" role="alert">{error}</p> : null}

      <div className="chat-memory-footer">
        <span role="status">{t("{{p0}} of {{p1}} facts", { p0: count, p1: MAX_ATHLETE_FACTS })}</span>
        {count > 0 ? (
          confirmClear ? (
            <div className="chat-local-actions">
              <button type="button" className="chat-local-action" onClick={() => setConfirmClear(false)}>{t("Keep them")}</button>
              <button
                type="button"
                className="chat-local-action chat-memory-clear"
                disabled={busyId !== null}
                onClick={() => void run("clear", async () => { setFacts(await api!.clearAthleteMemory()); setConfirmClear(false); })}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t("Delete all facts")}
              </button>
            </div>
          ) : (
            <button type="button" className="chat-local-action" onClick={() => setConfirmClear(true)}>{t("Clear memory")}</button>
          )
        ) : null}
      </div>
    </section>
  );
}
