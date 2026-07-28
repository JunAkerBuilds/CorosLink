import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  Ungroup,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactElement } from "react";
import type {
  RunWorkoutEditorDraft,
  RunWorkoutEditorIntensity,
  RunWorkoutEditorNode,
  RunWorkoutEditorRepeatGroup,
  RunWorkoutEditorStep,
  RunWorkoutEditorStepKind,
  RunWorkoutEditorTarget,
  WorkoutEditPreview,
  WorkoutEditRef,
  WorkoutEditSaveResult,
  WorkoutEditorContext,
  WorkoutExerciseOption,
  WorkoutHeartRateBasis,
  WorkoutIntensityInput,
  WorkoutSport
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  elevationToMeters,
  elevationUnit,
  metersToElevation,
  swimDistanceUnit
} from "../units/units";
import { ExerciseCombobox } from "./ExerciseCombobox";
import {
  CLIMB_GRADES,
  CLIMB_SYSTEM_IDS,
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  RUNNING_POWER_PRESETS,
  SWIM_STROKE_IDS,
  WORKOUT_SPORT_CAPABILITIES,
  formatIntensityType,
  formatWorkoutSport,
  validateWorkoutDraftShared,
  workoutIntensitiesForStep,
  workoutTargetsForStep
} from "../../electron/workoutCapabilities";

interface WorkoutEditorModalProps {
  api: CorosLinkApi;
  editRef: WorkoutEditRef;
  onClose: () => void;
  onSaved: (result: WorkoutEditSaveResult) => void;
  onError: (message: string | null) => void;
}

interface StepLocation {
  nodeId: string;
  childId?: string;
}

let localNodeCounter = 0;

function localId(prefix: string): string {
  localNodeCounter += 1;
  return `${prefix}-new-${Date.now()}-${localNodeCounter}`;
}

function emptyStep(
  kind: RunWorkoutEditorStepKind = "training",
  sport: WorkoutSport = "run"
): RunWorkoutEditorStep {
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  return {
    id: localId("step"),
    nodeType: "step",
    kind,
    name: kind === "rest" ? "Rest" : kind === "warmup" ? "Warm Up" : kind === "cooldown" ? "Cool Down" : "Training",
    target: { type: "time", seconds: kind === "rest" ? 60 : 300 },
    intensity: structuredClone(capability.defaultIntensity),
    ...(capability.requiresExercise && kind === "training"
      ? { exerciseName: "" }
      : {}),
    editable: true
  };
}

function cloneStep(step: RunWorkoutEditorStep): RunWorkoutEditorStep {
  return {
    ...structuredClone(step),
    id: localId("step"),
    sourceExerciseId: undefined
  };
}

function cloneNode(node: RunWorkoutEditorNode): RunWorkoutEditorNode {
  if (node.nodeType === "step") {
    return cloneStep(node);
  }
  return {
    ...structuredClone(node),
    id: localId("group"),
    sourceExerciseId: undefined,
    steps: node.steps.map(cloneStep)
  };
}

