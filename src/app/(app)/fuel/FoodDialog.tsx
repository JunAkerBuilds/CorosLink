"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Button, Field, Segmented, Select } from "@/components/ui";
import { MEAL_KEYS, type AddedFrom, type FoodItem, type LoggedFood, type MealKey, type Nutrients, type Unit } from "@/data/fuel";
import { basisOf, macroCheck, parseAmount, scaleNutrients, searchFoods, trim, ZERO, type NutrientKey } from "@/lib/fuel";
import { Dialog } from "./Dialog";

export const MEAL_NAME: Record<MealKey, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export type FoodDialogState =
  | { kind: "add"; meal: MealKey; suggestion?: LoggedFood }
  | { kind: "edit"; meal: MealKey; food: LoggedFood };

/** A food chosen but not yet given an amount. `foodId` when it is one of the list's foods. */
type Draft = Pick<LoggedFood, "name" | "unit" | "per"> & { foodId?: string };

const UNIT_WORD: Record<Unit, string> = { g: "g", ml: "ml", serving: "servings" };
const START_AMOUNT: Record<Unit, string> = { g: "100", ml: "250", serving: "1" };
const basisWords = (unit: Unit) => (unit === "serving" ? "a serving" : `100 ${unit}`);

function Preview({ per, unit, amount }: { per: Nutrients; unit: Unit; amount: number | null }) {
  const n = scaleNutrients(per, amount ?? 0, basisOf(unit));
  return (
    <p className="fuel-preview" aria-live="polite">
      <strong className="num">{trim(n.kcal, 0)} kcal</strong>
      <span>Protein {trim(n.protein)} g</span><span>Carbs {trim(n.carbs)} g</span><span>Fat {trim(n.fat)} g</span><span>Fiber {trim(n.fiber)} g</span>
    </p>
  );
}

const OWN_FIELDS: { key: NutrientKey; label: string }[] = [
  { key: "kcal", label: "Calories (kcal)" }, { key: "protein", label: "Protein (g)" }, { key: "carbs", label: "Carbs (g)" },
  { key: "fat", label: "Fat (g)" }, { key: "fiber", label: "Fiber (g)" }, { key: "sugar", label: "Sugar (g)" },
  { key: "satFat", label: "Saturated fat (g)" }, { key: "sodium", label: "Sodium (mg)" }, { key: "cholesterol", label: "Cholesterol (mg)" },
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
        <label className="dlg-label" style={{ flex: "1 1 160px" }}>Meal
          <Select value={meal} onChange={(e) => setMeal(e.target.value as MealKey)}>
            {MEAL_KEYS.map((m) => <option key={m} value={m}>{MEAL_NAME[m]}</option>)}
          </Select>
        </label>
        <Segmented label="Where the food comes from" value={tab} onChange={(t) => { setTab(t); setAmount(t === "list" && draft ? START_AMOUNT[draft.unit] : ""); }}
          options={[{ value: "list", label: "Food list" }, { value: "own", label: "Your own food" }]} />
      </div>

      {tab === "list" ? (
        <>
          <label className="dlg-label">Search foods
            <Field data-autofocus type="search" value={query} placeholder="Rice, banana, yoghurt…" autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); setDraft(null); }} />
          </label>
          {state.suggestion && query === "" ? (
            <button type="button" className="fuel-pick" aria-pressed={draft?.name === state.suggestion.name && draft.unit === "serving"}
              onClick={() => pick({ name: state.suggestion!.name, unit: state.suggestion!.unit, per: state.suggestion!.per }, trim(state.suggestion!.amount, 2))}>
              <span>{state.suggestion.name}</span><span className="muted">Idea from your kitchen · {trim(state.suggestion.per.kcal, 0)} kcal</span>
            </button>
          ) : null}
          <ul className="fuel-results" aria-label="Foods">
            {results.map((f) => (
              <li key={f.id}>
                <button type="button" className="fuel-pick" aria-pressed={draft?.foodId === f.id} onClick={() => pickItem(f)}>
                  <span>{f.name}</span><span className="muted">{trim(f.per100.kcal, 0)} kcal per 100 {f.liquid ? "ml" : "g"}</span>
                </button>
              </li>
            ))}
            {results.length === 0 ? <li className="muted" style={{ padding: "10px 12px", fontSize: 13 }}>No food in the list matches. Enter it under “Your own food”.</li> : null}
          </ul>
          {draft ? (
            <div className="dlg-grid" style={{ alignItems: "end" }}>
              <label className="dlg-label">{draft.name}: amount in {UNIT_WORD[draft.unit]}
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
            <label className="dlg-label" style={{ gridColumn: "1 / -1" }}>Name
              <Field data-autofocus autoFocus value={ownName} onChange={(e) => setOwnName(e.target.value)} autoComplete="off" />
            </label>
            <label className="dlg-label">Counted in
              <Select value={ownUnit} onChange={(e) => { setOwnUnit(e.target.value as Unit); setAmount(""); }}>
                <option value="g">Grams</option><option value="ml">Millilitres</option><option value="serving">Servings</option>
              </Select>
            </label>
            <label className="dlg-label">Amount in {UNIT_WORD[ownUnit]}
              <Field inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} aria-invalid={parsed == null || parsed <= 0} />
            </label>
          </div>
          <fieldset className="fuel-fieldset">
            <legend>In {basisWords(ownUnit)}</legend>
            <div className="dlg-grid">
              {OWN_FIELDS.map(({ key, label }) => (
                <label key={key} className="dlg-label">{label}
                  <Field inputMode="decimal" value={own[key]} aria-invalid={own[key].trim() !== "" && parseAmount(own[key]) == null}
                    onChange={(e) => setOwn((o) => ({ ...o, [key]: e.target.value }))} />
                </label>
              ))}
            </div>
          </fieldset>
          {!check.ok ? (
            <p className="notice" style={{ margin: 0 }}>
              <span>Protein, carbs and fat add up to {trim(check.fromMacros, 0)} kcal, not {trim(ownPer.kcal, 0)}.</span>
              <Button variant="plain" onClick={() => setOwn((o) => ({ ...o, kcal: String(Math.round(check.fromMacros)) }))}>Use {trim(check.fromMacros, 0)} kcal</Button>
            </p>
          ) : null}
          <Preview per={ownPer} unit={ownUnit} amount={parsed} />
        </>
      )}

      <div className="dlg-foot">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={tab === "own" ? !ready : draft != null && !ready}>
          {tab === "list" && !draft ? "Choose" : `Add to ${MEAL_NAME[meal].toLowerCase()}`}
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
        <label className="dlg-label">Amount in {UNIT_WORD[food.unit]}
          <Field data-autofocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!ready} onFocus={(e) => e.target.select()} />
        </label>
        <Preview per={food.per} unit={food.unit} amount={parsed} />
      </div>
      <div className="dlg-foot">
        <Button style={{ marginRight: "auto", color: "var(--h-rose-ink)" }} onClick={() => { onRemove(meal, food.id); close(); }}>Remove</Button>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!ready}>Save</Button>
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
    <Dialog title={state.kind === "add" ? "Add food" : `${state.food.name} · ${MEAL_NAME[state.meal]}`} onClose={onClose}>
      {(close) => state.kind === "add"
        ? <AddForm state={state} foods={foods} newId={newId} onAdd={onAdd} close={close} />
        : <EditForm state={state} onChange={onChange} onRemove={onRemove} close={close} />}
    </Dialog>
  );
}
