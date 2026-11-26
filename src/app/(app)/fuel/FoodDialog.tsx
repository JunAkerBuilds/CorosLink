"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Button, Field, Segmented, Select } from "@/components/ui";
import { MEAL_KEYS, type AddedFrom, type FoodItem, type LoggedFood, type MealKey, type Nutrients, type Unit } from "@/data/fuel";
import { basisOf, macroCheck, parseAmount, scaleNutrients, searchFoods, trim, ZERO, type NutrientKey } from "@/lib/fuel";
import { Dialog } from "./Dialog";
import { msg, t } from "@/lib/i18n";

export const MEAL_NAME: Record<MealKey, string> = { breakfast: msg("Breakfast"), lunch: msg("Lunch"), dinner: msg("Dinner"), snack: msg("Snack") };

export type FoodDialogState =
  | { kind: "add"; meal: MealKey; suggestion?: LoggedFood }
  | { kind: "edit"; meal: MealKey; food: LoggedFood };

/** A food chosen but not yet given an amount. `foodId` when it is one of the list's foods. */
type Draft = Pick<LoggedFood, "name" | "unit" | "per"> & { foodId?: string };

const UNIT_WORD: Record<Unit, string> = { g: "g", ml: "ml", serving: msg("servings") };
const START_AMOUNT: Record<Unit, string> = { g: "100", ml: "250", serving: "1" };
const basisLine = (unit: Unit) => (unit === "serving" ? t("In a serving") : t("In 100 {unit}", { unit }));

function Preview({ per, unit, amount }: { per: Nutrients; unit: Unit; amount: number | null }) {
  const n = scaleNutrients(per, amount ?? 0, basisOf(unit));
  return (
    <p className="fuel-preview" aria-live="polite">
      <strong className="num">{trim(n.kcal, 0)} kcal</strong>
      <span>{t("Protein {n} g", { n: trim(n.protein) })}</span><span>{t("Carbs {n} g", { n: trim(n.carbs) })}</span><span>{t("Fat {n} g", { n: trim(n.fat) })}</span><span>{t("Fiber {n} g", { n: trim(n.fiber) })}</span>
    </p>
  );
}

const OWN_FIELDS: { key: NutrientKey; label: string }[] = [
  { key: "kcal", label: msg("Calories (kcal)") }, { key: "protein", label: msg("Protein (g)") }, { key: "carbs", label: msg("Carbs (g)") },
  { key: "fat", label: msg("Fat (g)") }, { key: "fiber", label: msg("Fiber (g)") }, { key: "sugar", label: msg("Sugar (g)") },
  { key: "satFat", label: msg("Saturated fat (g)") }, { key: "sodium", label: msg("Sodium (mg)") }, { key: "cholesterol", label: msg("Cholesterol (mg)") },
];