function clockFromSeconds(total: number): string {
  const seconds = Math.max(0, Math.round(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function secondsFromClock(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return 0;
  }
  if (parts.length === 2) {
    return Math.round(parts[0]! * 60 + parts[1]!);
  }
  if (parts.length === 3) {
    return Math.round(parts[0]! * 3600 + parts[1]! * 60 + parts[2]!);
  }
  return Number(value) > 0 ? Math.round(Number(value)) : 0;
}

function stepTitle(kind: RunWorkoutEditorStepKind): string {
  return kind === "warmup"
    ? "Warm Up"
    : kind === "cooldown"
      ? "Cool Down"
      : kind === "rest"
        ? "Rest"
        : kind === "sendOff"
          ? "Send-off"
        : "Training";
}

function targetForType(
  type: RunWorkoutEditorTarget["type"],
  kind: RunWorkoutEditorStepKind
): RunWorkoutEditorTarget {
  if (type === "distance") return { type, meters: 1_000 };
  if (type === "load") return { type, load: 50 };
  if (type === "hrRecovery") {
    return kind === "rest" ? { type, bpm: 120 } : { type: "time", seconds: 60 };
  }
  if (type === "reps") return { type, count: 10 };
  if (type === "elevationGain") return { type, meters: 500 };
  if (type === "routes") return { type, count: 4 };
  if (type === "open") return { type };
  return { type, seconds: kind === "rest" ? 60 : 300 };
}

function intensityForType(
  type: RunWorkoutEditorIntensity["type"],
  context: WorkoutEditorContext
): RunWorkoutEditorIntensity {
  if (type === "pace" || type === "effortPace") {
    return {
      type,
      lowSecondsPerKm: 300,
      highSecondsPerKm: 330,
      displayUnit: context.paceUnit
    };
  }
  if (type === "heartRate") return { type, lowBpm: 140, highBpm: 155 };
  if (type === "heartRatePercent") return { type, basis: "maxHr", preset: "aerobicEndurance" };
  if (type === "lthrPercent") return { type, lowPercent: 91, highPercent: 95 };
  if (type === "thresholdPacePercent" || type === "effortPacePercent") return { type, preset: "aerobicEndurance" };
  if (type === "ftpPercent") return { type, preset: "aerobicEndurance" };
  if (type === "power") return { type, lowWatts: 180, highWatts: 220 };
  if (type === "speed") return { type, low: 10, high: 12, unit: context.distanceUnit === "imperial" ? "mph" : "km/h" };
  if (type === "cadence") return { type, low: 80, high: 90, unit: "rpm" };
  if (type === "swimStroke") return { type, stroke: "freestyle" };
  if (type === "weight") return { type, mode: "bodyweight" };
  if (type === "rpe") return { type, value: 5 };
  if (type === "climbGrade") return { type, system: "yds", relativeToOnsight: 0 };
  return { type: "none" };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(Math.min(to, next.length), 0, item);
  return next;
}

export function WorkoutEditorModal({
  api,
  editRef,
  onClose,
  onSaved,
  onError
}: WorkoutEditorModalProps) {
  const { unitSystem } = useUnitSystem();
  const reducedMotion = useReducedMotion();
  const [document, setDocument] = useState<Awaited<ReturnType<CorosLinkApi["getWorkoutForEdit"]>> | null>(null);
  const [draft, setDraft] = useState<RunWorkoutEditorDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkoutEditPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exerciseOptions, setExerciseOptions] = useState<WorkoutExerciseOption[]>([]);
  const [exerciseOptionsLoading, setExerciseOptionsLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const previewSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setDraft(null);
    setLoadError(null);
    void api.getWorkoutForEdit(editRef, unitSystem).then((loaded) => {
      if (!cancelled) {
        setDocument(loaded);
        setDraft(structuredClone(loaded.draft));
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [api, editRef, unitSystem]);

  useEffect(() => {
    const sport = draft?.sport;
    if (sport !== "strength" && sport !== "hyrox") {
      setExerciseOptions([]);
      setExerciseOptionsLoading(false);
      return;
    }
    let active = true;
    setExerciseOptionsLoading(true);
    void api.listWorkoutExercises(sport)
      .then((options) => { if (active) setExerciseOptions(options); })
      .catch(() => { if (active) setExerciseOptions([]); })
      .finally(() => { if (active) setExerciseOptionsLoading(false); });
    return () => { active = false; };
  }, [api, draft?.sport]);

  const dirty = Boolean(document && draft && JSON.stringify(document.draft) !== JSON.stringify(draft));
  const validation = useMemo(
    () => draft ? validateWorkoutDraftShared(draft) : { valid: false, errors: {} },
    [draft]
  );

  useEffect(() => {
    const sequence = ++previewSequence.current;
    if (!document || !draft || !document.canEdit || !validation.valid) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      setPreviewError(null);
      void api.previewWorkoutEdit(
        editRef,
        document.revision,
        draft,
        unitSystem
      )
        .then((result) => {
          if (previewSequence.current === sequence) setPreview(result);
        })
        .catch((cause: unknown) => {
          if (previewSequence.current === sequence) {
            setPreviewError(cause instanceof Error ? cause.message : String(cause));
          }
        })
        .finally(() => {
          if (previewSequence.current === sequence) setPreviewing(false);
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [api, document, draft, editRef, unitSystem, validation.valid]);

  const requestClose = useCallback(() => {
    if (dirty && !saving) setConfirmClose(true);
    else onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (confirmClose) setConfirmClose(false);
      else requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmClose, requestClose]);

  const updateStep = (location: StepLocation, update: (step: RunWorkoutEditorStep) => RunWorkoutEditorStep) => {
    setDraft((current) => current ? {
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== location.nodeId) return node;
        if (node.nodeType === "step") return update(node);
        return { ...node, steps: node.steps.map((step) => step.id === location.childId ? update(step) : step) };
      })
    } : current);
  };

  const deleteAt = (location: StepLocation) => {
    setDraft((current) => current ? {
      ...current,
      nodes: current.nodes.flatMap((node) => {
        if (node.id !== location.nodeId) return [node];
        if (node.nodeType === "step") return [];
        const steps = node.steps.filter((step) => step.id !== location.childId);
        return steps.length > 0 ? [{ ...node, steps }] : [];
      })
    } : current);
  };

  const duplicateAt = (location: StepLocation) => {
    setDraft((current) => current ? {
      ...current,
      nodes: current.nodes.flatMap((node) => {
        if (node.id !== location.nodeId) return [node];
        if (node.nodeType === "step") return [node, cloneStep(node)];
        const index = node.steps.findIndex((step) => step.id === location.childId);
        if (index < 0) return [node];
        const steps = [...node.steps];
        steps.splice(index + 1, 0, cloneStep(steps[index]!));
        return [{ ...node, steps }];
      })
    } : current);
  };

  const moveAt = (location: StepLocation, direction: -1 | 1) => {
    setDraft((current) => {
      if (!current) return current;
      if (!location.childId) {
        const index = current.nodes.findIndex((node) => node.id === location.nodeId);
        return { ...current, nodes: moveItem(current.nodes, index, index + direction) };
      }
      return {
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== location.nodeId || node.nodeType !== "repeat") return node;
          const index = node.steps.findIndex((step) => step.id === location.childId);
          return { ...node, steps: moveItem(node.steps, index, index + direction) };
        })
      };
    });
  };

  const ungroupStep = (groupId: string, childId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const groupIndex = current.nodes.findIndex((node) => node.id === groupId);
      const group = current.nodes[groupIndex];
      if (!group || group.nodeType !== "repeat") return current;
      const child = group.steps.find((step) => step.id === childId);
      if (!child) return current;
      const remaining = group.steps.filter((step) => step.id !== childId);
      const replacement: RunWorkoutEditorNode[] = remaining.length > 0 ? [{ ...group, steps: remaining }, child] : [child];
      return { ...current, nodes: [...current.nodes.slice(0, groupIndex), ...replacement, ...current.nodes.slice(groupIndex + 1)] };
    });
  };

  const groupWithPrevious = (nodeId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const index = current.nodes.findIndex((node) => node.id === nodeId);
      const previous = current.nodes[index - 1];
      const selected = current.nodes[index];
      if (index < 1 || !previous || !selected || previous.nodeType !== "step" || selected.nodeType !== "step" || !previous.editable || !selected.editable) return current;
      const group: RunWorkoutEditorRepeatGroup = {
        id: localId("group"),
        nodeType: "repeat",
        name: "Repeat",
        repeat: 2,
        steps: [previous, selected],
        editable: true
      };
      return { ...current, nodes: [...current.nodes.slice(0, index - 1), group, ...current.nodes.slice(index + 1)] };
    });
  };

  const reorderTop = (sourceId: string, targetIndex: number) => {
    setDraft((current) => {
      if (!current) return current;
      const from = current.nodes.findIndex((node) => node.id === sourceId);
      if (from < 0) return current;
      return { ...current, nodes: moveItem(current.nodes, from, targetIndex > from ? targetIndex - 1 : targetIndex) };
    });
  };

  const groupByDrop = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setDraft((current) => {
      if (!current) return current;
      const sourceIndex = current.nodes.findIndex((node) => node.id === sourceId);
      const targetIndex = current.nodes.findIndex((node) => node.id === targetId);
      const source = current.nodes[sourceIndex];
      const target = current.nodes[targetIndex];
      if (!source || !target || source.nodeType !== "step" || target.nodeType !== "step" || !source.editable || !target.editable) return current;
      const first = Math.min(sourceIndex, targetIndex);
      const nodes = current.nodes.filter((node) => node.id !== sourceId && node.id !== targetId);
      nodes.splice(first, 0, {
        id: localId("group"), nodeType: "repeat", name: "Repeat", repeat: 2,
        steps: sourceIndex < targetIndex ? [source, target] : [target, source], editable: true
      });
      return { ...current, nodes };
    });
  };

  const save = async () => {
    if (!document || !draft || !validation.valid) return;
    setSaving(true);
    try {
      const result = await api.saveWorkoutEdit(
        editRef,
        document.revision,
        draft,
        unitSystem
      );
      onSaved(result);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div className="workout-editor-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.section
          className="workout-editor-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workout-editor-title"
          initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
        >
          <header className="workout-editor-header">
            <div>
              <p className="eyebrow">{editRef.kind === "scheduled" ? "Scheduled occurrence" : "Workout library"}</p>
              <h2 id="workout-editor-title">Edit {draft ? formatWorkoutSport(draft.sport) : "workout"}</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Close workout editor" onClick={requestClose} disabled={saving}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {!document && !loadError ? <EditorSkeleton /> : null}
          {loadError ? (
            <div className="workout-editor-state is-error">
              <AlertTriangle size={22} aria-hidden="true" />
              <h3>Workout could not be loaded</h3><p>{loadError}</p>
              <button type="button" className="ghost-button" onClick={onClose}>Close</button>
            </div>
          ) : null}

          {document && draft ? (
            <>
              <div className="workout-editor-scroll">
                {!document.canEdit ? <div className="workout-editor-notice"><AlertTriangle size={16} aria-hidden="true" />{document.unsupportedReason}</div> : null}
                <div className="workout-editor-basics">
                  <label className="calendar-field">
                    <span>Sport</span>
                    <select value={draft.sport} disabled title="An existing COROS workout cannot change sport in place.">
                      <option value={draft.sport}>{formatWorkoutSport(draft.sport)}</option>
                    </select>
                  </label>
                  {draft.sport === "swim" ? (
                    <label className="calendar-field">
                      <span>Pool length ({document.context.defaultPoolLength.unit})</span>
                      <div className="workout-range-inputs">
                        <input
                          type="number"
                          min="1"
                          value={draft.sportOptions?.poolLength?.value ?? document.context.defaultPoolLength.value}
                          disabled={!document.canEdit || saving}
                          onChange={(event) => setDraft({
                            ...draft,
                            sportOptions: {
                              ...draft.sportOptions,
                              poolLength: {
                                value: Number(event.target.value),
                                unit: draft.sportOptions?.poolLength?.unit ?? document.context.defaultPoolLength.unit
                              }
                            }
                          })}
                        />
                        <span className="calendar-builder-readonly-value">
                          {document.context.defaultPoolLength.unit}
                        </span>
                      </div>
                    </label>
                  ) : null}
                  {(draft.sport === "indoorClimb" || draft.sport === "bouldering") ? (
                    <label className="calendar-field">
                      <span>Grading system</span>
                      <select
                        value={draft.sportOptions?.gradingSystem ?? document.context.climbSystems[draft.sport] ?? (draft.sport === "bouldering" ? "vScale" : "yds")}
                        disabled={!document.canEdit || saving}
                        onChange={(event) => setDraft({ ...draft, sportOptions: { ...draft.sportOptions, gradingSystem: event.target.value as keyof typeof CLIMB_SYSTEM_IDS } })}
                      >{Object.keys(CLIMB_SYSTEM_IDS).map((system) => <option key={system} value={system}>{system}</option>)}</select>
                    </label>
                  ) : null}
                  <label className="calendar-field">
                    <span>Name</span>
                    <input maxLength={90} value={draft.name} disabled={!document.canEdit || saving} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    <small>{draft.name.length}/90</small>
                    {validation.errors.name ? <em>{validation.errors.name}</em> : null}
                  </label>
                  <label className="calendar-field">
                    <span>Description</span>
                    <textarea maxLength={300} rows={3} value={draft.overview} disabled={!document.canEdit || saving} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} />
                    <small>{draft.overview.length}/300</small>
                    {validation.errors.overview ? <em>{validation.errors.overview}</em> : null}
                  </label>
                </div>

                <div className="workout-editor-structure-header">
                  <div><h3>Workout structure</h3><p>Drag between cards to reorder. Drop one step on another to create a repeat.</p></div>
                  <button type="button" className="ghost-button" disabled={!document.canEdit || saving} onClick={() => setDraft({ ...draft, nodes: [...draft.nodes, emptyStep("training", draft.sport)] })}>
                    <Plus size={15} aria-hidden="true" /> Add step
                  </button>
                </div>

                {draft.nodes.length === 0 ? (
                  <div className="workout-editor-empty"><p>No workout steps yet.</p><button type="button" className="primary-button" onClick={() => setDraft({ ...draft, nodes: [emptyStep("training", draft.sport)] })}>Add first step</button></div>
                ) : (
                  <div className="workout-editor-nodes">
                    {draft.nodes.map((node, index) => (
                      <div key={node.id}>
                        <div className="workout-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderTop(event.dataTransfer.getData("text/workout-node"), index); }} />
                        {node.nodeType === "step" ? (
                          <StepCard
                            step={node} location={{ nodeId: node.id }} context={document.context} sport={draft.sport}
                            exerciseOptions={exerciseOptions}
                            exerciseOptionsLoading={exerciseOptionsLoading}
                            error={validation.errors[`nodes.${index}.target`] ?? validation.errors[`nodes.${index}.intensity`] ?? validation.errors[`nodes.${index}.exercise`]}
                            disabled={!document.canEdit || saving} draggable
                            onDragStart={(event) => event.dataTransfer.setData("text/workout-node", node.id)}
                            onDropCard={node.editable ? (sourceId) => groupByDrop(sourceId, node.id) : undefined}
                            onChange={(step) => updateStep({ nodeId: node.id }, () => step)}
                            onMove={(direction) => moveAt({ nodeId: node.id }, direction)}
                            onDuplicate={() => duplicateAt({ nodeId: node.id })}
                            onDelete={() => deleteAt({ nodeId: node.id })}
                            onGroup={index > 0 && node.editable ? () => groupWithPrevious(node.id) : undefined}
                          />
                        ) : (
                          <RepeatCard
                            group={node} nodeIndex={index} context={document.context} sport={draft.sport} errors={validation.errors}
                            exerciseOptions={exerciseOptions}
                            exerciseOptionsLoading={exerciseOptionsLoading}
                            disabled={!document.canEdit || saving}
                            onDragStart={(event) => event.dataTransfer.setData("text/workout-node", node.id)}
                            onChange={(group) => setDraft({ ...draft, nodes: draft.nodes.map((item) => item.id === group.id ? group : item) })}
                            onMove={(direction) => moveAt({ nodeId: node.id }, direction)}
                            onDuplicate={() => setDraft({ ...draft, nodes: draft.nodes.flatMap((item) => item.id === node.id ? [item, cloneNode(item)] : [item]) })}
                            onDelete={() => setDraft({ ...draft, nodes: draft.nodes.filter((item) => item.id !== node.id) })}
                            onStepChange={(childId, step) => updateStep({ nodeId: node.id, childId }, () => step)}
                            onStepMove={(childId, direction) => moveAt({ nodeId: node.id, childId }, direction)}
                            onStepDuplicate={(childId) => duplicateAt({ nodeId: node.id, childId })}
                            onStepDelete={(childId) => deleteAt({ nodeId: node.id, childId })}
                            onStepUngroup={(childId) => ungroupStep(node.id, childId)}
                          />
                        )}
                      </div>
                    ))}
                    <div className="workout-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderTop(event.dataTransfer.getData("text/workout-node"), draft.nodes.length); }} />
                  </div>
                )}
              </div>

              <footer className="workout-editor-footer">
                <EstimateFooter preview={preview} loading={previewing} error={previewError} context={document.context} />
                <div className="workout-editor-footer-actions">
                  <button type="button" className="ghost-button" onClick={requestClose} disabled={saving}>Cancel</button>
                  <button type="button" className="primary-button" disabled={!document.canEdit || !dirty || !validation.valid || saving} onClick={() => void save()}>
                    {saving ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                    {saving ? "Saving and verifying..." : "Save"}
                  </button>
                </div>
              </footer>
            </>
          ) : null}

          {confirmClose ? (
            <div className="workout-editor-confirm" role="alertdialog" aria-label="Discard workout changes">
              <div><strong>Discard unsaved changes?</strong><span>Your edits have not been sent to COROS.</span></div>
              <button type="button" className="ghost-button" onClick={() => setConfirmClose(false)}>Keep editing</button>
              <button type="button" className="danger-button" onClick={onClose}>Discard</button>
            </div>
          ) : null}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}

function EditorSkeleton() {
  return <div className="workout-editor-skeleton" aria-label="Loading workout"><div /><div /><div /><div /></div>;
}

interface StepCardProps {
  step: RunWorkoutEditorStep;
  location: StepLocation;
  context: WorkoutEditorContext;
  sport: WorkoutSport;
  exerciseOptions: WorkoutExerciseOption[];
  exerciseOptionsLoading: boolean;
  error?: string;
  disabled: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDropCard?: (sourceId: string) => void;
  onChange: (step: RunWorkoutEditorStep) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
}

function StepCard({ step, context, sport, exerciseOptions, exerciseOptionsLoading, error, disabled, draggable, onDragStart, onDropCard, onChange, onMove, onDuplicate, onDelete, onGroup, onUngroup }: StepCardProps) {
  const locked = disabled || !step.editable;
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  const changeKind = (kind: RunWorkoutEditorStepKind) => {
    let target = step.target;
    if (target.type === "hrRecovery" && kind !== "rest") target = { type: "time", seconds: 60 };
    onChange({
      ...step,
      kind,
      name: stepTitle(kind),
      target,
      ...(kind === "sendOff" ? { sendOffSeconds: step.sendOffSeconds ?? 120 } : {})
    });
  };
  return (
    <motion.article layout className={`workout-step-card is-${step.kind} ${!step.editable ? "is-locked" : ""}`} draggable={draggable && !disabled} onDragStartCapture={onDragStart} onDragOver={(event) => { if (onDropCard) event.preventDefault(); }} onDrop={(event) => { if (!onDropCard) return; event.preventDefault(); onDropCard(event.dataTransfer.getData("text/workout-node")); }}>
      <header className="workout-step-header">
        <GripVertical className="workout-drag-handle" size={18} aria-hidden="true" />
        <select aria-label="Step kind" value={step.kind} disabled={locked} onChange={(event) => changeKind(event.target.value as RunWorkoutEditorStepKind)}>
          {capability.stepKinds.map((kind) => <option key={kind} value={kind}>{stepTitle(kind)}</option>)}
        </select>
        <input aria-label="Step name" value={step.name} disabled={locked} maxLength={90} onChange={(event) => onChange({ ...step, name: event.target.value })} />
        <div className="workout-step-actions">
          <IconAction label="Move up" onClick={() => onMove(-1)} disabled={disabled}><ChevronUp /></IconAction>
          <IconAction label="Move down" onClick={() => onMove(1)} disabled={disabled}><ChevronDown /></IconAction>
          {onGroup ? <IconAction label="Group with previous step" onClick={onGroup} disabled={disabled}><GripVertical /></IconAction> : null}
          {onUngroup && step.editable ? <IconAction label="Remove from repeat" onClick={onUngroup} disabled={disabled}><Ungroup /></IconAction> : null}
          <IconAction label="Duplicate step" onClick={onDuplicate} disabled={disabled || !step.editable}><Copy /></IconAction>
          <IconAction label="Delete step" onClick={onDelete} disabled={disabled}><Trash2 /></IconAction>
        </div>
      </header>
      {step.unsupportedReason ? <div className="workout-step-warning"><AlertTriangle size={14} aria-hidden="true" />{step.unsupportedReason}</div> : null}
      <div className="workout-step-fields">
        <TargetFields step={step} context={context} sport={sport} disabled={locked} onChange={onChange} />
        <IntensityFields step={step} context={context} sport={sport} disabled={locked} onChange={onChange} />
        {step.kind === "sendOff" ? <label className="workout-control-group"><span>Send-off interval</span><ClockInput label="Send-off interval" seconds={step.sendOffSeconds ?? 120} disabled={locked} onChange={(seconds) => onChange({ ...step, sendOffSeconds: seconds })} /></label> : null}
        {capability.requiresExercise && step.kind === "training" ? <div className="workout-control-group workout-exercise-control"><span>Exercise</span><ExerciseCombobox value={step.exerciseName ?? ""} selectedId={step.exerciseId} options={exerciseOptions} placeholder="Search by COROS exercise name" label="Exercise" loading={exerciseOptionsLoading} disabled={locked} onChange={(selection) => onChange({ ...step, exerciseName: selection.name, exerciseId: selection.id, exerciseKind: selection.exerciseKind })} />{step.exerciseId ? <small>COROS exercise selected</small> : <small>Name must resolve to one unique COROS exercise before upload.</small>}</div> : null}
      </div>
      {error ? <p className="workout-field-error">{error}</p> : null}
    </motion.article>
  );
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactElement<{ size?: number; "aria-hidden"?: string }> }) {
  return <button type="button" className="workout-icon-action" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children && <>{children}</>}</button>;
}

