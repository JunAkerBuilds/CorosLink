"use client";
// Describe a meal or show a photo of it; the AI lists the foods with their grams, and the athlete checks them before
// any is logged. Portion size is where estimates go wrong, so every weight can be changed first.
import { useState, type FormEvent } from "react";
import { Button, Field, Select } from "@/components/ui";
import { estimateMeal, MEAL_KEYS, MealEstimateError, type LoggedFood, type MealKey } from "@/data/fuel";
import { foodNutrients, parseAmount, trim } from "@/lib/fuel";
import { Dialog } from "./Dialog";
import { t } from "@/lib/i18n";
import { MEAL_NAME } from "./FoodDialog";

/** A photo as the AI reads it: JPEG, at most 1600 px on the long side, so it stays well under 5 MB. */
async function photoData(file: File): Promise<{ mime: string; data: string; url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url };
}

interface Row { food: LoggedFood; grams: string; on: boolean }

export function EstimateDialog({ meal: startMeal, withPhoto, onAdd, onClose }: {
  meal: MealKey; withPhoto: boolean; onAdd: (meal: MealKey, food: LoggedFood) => void; onClose: () => void;
}) {
  const [meal, setMeal] = useState(startMeal);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ mime: string; data: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    photoData(file).then(setPhoto, () => setProblem(t("That photo can’t be read.")));
  };

  const ask = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    estimateMeal({ text: text.trim() || undefined, photo: photo ? { mime: photo.mime, data: photo.data } : undefined })
      .then((estimate) => {
        setRows(estimate.foods.map((food) => ({ food, grams: String(food.amount), on: true })));
        setNote(estimate.note);
        if (!estimate.foods.length) setProblem(t("No food found. Describe it in a few words."));
      }, (error: unknown) => setProblem(error instanceof MealEstimateError ? error.message : t("The meal couldn’t be estimated.")))
      .finally(() => setBusy(false));
  };

  const chosen = (rows ?? []).filter((r) => r.on && (parseAmount(r.grams) ?? 0) > 0);

  return (
    <Dialog title={withPhoto ? t("Meal from a photo") : t("Describe a meal")} onClose={onClose}>
      {(close) => rows === null || !rows.length ? (
        <form onSubmit={ask} style={{ display: "contents" }}>
          <label className="dlg-label">{t("Meal")}
            <Select value={meal} onChange={(e) => setMeal(e.target.value as MealKey)}>
              {MEAL_KEYS.map((m) => <option key={m} value={m}>{t(MEAL_NAME[m])}</option>)}
            </Select>
          </label>
          {withPhoto || photo ? (
            <label className="fuel-photo">
              {photo ? <img src={photo.url} alt={t("The meal")} /> : <span>{t("Choose a photo")}</span>}
              <input type="file" accept="image/png,image/jpeg,image/webp" autoFocus={withPhoto} onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </label>
          ) : null}
          <label className="dlg-label">{withPhoto ? t("Anything the photo doesn’t show") : t("What you ate")}
            <textarea className="field" rows={3} data-autofocus={withPhoto ? undefined : true} value={text} maxLength={1000}
              placeholder={withPhoto ? t("Optional") : t("Two eggs on toast, a banana")} onChange={(e) => setText(e.target.value)} />
          </label>
          {problem ? <p className="dlg-error" role="alert">{problem}</p> : null}
          <div className="dlg-foot">
            <Button onClick={close}>{t("Cancel")}</Button>
            <Button variant="primary" type="submit" disabled={busy || (!text.trim() && !photo)}>{busy ? t("Estimating…") : t("Estimate")}</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); for (const r of chosen) onAdd(meal, { ...r.food, amount: parseAmount(r.grams)! }); close(); }} style={{ display: "contents" }}>
          <ul className="fuel-estimate" aria-label={t("Foods found")}>
            {rows.map((r, i) => {
              const grams = parseAmount(r.grams);
              const kcal = foodNutrients({ ...r.food, amount: grams ?? 0 }).kcal;
              const change = (next: Partial<Row>) => setRows(rows.map((x, k) => (k === i ? { ...x, ...next } : x)));
              return (
                <li key={r.food.id}>
                  <input type="checkbox" checked={r.on} aria-label={t("Log {food}", { food: r.food.name })} onChange={(e) => change({ on: e.target.checked })} />
                  <span className="fuel-estimate-name">{r.food.name}</span>
                  <Field inputMode="decimal" aria-label={t("{food} grams", { food: r.food.name })} value={r.grams} aria-invalid={grams == null || grams <= 0} onChange={(e) => change({ grams: e.target.value })} />
                  <span className="muted">g</span>
                  <span className="num">{trim(kcal, 0)} kcal</span>
                </li>
              );
            })}
          </ul>
          {note ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{note}</p> : null}
          <div className="dlg-foot">
            <Button onClick={() => setRows(null)}>{t("Back")}</Button>
            <Button variant="primary" type="submit" disabled={!chosen.length}>{t("Add {n} to {meal}", { n: chosen.length, meal: t(MEAL_NAME[meal]).toLowerCase() })}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