function AddForm({ state, foods, newId, onAdd, close }: {
  state: Extract<FoodDialogState, { kind: "add" }>; foods: readonly FoodItem[]; newId: () => string;
  onAdd: (meal: MealKey, food: LoggedFood, added?: AddedFrom) => void; close: () => void;
}) {
  const [meal, setMeal] = useState<MealKey>(state.meal);
  const [tab, setTab] = useState<"list" | "own">("list");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [amount, setAmount] = useState("");
  const [ownName, setOwnName] = useState("");
  const [ownUnit, setOwnUnit] = useState<Unit>("g");
  const [own, setOwn] = useState<Record<NutrientKey, string>>({ kcal: "", protein: "", carbs: "", fat: "", fiber: "", sugar: "", satFat: "", sodium: "", cholesterol: "" });

  const results = useMemo(() => searchFoods(foods, query), [foods, query]);
  const pick = (d: Draft, startAmount = START_AMOUNT[d.unit]) => { setDraft(d); setAmount(startAmount); };
  const pickItem = (f: FoodItem) => pick({ name: f.name, unit: f.liquid ? "ml" : "g", per: f.per100, foodId: f.id });

  const ownPer = useMemo(() => {
    const per = { ...ZERO };
    for (const { key } of OWN_FIELDS) per[key] = parseAmount(own[key]) ?? 0;
    return per;
  }, [own]);
  const ownBad = OWN_FIELDS.some(({ key }) => own[key].trim() !== "" && parseAmount(own[key]) == null);
  const check = macroCheck(ownPer);

  const current: Draft | null = tab === "list" ? draft : { name: ownName.trim(), unit: ownUnit, per: ownPer };
  const amountText = tab === "list" ? amount : amount || START_AMOUNT[ownUnit];
  const parsed = parseAmount(amountText);
  const ready = current != null && current.name !== "" && parsed != null && parsed > 0
    && (tab === "list" || (!ownBad && parseAmount(own.kcal) != null));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tab === "list" && !draft) { if (results[0]) pickItem(results[0]); return; }
    if (!ready || !current || parsed == null) return;
    onAdd(meal, { id: newId(), name: current.name, unit: current.unit, amount: parsed, per: { ...current.per } },
      tab === "own" ? { from: "own" } : current.foodId ? { from: "list", foodId: current.foodId } : undefined);
    close();
  };

  return (
    <form onSubmit={submit} style={{ display: "contents" }} noValidate>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <label className="dlg-label" style={{ flex: "1 1 160px" }}>{t("Meal")}
          <Select value={meal} onChange={(e) => setMeal(e.target.value as MealKey)}>
            {MEAL_KEYS.map((m) => <option key={m} value={m}>{t(MEAL_NAME[m])}</option>)}
          </Select>
        </label>
        <Segmented label={t("Where the food comes from")} value={tab} onChange={(next) => { setTab(next); setAmount(next === "list" && draft ? START_AMOUNT[draft.unit] : ""); }}
          options={[{ value: "list", label: t("Food list") }, { value: "own", label: t("Your own food") }]} />
      </div>

      {tab === "list" ? (
        <>
          <label className="dlg-label">{t("Search foods")}
            <Field data-autofocus type="search" value={query} placeholder={t("Rice, banana, yoghurt…")} autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); setDraft(null); }} />
          </label>
          {state.suggestion && query === "" ? (
            <button type="button" className="fuel-pick" aria-pressed={draft?.name === state.suggestion.name && draft.unit === "serving"}
              onClick={() => pick({ name: state.suggestion!.name, unit: state.suggestion!.unit, per: state.suggestion!.per }, trim(state.suggestion!.amount, 2))}>
              <span>{state.suggestion.name}</span><span className="muted">{t("Idea from your kitchen")} · {trim(state.suggestion.per.kcal, 0)} kcal</span>
            </button>
          ) : null}
          <ul className="fuel-results" aria-label={t("Foods")}>
            {results.map((f) => (
              <li key={f.id}>
                <button type="button" className="fuel-pick" aria-pressed={draft?.foodId === f.id} onClick={() => pickItem(f)}>
                  <span>{f.name}</span><span className="muted">{t("{kcal} kcal per 100 {unit}", { kcal: trim(f.per100.kcal, 0), unit: f.liquid ? "ml" : "g" })}</span>
                </button>
              </li>
            ))}
            {results.length === 0 ? <li className="muted" style={{ padding: "10px 12px", fontSize: 13 }}>{t("No food in the list matches. Enter it under “Your own food”.")}</li> : null}
          </ul>
          {draft ? (
            <div className="dlg-grid" style={{ alignItems: "end" }}>
              <label className="dlg-label">{t("{name}: amount in {unit}", { name: draft.name, unit: t(UNIT_WORD[draft.unit]) })}
                <Field key={`${draft.name}-${draft.unit}`} autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={parsed == null || parsed <= 0} onFocus={(e) => e.target.select()} />
              </label>
              <Preview per={draft.per} unit={draft.unit} amount={parsed} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="dlg-grid">
            <label className="dlg-label" style={{ gridColumn: "1 / -1" }}>{t("Name")}
              <Field data-autofocus autoFocus value={ownName} onChange={(e) => setOwnName(e.target.value)} autoComplete="off" />
            </label>
            <label className="dlg-label">{t("Counted in")}
              <Select value={ownUnit} onChange={(e) => { setOwnUnit(e.target.value as Unit); setAmount(""); }}>
                <option value="g">{t("Grams")}</option><option value="ml">{t("Millilitres")}</option><option value="serving">{t("Servings")}</option>
              </Select>
            </label>
            <label className="dlg-label">{t("Amount in {unit}", { unit: t(UNIT_WORD[ownUnit]) })}
              <Field inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} aria-invalid={parsed == null || parsed <= 0} />
            </label>
          </div>
          <fieldset className="fuel-fieldset">
            <legend>{basisLine(ownUnit)}</legend>
            <div className="dlg-grid">
              {OWN_FIELDS.map(({ key, label }) => (
                <label key={key} className="dlg-label">{t(label)}
                  <Field inputMode="decimal" value={own[key]} aria-invalid={own[key].trim() !== "" && parseAmount(own[key]) == null}
                    onChange={(e) => setOwn((o) => ({ ...o, [key]: e.target.value }))} />
                </label>
              ))}
            </div>
          </fieldset>
          {!check.ok ? (
            <p className="notice" style={{ margin: 0 }}>
              <span>{t("Protein, carbs and fat add up to {sum} kcal, not {kcal}.", { sum: trim(check.fromMacros, 0), kcal: trim(ownPer.kcal, 0) })}</span>
              <Button variant="plain" onClick={() => setOwn((o) => ({ ...o, kcal: String(Math.round(check.fromMacros)) }))}>{t("Use {n} kcal", { n: trim(check.fromMacros, 0) })}</Button>
            </p>
          ) : null}
          <Preview per={ownPer} unit={ownUnit} amount={parsed} />
        </>
      )}

      <div className="dlg-foot">
        <Button onClick={close}>{t("Cancel")}</Button>
        <Button variant="primary" type="submit" disabled={tab === "own" ? !ready : draft != null && !ready}>
          {tab === "list" && !draft ? t("Choose") : t("Add to {meal}", { meal: t(MEAL_NAME[meal]).toLowerCase() })}
        </Button>
      </div>
    </form>
  );
}