function ClockInput({ seconds, disabled, label, onChange }: { seconds: number; disabled: boolean; label: string; onChange: (seconds: number) => void }) {
  const [value, setValue] = useState(() => clockFromSeconds(seconds));
  useEffect(() => setValue(clockFromSeconds(seconds)), [seconds]);
  const commit = () => {
    const parsed = secondsFromClock(value);
    onChange(parsed);
    setValue(clockFromSeconds(parsed));
  };
  return <input aria-label={label} value={value} disabled={disabled} inputMode="numeric" placeholder="05:00" onChange={(event) => setValue(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function TargetFields({ step, context, sport, disabled, onChange }: { step: RunWorkoutEditorStep; context: WorkoutEditorContext; sport: WorkoutSport; disabled: boolean; onChange: (step: RunWorkoutEditorStep) => void }) {
  const target = step.target;
  const targetTypes = workoutTargetsForStep(sport, step.kind, step.exerciseKind);
  const distanceMultiplier = sport === "swim"
    ? context.distanceUnit === "imperial" ? 0.9144 : 1
    : context.distanceUnit === "imperial" ? 1609.344 : 1000;
  const targetDistanceUnit = sport === "swim"
    ? swimDistanceUnit(context.distanceUnit)
    : context.distanceUnit === "imperial" ? "mi" : "km";
  return <div className="workout-control-group">
    <label><span>Target</span><select value={target.type} disabled={disabled} onChange={(event) => onChange({ ...step, target: targetForType(event.target.value as RunWorkoutEditorTarget["type"], step.kind) })}>
      {targetTypes.map((type) => <option key={type} value={type}>{type === "load" ? "Training Load" : type === "hrRecovery" ? "HR Recovery" : type === "elevationGain" ? "Elevation Gain" : type[0]!.toUpperCase() + type.slice(1)}</option>)}
    </select></label>
    {target.type === "time" ? <label><span>Duration</span><ClockInput label="Duration" seconds={target.seconds} disabled={disabled} onChange={(seconds) => onChange({ ...step, target: { type: "time", seconds } })} /></label> : null}
    {target.type === "distance" ? <label><span>Distance ({targetDistanceUnit})</span><input type="number" min="0" step="0.1" value={Number((target.meters / distanceMultiplier).toFixed(3))} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "distance", meters: Number(event.target.value) * distanceMultiplier } })} /></label> : null}
    {target.type === "load" ? <label><span>Training Load</span><input type="number" min="0" max="999" step="1" value={target.load} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "load", load: Number(event.target.value) } })} /></label> : null}
    {target.type === "hrRecovery" ? <label><span>Return to bpm</span><input type="number" min="30" max="180" value={target.bpm} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "hrRecovery", bpm: Number(event.target.value) } })} /></label> : null}
    {target.type === "reps" ? <label><span>Repetitions</span><input type="number" min="1" max="500" value={target.count} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "reps", count: Number(event.target.value) } })} /></label> : null}
    {target.type === "routes" ? <label><span>Routes</span><input type="number" min="1" max="20" value={target.count} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "routes", count: Number(event.target.value) } })} /></label> : null}
    {target.type === "elevationGain" ? <label><span>Gain ({elevationUnit(context.distanceUnit)})</span><input type="number" min="20" max={context.distanceUnit === "imperial" ? 32808 : 10000} value={Number(metersToElevation(target.meters, context.distanceUnit).toFixed(1))} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "elevationGain", meters: elevationToMeters(Number(event.target.value), context.distanceUnit) } })} /></label> : null}
    {target.type === "open" ? <p className="workout-control-hint">Ends when you press the lap button.</p> : null}
  </div>;
}

