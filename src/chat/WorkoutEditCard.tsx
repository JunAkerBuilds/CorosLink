import { useEffect, useState } from "react";
import type { StrengthEditPreview } from "../../electron/workoutEditTypes";
import type { CorosLinkApi } from "../coroslink-api";
import "./workoutEditCard.css";

export function WorkoutEditCard({ preview, api }: { preview: StrengthEditPreview; api: CorosLinkApi }) {
  const [current, setCurrent] = useState(preview);
  const [selected, setSelected] = useState(() => preview.items.filter(i => i.state === "prepared").map(i => i.id));
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const itemStates = preview.items.map(item => item.state).join(",");
  useEffect(() => {
    let mounted = true;
    void api.getWorkoutEditStatus(preview.proposalId).then(p => { if (mounted) { setCurrent(p); setLoaded(true); } }).catch(e => { if (mounted) setError(String(e)); });
    return () => { mounted = false; };
  }, [api, preview.proposalId, preview.state, itemStates]);
  const update = async (action: () => Promise<StrengthEditPreview>) => {
    setBusy(true); setError("");
    try { setCurrent(await action()); setLoaded(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const pending = current.state === "awaiting_confirmation";
  const save = () => update(() => api.confirmWorkoutEdit({ proposalId: current.proposalId, reviewHash: current.reviewHash, selectedIds: selected }));
  return <section className="workout-edit-card" aria-label="Strength workout edit review">
    <h4>Review strength changes</h4>
    <p>{current.scope}</p>
    <p>{current.items.length} workouts · {current.state.replaceAll("_", " ")}</p>
    {current.items.map(item => <div className="workout-edit-item" key={item.id}>
      <label><input type="checkbox" checked={selected.includes(item.id)} disabled={!loaded || !pending || busy} onChange={e => setSelected(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /> <strong>{item.name}</strong></label>
      <p>{item.ref.kind === "library" ? "Workout Library" : `Calendar · ${item.ref.happenDay.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}`} · {item.state.replaceAll("_", " ")}</p>
      <div className="workout-edit-table"><table><thead><tr><th>Exercise / step</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>
        {item.changes.map((change, index) => <tr key={index}><td>{change.exercise}<small>Step {Array.from(new Set(item.changes.map(c => c.stepId))).indexOf(change.stepId) + 1}</small></td><td>{change.field}</td><td>{change.before}</td><td>{change.after}</td></tr>)}
      </tbody></table></div>
      {item.message && <p role="status">{item.message}</p>}
    </div>)}
    {current.exclusions.length > 0 && <details><summary>{current.exclusions.length} exclusions / unchanged workouts</summary><ul>{current.exclusions.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
    {pending && <p>Only selected workouts will change. Library templates and calendar copies are independent. A failed batch can leave some workouts saved.</p>}
    {current.message && <p role="status">{current.message}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="workout-edit-actions">
      {pending && <button className="primary-button" disabled={!loaded || busy || !selected.length} onClick={() => void save()}>{busy ? "Saving…" : `Save ${selected.length} to COROS`}</button>}
      {(pending || current.state === "saving" || busy) && <button className="secondary-button" onClick={() => { void api.cancelWorkoutEdit(current.proposalId).then(setCurrent).catch(e => setError(String(e))); }}>Cancel remaining</button>}
      <button className="secondary-button" disabled={busy} onClick={() => void update(() => api.getWorkoutEditStatus(current.proposalId))}>Refresh status</button>
    </div>
  </section>;
}