function EditForm({ state, onChange, onRemove, close }: {
  state: Extract<FoodDialogState, { kind: "edit" }>;
  onChange: (meal: MealKey, id: string, amount: number) => void; onRemove: (meal: MealKey, id: string) => void; close: () => void;
}) {
  const { food, meal } = state;
  const [amount, setAmount] = useState(trim(food.amount, 2).replace(/,/g, ""));
  const parsed = parseAmount(amount);
  const ready = parsed != null && parsed > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || parsed == null) return;
    onChange(meal, food.id, parsed);
    close();
  };
  return (
    <form onSubmit={submit} style={{ display: "contents" }} noValidate>
      <div className="dlg-grid" style={{ alignItems: "end" }}>
        <label className="dlg-label">{t("Amount in {unit}", { unit: t(UNIT_WORD[food.unit]) })}
          <Field data-autofocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!ready} onFocus={(e) => e.target.select()} />
        </label>
        <Preview per={food.per} unit={food.unit} amount={parsed} />
      </div>
      <div className="dlg-foot">
        <Button style={{ marginRight: "auto", color: "var(--h-rose-ink)" }} onClick={() => { onRemove(meal, food.id); close(); }}>{t("Remove")}</Button>
        <Button onClick={close}>{t("Cancel")}</Button>
        <Button variant="primary" type="submit" disabled={!ready}>{t("Save")}</Button>
      </div>
    </form>
  );
}

/** Add a food to a meal (from the built-in list or with your own numbers), or change or remove one already logged. */
export function FoodDialog({ state, foods, newId, onAdd, onChange, onRemove, onClose }: {
  state: FoodDialogState; foods: readonly FoodItem[]; newId: () => string;
  onAdd: (meal: MealKey, food: LoggedFood, added?: AddedFrom) => void;
  onChange: (meal: MealKey, id: string, amount: number) => void;
  onRemove: (meal: MealKey, id: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={state.kind === "add" ? t("Add food") : `${state.food.name} · ${t(MEAL_NAME[state.meal])}`} onClose={onClose}>
      {(close) => state.kind === "add"
        ? <AddForm state={state} foods={foods} newId={newId} onAdd={onAdd} close={close} />
        : <EditForm state={state} onChange={onChange} onRemove={onRemove} close={close} />}
    </Dialog>
  );
}