function profileZone(
  context: WorkoutEditorContext,
  key: keyof WorkoutEditorContext["zones"],
  preset: string | undefined,
  id: number | undefined
) {
  return context.zones[key]?.find(
    (zone) => zone.id === id || zone.key === preset || zone.label === preset
  );
}

function derivedPaceLabel(secondsPerKm: number, context: WorkoutEditorContext): string {
  const displaySeconds = secondsPerKm * (context.paceUnit === "mi" ? 1.609344 : 1);
  return `${clockFromSeconds(displaySeconds)}/${context.paceUnit}`;
}

function IntensityFields({ step, context, sport, disabled, onChange }: { step: RunWorkoutEditorStep; context: WorkoutEditorContext; sport: WorkoutSport; disabled: boolean; onChange: (step: RunWorkoutEditorStep) => void }) {
  const intensity = step.intensity;
  const intensityTypes = workoutIntensitiesForStep(sport, step.kind, step.exerciseKind);
  const paceFactor = context.paceUnit === "mi" ? 1.609344 : 1;
  const setIntensity = (next: RunWorkoutEditorIntensity) => onChange({ ...step, intensity: next });
  const numberRange = (low: number, high: number, lowLabel: string, highLabel: string, update: (low: number, high: number) => WorkoutIntensityInput, min = 0, max = 3000) => (
    <div className="workout-range-inputs"><label><span>{lowLabel}</span><input type="number" min={min} max={max} value={low} disabled={disabled} onChange={(event) => setIntensity(update(Number(event.target.value), high))} /></label><span>to</span><label><span>{highLabel}</span><input type="number" min={min} max={max} value={high} disabled={disabled} onChange={(event) => setIntensity(update(low, Number(event.target.value)))} /></label></div>
  );
  const percentRange = (value: { lowPercent: number; highPercent: number }, update: (low: number, high: number) => WorkoutIntensityInput) => numberRange(value.lowPercent, value.highPercent, "Low %", "High %", update, 1, 300);
  return <div className="workout-control-group">
    <label><span>Intensity</span><select value={intensity.type === "lthrPercent" ? "heartRatePercent" : intensity.type} disabled={disabled} onChange={(event) => setIntensity(intensityForType(event.target.value as RunWorkoutEditorIntensity["type"], context))}>
      {intensityTypes.map((type) => <option key={type} value={type}>{formatIntensityType(type)}</option>)}
    </select></label>

    {(intensity.type === "pace" || intensity.type === "effortPace") ? <div className="workout-range-inputs"><label><span>Fast ({context.paceUnit})</span><ClockInput label={`Fast pace per ${context.paceUnit}`} seconds={intensity.lowSecondsPerKm * paceFactor} disabled={disabled} onChange={(seconds) => setIntensity({ ...intensity, lowSecondsPerKm: seconds / paceFactor, displayUnit: context.paceUnit })} /></label><span>to</span><label><span>Slow ({context.paceUnit})</span><ClockInput label={`Slow pace per ${context.paceUnit}`} seconds={intensity.highSecondsPerKm * paceFactor} disabled={disabled} onChange={(seconds) => setIntensity({ ...intensity, highSecondsPerKm: seconds / paceFactor, displayUnit: context.paceUnit })} /></label></div> : null}

    {intensity.type === "heartRate" ? numberRange(intensity.lowBpm, intensity.highBpm, "Low bpm", "High bpm", (lowBpm, highBpm) => ({ type: "heartRate", lowBpm, highBpm }), 30, 250) : null}

    {intensity.type === "heartRatePercent" ? <>
      <label><span>Basis</span><select value={intensity.basis} disabled={disabled} onChange={(event) => setIntensity({ type: "heartRatePercent", basis: event.target.value as WorkoutHeartRateBasis, preset: "aerobicEndurance" })}><option value="maxHr">% Max Heart Rate</option><option value="reserve">% Heart Rate Reserve</option><option value="lthr">% Lactate Threshold HR</option></select></label>
      <label><span>Zone or custom</span><select value={intensity.preset ?? "custom"} disabled={disabled} onChange={(event) => { const preset = event.target.value; const definition = HEART_RATE_PRESETS[intensity.basis].find((zone) => zone.preset === preset); const configured = profileZone(context, intensity.basis, preset, definition?.id); setIntensity(preset === "custom" ? { type: "heartRatePercent", basis: intensity.basis, lowPercent: 80, highPercent: 90 } : { type: "heartRatePercent", basis: intensity.basis, preset: preset as never, ...(configured ? { zoneId: configured.id } : {}) }); }}><option value="custom">Custom range</option>{HEART_RATE_PRESETS[intensity.basis].map((zone) => { const configured = profileZone(context, intensity.basis, zone.preset, zone.id); return <option key={zone.id} value={zone.preset}>{configured?.label ?? zone.label} · {configured?.lowPercent ?? zone.low}–{configured?.highPercent ?? zone.high}%</option>; })}</select></label>
      {!intensity.preset ? percentRange(intensity, (lowPercent, highPercent) => ({ type: "heartRatePercent", basis: intensity.basis, lowPercent, highPercent })) : null}
      <HeartRatePreview intensity={intensity} context={context} />
    </> : null}

    {(intensity.type === "thresholdPacePercent" || intensity.type === "effortPacePercent") ? <>
      <label><span>Zone or custom</span><select value={intensity.preset ?? "custom"} disabled={disabled} onChange={(event) => { const preset = event.target.value; const definition = PACE_PRESETS.find((zone) => zone.preset === preset); const configured = profileZone(context, "thresholdPace", preset, definition?.id); setIntensity((preset === "custom" ? { type: intensity.type, lowPercent: 90, highPercent: 100 } : { type: intensity.type, preset, ...(configured ? { zoneId: configured.id } : {}) }) as WorkoutIntensityInput); }}><option value="custom">Custom range</option>{PACE_PRESETS.map((zone) => { const configured = profileZone(context, "thresholdPace", zone.preset, zone.id); return <option key={zone.id} value={zone.preset}>{configured?.label ?? zone.label} · {configured?.lowPercent ?? zone.low}–{configured?.highPercent ?? zone.high}%</option>; })}</select></label>
      {!intensity.preset ? percentRange(intensity, (lowPercent, highPercent) => ({ type: intensity.type, lowPercent, highPercent })) : null}
      <PacePercentPreview intensity={intensity} context={context} />
    </> : null}

    {intensity.type === "ftpPercent" ? <>
      <label><span>Zone or custom</span><select value={intensity.preset ?? "custom"} disabled={disabled} onChange={(event) => { const preset = event.target.value; const definition = FTP_PRESETS.find((zone) => zone.preset === preset); const configured = profileZone(context, "ftp", preset, definition?.id); setIntensity(preset === "custom" ? { type: "ftpPercent", lowPercent: 90, highPercent: 100 } : { type: "ftpPercent", preset: preset as never, ...(configured ? { zoneId: configured.id } : {}) }); }}><option value="custom">Custom range</option>{FTP_PRESETS.map((zone) => { const configured = profileZone(context, "ftp", zone.preset, zone.id); return <option key={zone.id} value={zone.preset}>{configured?.label ?? zone.label} · {configured?.lowPercent ?? zone.low}–{configured?.highPercent ?? zone.high}%</option>; })}</select></label>
      {!intensity.preset ? percentRange(intensity, (lowPercent, highPercent) => ({ type: "ftpPercent", lowPercent, highPercent })) : null}
      <PowerPercentPreview intensity={intensity} context={context} reference={context.ftp} zoneKey="ftp" />
    </> : null}

    {intensity.type === "power" ? <>
      <label><span>Zone or custom</span><select value={intensity.preset ?? "custom"} disabled={disabled} onChange={(event) => { const preset = event.target.value; const definition = RUNNING_POWER_PRESETS.find((zone) => zone.preset === preset); const configured = profileZone(context, "runningPower", preset, definition?.id); setIntensity(preset === "custom" ? { type: "power", lowWatts: 180, highWatts: 220 } : { type: "power", preset: preset as never, ...(configured ? { zoneId: configured.id } : {}) }); }}><option value="custom">Custom watts</option>{RUNNING_POWER_PRESETS.map((zone) => { const configured = profileZone(context, "runningPower", zone.preset, zone.id); return <option key={zone.id} value={zone.preset}>{configured?.label ?? zone.label} · {configured?.lowPercent ?? zone.low}–{configured?.highPercent ?? zone.high}%</option>; })}</select></label>
      {!intensity.preset ? numberRange(intensity.lowWatts, intensity.highWatts, "Low W", "High W", (lowWatts, highWatts) => ({ type: "power", lowWatts, highWatts }), 0, 3000) : <PowerPercentPreview intensity={intensity} context={context} reference={context.criticalPower} zoneKey="runningPower" />}
    </> : null}

    {intensity.type === "speed" ? numberRange(intensity.low, intensity.high, `Low ${intensity.unit}`, `High ${intensity.unit}`, (low, high) => ({ ...intensity, low, high }), 0, 200) : null}
    {intensity.type === "cadence" ? numberRange(intensity.low, intensity.high, `Low ${intensity.unit}`, `High ${intensity.unit}`, (low, high) => ({ ...intensity, low, high }), 0, 300) : null}

    {intensity.type === "swimStroke" ? <label><span>Stroke</span><select value={intensity.stroke} disabled={disabled} onChange={(event) => setIntensity({ type: "swimStroke", stroke: event.target.value as keyof typeof SWIM_STROKE_IDS })}>{Object.keys(SWIM_STROKE_IDS).map((stroke) => <option key={stroke} value={stroke}>{stroke}</option>)}</select></label> : null}

    {intensity.type === "weight" ? <><label><span>Load</span><select value={intensity.mode} disabled={disabled} onChange={(event) => setIntensity(event.target.value === "bodyweight" ? { type: "weight", mode: "bodyweight" } : { type: "weight", mode: "weight", value: 10, unit: context.distanceUnit === "imperial" ? "lb" : "kg" })}><option value="bodyweight">Bodyweight</option><option value="weight">Weight</option></select></label>{intensity.mode === "weight" ? <label><span>Weight ({context.distanceUnit === "imperial" ? "lb" : "kg"})</span><input type="number" min="0" max="2000" value={intensity.value} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, value: Number(event.target.value), unit: context.distanceUnit === "imperial" ? "lb" : "kg" })} /></label> : null}</> : null}

    {intensity.type === "rpe" ? <label><span>RPE</span><select value={intensity.value} disabled={disabled} onChange={(event) => setIntensity({ type: "rpe", value: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}

    {intensity.type === "climbGrade" ? <>
      <label><span>System</span><select value={intensity.system} disabled={disabled} onChange={(event) => setIntensity({ type: "climbGrade", system: event.target.value as keyof typeof CLIMB_SYSTEM_IDS, relativeToOnsight: 0 })}>{Object.keys(CLIMB_SYSTEM_IDS).map((system) => <option key={system} value={system}>{system}</option>)}</select></label>
      <label><span>Grade mode</span><select value={"relativeToOnsight" in intensity ? "relative" : "absolute"} disabled={disabled} onChange={(event) => setIntensity(event.target.value === "relative" ? { type: "climbGrade", system: intensity.system, relativeToOnsight: 0 } : { type: "climbGrade", system: intensity.system, absoluteGrade: CLIMB_GRADES[intensity.system][0]! })}><option value="relative">Relative to onsight</option><option value="absolute">Absolute grade</option></select></label>
      {"relativeToOnsight" in intensity && intensity.relativeToOnsight !== undefined ? <label><span>Relative level</span><select value={intensity.relativeToOnsight} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, relativeToOnsight: Number(event.target.value) })}>{Array.from({ length: 13 }, (_, index) => index - 8).map((value) => <option key={value} value={value}>{value === 0 ? "Onsight" : `${value > 0 ? "+" : ""}${value}`}</option>)}</select></label> : null}
      {"absoluteGrade" in intensity && intensity.absoluteGrade !== undefined ? <label><span>Grade</span><select value={intensity.absoluteGrade} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, absoluteGrade: event.target.value })}>{CLIMB_GRADES[intensity.system].map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label> : null}
    </> : null}
  </div>;
}

function HeartRatePreview({ intensity, context }: { intensity: Extract<WorkoutIntensityInput, { type: "heartRatePercent" }>; context: WorkoutEditorContext }) {
  const definition = HEART_RATE_PRESETS[intensity.basis].find((zone) => zone.preset === intensity.preset);
  const configured = profileZone(context, intensity.basis, intensity.preset, intensity.zoneId ?? definition?.id);
  const low = intensity.lowPercent ?? configured?.lowPercent ?? definition?.low;
  const high = intensity.highPercent ?? configured?.highPercent ?? definition?.high;
  const reference = intensity.basis === "lthr" ? context.lthrBpm : context.maxHr;
  if (low === undefined || high === undefined || !reference) return <p className="workout-control-hint">Profile reference is unavailable; COROS will still receive the percentage target.</p>;
  const lowBpm = intensity.basis === "reserve" && context.restingHr
    ? context.restingHr + (reference - context.restingHr) * low / 100
    : reference * low / 100;
  const highBpm = intensity.basis === "reserve" && context.restingHr
    ? context.restingHr + (reference - context.restingHr) * high / 100
    : reference * high / 100;
  return <p className="workout-control-hint">Derived preview: {Math.round(lowBpm)}–{Math.round(highBpm)} bpm.</p>;
}

function PacePercentPreview({ intensity, context }: { intensity: Extract<WorkoutIntensityInput, { type: "thresholdPacePercent" | "effortPacePercent" }>; context: WorkoutEditorContext }) {
  const definition = PACE_PRESETS.find((zone) => zone.preset === intensity.preset);
  const configured = profileZone(context, "thresholdPace", intensity.preset, intensity.zoneId ?? definition?.id);
  const low = intensity.lowPercent ?? configured?.lowPercent ?? definition?.low;
  const high = intensity.highPercent ?? configured?.highPercent ?? definition?.high;
  if (!context.thresholdPaceSecondsPerKm || !low || !high) {
    return <p className="workout-control-hint">Threshold pace is unavailable; the percentage target will still be saved.</p>;
  }
  return <p className="workout-control-hint">Derived preview: {derivedPaceLabel(context.thresholdPaceSecondsPerKm * 100 / high, context)}–{derivedPaceLabel(context.thresholdPaceSecondsPerKm * 100 / low, context)}.</p>;
}

function PowerPercentPreview({ intensity, context, reference, zoneKey }: { intensity: Extract<WorkoutIntensityInput, { type: "ftpPercent" }> | Extract<WorkoutIntensityInput, { type: "power" }> & { preset: string }; context: WorkoutEditorContext; reference?: number; zoneKey: "ftp" | "runningPower" }) {
  const definitions = zoneKey === "ftp" ? FTP_PRESETS : RUNNING_POWER_PRESETS;
  const definition = definitions.find((zone) => zone.preset === intensity.preset);
  const configured = profileZone(context, zoneKey, intensity.preset, intensity.zoneId ?? definition?.id);
  const low = "lowPercent" in intensity && intensity.lowPercent !== undefined ? intensity.lowPercent : configured?.lowPercent ?? definition?.low;
  const high = "highPercent" in intensity && intensity.highPercent !== undefined ? intensity.highPercent : configured?.highPercent ?? definition?.high;
  if (!reference || low === undefined || high === undefined) {
    return <p className="workout-control-hint">Profile reference is unavailable; the percentage zone will still be saved.</p>;
  }
  return <p className="workout-control-hint">Derived preview: {Math.round(reference * low / 100)}–{Math.round(reference * high / 100)} W.</p>;
}

function RepeatCard({ group, nodeIndex, context, sport, exerciseOptions, exerciseOptionsLoading, errors, disabled, onDragStart, onChange, onMove, onDuplicate, onDelete, onStepChange, onStepMove, onStepDuplicate, onStepDelete, onStepUngroup }: {
  group: RunWorkoutEditorRepeatGroup; nodeIndex: number; context: WorkoutEditorContext; sport: WorkoutSport; exerciseOptions: WorkoutExerciseOption[]; exerciseOptionsLoading: boolean; errors: Record<string, string>; disabled: boolean;
  onDragStart: (event: DragEvent) => void; onChange: (group: RunWorkoutEditorRepeatGroup) => void; onMove: (direction: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void;
  onStepChange: (id: string, step: RunWorkoutEditorStep) => void; onStepMove: (id: string, direction: -1 | 1) => void; onStepDuplicate: (id: string) => void; onStepDelete: (id: string) => void; onStepUngroup: (id: string) => void;
}) {
  const locked = disabled || !group.editable;
  const duplicateLocked = locked || group.steps.some((step) => !step.editable);
  return <motion.section layout className="workout-repeat-card" draggable={!disabled} onDragStartCapture={onDragStart}>
    <header className="workout-repeat-header"><GripVertical size={18} aria-hidden="true" /><input aria-label="Repeat group name" value={group.name} disabled={locked} onChange={(event) => onChange({ ...group, name: event.target.value })} /><div className="workout-repeat-count"><span>Repeat</span><button type="button" disabled={locked || group.repeat <= 1} onClick={() => onChange({ ...group, repeat: group.repeat - 1 })}>−</button><input aria-label="Repeat count" type="number" min="1" max="99" value={group.repeat} disabled={locked} onChange={(event) => onChange({ ...group, repeat: Number(event.target.value) })} /><button type="button" disabled={locked || group.repeat >= 99} onClick={() => onChange({ ...group, repeat: group.repeat + 1 })}>+</button></div><div className="workout-step-actions"><IconAction label="Move group up" onClick={() => onMove(-1)} disabled={disabled}><ChevronUp /></IconAction><IconAction label="Move group down" onClick={() => onMove(1)} disabled={disabled}><ChevronDown /></IconAction><IconAction label="Duplicate group" onClick={onDuplicate} disabled={duplicateLocked}><Copy /></IconAction><IconAction label="Delete group" onClick={onDelete} disabled={disabled}><Trash2 /></IconAction></div></header>
    {errors[`nodes.${nodeIndex}.repeat`] ? <p className="workout-field-error">{errors[`nodes.${nodeIndex}.repeat`]}</p> : null}
    <div className="workout-repeat-steps">{group.steps.map((step, childIndex) => <StepCard key={step.id} step={step} location={{ nodeId: group.id, childId: step.id }} context={context} sport={sport} exerciseOptions={exerciseOptions} exerciseOptionsLoading={exerciseOptionsLoading} disabled={disabled} draggable error={errors[`nodes.${nodeIndex}.steps.${childIndex}.target`] ?? errors[`nodes.${nodeIndex}.steps.${childIndex}.intensity`] ?? errors[`nodes.${nodeIndex}.steps.${childIndex}.exercise`]} onDragStart={(event) => event.dataTransfer.setData("text/workout-node", step.id)} onDropCard={(sourceId) => { const from = group.steps.findIndex((candidate) => candidate.id === sourceId); const to = group.steps.findIndex((candidate) => candidate.id === step.id); if (from >= 0 && to >= 0) onChange({ ...group, steps: moveItem(group.steps, from, to) }); }} onChange={(next) => onStepChange(step.id, next)} onMove={(direction) => onStepMove(step.id, direction)} onDuplicate={() => onStepDuplicate(step.id)} onDelete={() => onStepDelete(step.id)} onUngroup={() => onStepUngroup(step.id)} />)}</div>
    <button type="button" className="ghost-button workout-repeat-add" disabled={locked} onClick={() => onChange({ ...group, steps: [...group.steps, emptyStep("rest", sport)] })}><Plus size={14} aria-hidden="true" /> Add step to repeat</button>
  </motion.section>;
}

function EstimateFooter({ preview, loading, error, context }: { preview: WorkoutEditPreview | null; loading: boolean; error: string | null; context: WorkoutEditorContext }) {
  const distance = preview?.distanceMeters;
  const displayDistance = distance === undefined ? "--" : context.distanceUnit === "imperial" ? `${(distance / 1609.344).toFixed(2)} mi` : `${(distance / 1000).toFixed(2)} km`;
  return <div className="workout-estimate" aria-live="polite">
    {loading ? <span><LoaderCircle className="is-spinning" size={14} aria-hidden="true" /> Calculating...</span> : error ? <span className="is-error"><AlertTriangle size={14} aria-hidden="true" /> {error}</span> : <>
      <span><small>Duration</small><strong>{preview?.durationSeconds !== undefined ? clockFromSeconds(preview.durationSeconds) : "--"}</strong></span>
      <span><small>Distance</small><strong>{displayDistance}</strong></span>
      <span><small>Training Load</small><strong>{preview?.trainingLoad !== undefined ? Math.round(preview.trainingLoad) : "--"}</strong></span>
      {preview?.baseFitness !== undefined ? <span><small>Base Fitness</small><strong>{Math.round(preview.baseFitness)}</strong></span> : null}
      {preview?.loadImpact !== undefined ? <span><small>Load Impact</small><strong>{Math.round(preview.loadImpact)}</strong></span> : null}
      {preview?.intensityTrendPercent !== undefined ? <span><small>Intensity Trend</small><strong>{Math.round(preview.intensityTrendPercent)}%</strong></span> : null}
    </>}
  </div>;
}
