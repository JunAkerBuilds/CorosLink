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
  WorkoutEditorContext
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

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

function emptyStep(kind: RunWorkoutEditorStepKind = "training"): RunWorkoutEditorStep {
  return {
    id: localId("step"),
    nodeType: "step",
    kind,
    name: kind === "rest" ? "Rest" : kind === "warmup" ? "Warm Up" : kind === "cooldown" ? "Cool Down" : "Training",
    target: { type: "time", seconds: kind === "rest" ? 60 : 300 },
    intensity: { type: "none" },
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
  if (type === "open") return { type };
  return { type, seconds: kind === "rest" ? 60 : 300 };
}

function intensityForType(
  type: RunWorkoutEditorIntensity["type"],
  context: WorkoutEditorContext
): RunWorkoutEditorIntensity {
  if (type === "pace") {
    return {
      type,
      lowSecondsPerKm: 300,
      highSecondsPerKm: 330,
      displayUnit: context.paceUnit
    };
  }
  if (type === "heartRate") return { type, lowBpm: 140, highBpm: 155 };
  if (type === "lthrPercent") {
    const zone = context.lthrZones[2];
    return {
      type,
      lowPercent: zone?.lowPercent ?? 90,
      highPercent: zone?.highPercent ?? 95,
      ...(zone ? { zoneId: zone.index } : {})
    };
  }
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

function validateDraft(draft: RunWorkoutEditorDraft): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Name is required.";
  if (draft.name.trim().length > 90) errors.name = "Name must be 90 characters or fewer.";
  if (draft.overview.length > 300) errors.overview = "Description must be 300 characters or fewer.";
  if (draft.nodes.length === 0) errors.nodes = "Add at least one workout step.";
  const checkStep = (step: RunWorkoutEditorStep, path: string) => {
    if (!step.editable) return;
    const target = step.target;
    if (target.type === "time" && target.seconds <= 0) errors[`${path}.target`] = "Time must be greater than zero.";
    if (target.type === "distance" && target.meters <= 0) errors[`${path}.target`] = "Distance must be greater than zero.";
    if (target.type === "load" && (!Number.isInteger(target.load) || target.load < 0 || target.load > 999)) errors[`${path}.target`] = "Training Load must be a whole number from 0 to 999.";
    if (target.type === "hrRecovery" && (step.kind !== "rest" || target.bpm < 30 || target.bpm > 250)) errors[`${path}.target`] = "HR Recovery must be from 30 to 250 bpm on a Rest step.";
    const intensity = step.intensity;
    if (intensity.type === "pace" && (intensity.lowSecondsPerKm <= 0 || intensity.highSecondsPerKm <= 0 || intensity.lowSecondsPerKm > intensity.highSecondsPerKm)) errors[`${path}.intensity`] = "Enter a valid pace range.";
    if (intensity.type === "heartRate" && (intensity.lowBpm < 30 || intensity.highBpm > 250 || intensity.lowBpm > intensity.highBpm)) errors[`${path}.intensity`] = "Heart rate must be from 30 to 250 bpm.";
    if (intensity.type === "lthrPercent" && (intensity.lowPercent < 1 || intensity.highPercent > 200 || intensity.lowPercent > intensity.highPercent)) errors[`${path}.intensity`] = "LTHR percentage must be from 1 to 200%.";
  };
  draft.nodes.forEach((node, index) => {
    if (node.nodeType === "step") checkStep(node, `nodes.${index}`);
    else {
      if (!Number.isInteger(node.repeat) || node.repeat < 1 || node.repeat > 99) errors[`nodes.${index}.repeat`] = "Repeat count must be from 1 to 99.";
      if (node.steps.length === 0) errors[`nodes.${index}.steps`] = "Repeat groups need at least one step.";
      node.steps.forEach((step, childIndex) => checkStep(step, `nodes.${index}.steps.${childIndex}`));
    }
  });
  return { valid: Object.keys(errors).length === 0, errors };
}

export function WorkoutEditorModal({
  api,
  editRef,
  onClose,
  onSaved,
  onError
}: WorkoutEditorModalProps) {
  const reducedMotion = useReducedMotion();
  const [document, setDocument] = useState<Awaited<ReturnType<CorosLinkApi["getWorkoutForEdit"]>> | null>(null);
  const [draft, setDraft] = useState<RunWorkoutEditorDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkoutEditPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const previewSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setDraft(null);
    setLoadError(null);
    void api.getWorkoutForEdit(editRef).then((loaded) => {
      if (!cancelled) {
        setDocument(loaded);
        setDraft(structuredClone(loaded.draft));
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [api, editRef]);

  const dirty = Boolean(document && draft && JSON.stringify(document.draft) !== JSON.stringify(draft));
  const validation = useMemo(
    () => draft ? validateDraft(draft) : { valid: false, errors: {} },
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
      void api.previewWorkoutEdit(editRef, document.revision, draft)
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
  }, [api, document, draft, editRef, validation.valid]);

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
      const result = await api.saveWorkoutEdit(editRef, document.revision, draft);
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
              <h2 id="workout-editor-title">Edit running workout</h2>
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
                  <button type="button" className="ghost-button" disabled={!document.canEdit || saving} onClick={() => setDraft({ ...draft, nodes: [...draft.nodes, emptyStep()] })}>
                    <Plus size={15} aria-hidden="true" /> Add step
                  </button>
                </div>

                {draft.nodes.length === 0 ? (
                  <div className="workout-editor-empty"><p>No workout steps yet.</p><button type="button" className="primary-button" onClick={() => setDraft({ ...draft, nodes: [emptyStep()] })}>Add first step</button></div>
                ) : (
                  <div className="workout-editor-nodes">
                    {draft.nodes.map((node, index) => (
                      <div key={node.id}>
                        <div className="workout-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderTop(event.dataTransfer.getData("text/workout-node"), index); }} />
                        {node.nodeType === "step" ? (
                          <StepCard
                            step={node} location={{ nodeId: node.id }} context={document.context}
                            error={validation.errors[`nodes.${index}.target`] ?? validation.errors[`nodes.${index}.intensity`]}
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
                            group={node} nodeIndex={index} context={document.context} errors={validation.errors}
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

function StepCard({ step, context, error, disabled, draggable, onDragStart, onDropCard, onChange, onMove, onDuplicate, onDelete, onGroup, onUngroup }: StepCardProps) {
  const locked = disabled || !step.editable;
  const changeKind = (kind: RunWorkoutEditorStepKind) => {
    let target = step.target;
    if (target.type === "hrRecovery" && kind !== "rest") target = { type: "time", seconds: 60 };
    onChange({ ...step, kind, name: stepTitle(kind), target });
  };
  return (
    <motion.article layout className={`workout-step-card is-${step.kind} ${!step.editable ? "is-locked" : ""}`} draggable={draggable && !disabled} onDragStartCapture={onDragStart} onDragOver={(event) => { if (onDropCard) event.preventDefault(); }} onDrop={(event) => { if (!onDropCard) return; event.preventDefault(); onDropCard(event.dataTransfer.getData("text/workout-node")); }}>
      <header className="workout-step-header">
        <GripVertical className="workout-drag-handle" size={18} aria-hidden="true" />
        <select aria-label="Step kind" value={step.kind} disabled={locked} onChange={(event) => changeKind(event.target.value as RunWorkoutEditorStepKind)}>
          <option value="warmup">Warm Up</option><option value="training">Training</option><option value="rest">Rest</option><option value="cooldown">Cool Down</option>
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
        <TargetFields step={step} context={context} disabled={locked} onChange={onChange} />
        <IntensityFields step={step} context={context} disabled={locked} onChange={onChange} />
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

function TargetFields({ step, context, disabled, onChange }: { step: RunWorkoutEditorStep; context: WorkoutEditorContext; disabled: boolean; onChange: (step: RunWorkoutEditorStep) => void }) {
  const target = step.target;
  const distanceMultiplier = context.distanceUnit === "imperial" ? 1609.344 : 1000;
  return <div className="workout-control-group">
    <label><span>Target</span><select value={target.type} disabled={disabled} onChange={(event) => onChange({ ...step, target: targetForType(event.target.value as RunWorkoutEditorTarget["type"], step.kind) })}>
      <option value="time">Time</option><option value="distance">Distance</option><option value="load">Training Load</option>{step.kind === "rest" ? <option value="hrRecovery">HR Recovery</option> : null}<option value="open">Open</option>
    </select></label>
    {target.type === "time" ? <label><span>Duration</span><ClockInput label="Duration" seconds={target.seconds} disabled={disabled} onChange={(seconds) => onChange({ ...step, target: { type: "time", seconds } })} /></label> : null}
    {target.type === "distance" ? <label><span>Distance ({context.distanceUnit === "imperial" ? "mi" : "km"})</span><input type="number" min="0" step="0.1" value={Number((target.meters / distanceMultiplier).toFixed(3))} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "distance", meters: Number(event.target.value) * distanceMultiplier } })} /></label> : null}
    {target.type === "load" ? <label><span>Training Load</span><input type="number" min="0" max="999" step="1" value={target.load} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "load", load: Number(event.target.value) } })} /></label> : null}
    {target.type === "hrRecovery" ? <label><span>Return to bpm</span><input type="number" min="30" max="250" value={target.bpm} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "hrRecovery", bpm: Number(event.target.value) } })} /></label> : null}
    {target.type === "open" ? <p className="workout-control-hint">Ends when you press the lap button.</p> : null}
  </div>;
}

function IntensityFields({ step, context, disabled, onChange }: { step: RunWorkoutEditorStep; context: WorkoutEditorContext; disabled: boolean; onChange: (step: RunWorkoutEditorStep) => void }) {
  const intensity = step.intensity;
  const paceFactor = context.paceUnit === "mi" ? 1.609344 : 1;
  const setIntensity = (next: RunWorkoutEditorIntensity) => onChange({ ...step, intensity: next });
  const lthrBpm = context.lthrBpm;
  return <div className="workout-control-group">
    <label><span>Intensity</span><select value={intensity.type} disabled={disabled} onChange={(event) => setIntensity(intensityForType(event.target.value as RunWorkoutEditorIntensity["type"], context))}>
      <option value="none">Not Set</option><option value="pace">Pace range</option><option value="heartRate">Heart Rate range</option><option value="lthrPercent">Percent LTHR</option>
    </select></label>
    {intensity.type === "pace" ? <div className="workout-range-inputs"><label><span>Fast ({context.paceUnit})</span><ClockInput label={`Fast pace per ${context.paceUnit}`} seconds={intensity.lowSecondsPerKm * paceFactor} disabled={disabled} onChange={(seconds) => setIntensity({ ...intensity, lowSecondsPerKm: seconds / paceFactor, displayUnit: context.paceUnit })} /></label><span>to</span><label><span>Slow ({context.paceUnit})</span><ClockInput label={`Slow pace per ${context.paceUnit}`} seconds={intensity.highSecondsPerKm * paceFactor} disabled={disabled} onChange={(seconds) => setIntensity({ ...intensity, highSecondsPerKm: seconds / paceFactor, displayUnit: context.paceUnit })} /></label></div> : null}
    {intensity.type === "heartRate" ? <div className="workout-range-inputs"><label><span>Low bpm</span><input type="number" min="30" max="250" value={intensity.lowBpm} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, lowBpm: Number(event.target.value) })} /></label><span>to</span><label><span>High bpm</span><input type="number" min="30" max="250" value={intensity.highBpm} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, highBpm: Number(event.target.value) })} /></label></div> : null}
    {intensity.type === "lthrPercent" ? <>
      {context.lthrZones.length > 0 ? <label><span>COROS zone preset</span><select value={intensity.zoneId ?? "custom"} disabled={disabled} onChange={(event) => { const zone = context.lthrZones.find((item) => item.index === Number(event.target.value)); setIntensity(zone ? { type: "lthrPercent", lowPercent: zone.lowPercent, highPercent: zone.highPercent, zoneId: zone.index } : { ...intensity, zoneId: undefined }); }}><option value="custom">Custom range</option>{context.lthrZones.map((zone) => <option key={zone.index} value={zone.index}>{zone.label}: {zone.lowPercent} to {zone.highPercent}%</option>)}</select></label> : null}
      <div className="workout-range-inputs"><label><span>Low %</span><input type="number" min="1" max="200" value={intensity.lowPercent} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, lowPercent: Number(event.target.value), zoneId: undefined })} /></label><span>to</span><label><span>High %</span><input type="number" min="1" max="200" value={intensity.highPercent} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, highPercent: Number(event.target.value), zoneId: undefined })} /></label></div>
      <p className="workout-control-hint">{lthrBpm ? `Preview: ${Math.round(lthrBpm * intensity.lowPercent / 100)} to ${Math.round(lthrBpm * intensity.highPercent / 100)} bpm from ${lthrBpm} LTHR` : "COROS zone data is unavailable. Percentages will still be saved."}</p>
    </> : null}
  </div>;
}

function RepeatCard({ group, nodeIndex, context, errors, disabled, onDragStart, onChange, onMove, onDuplicate, onDelete, onStepChange, onStepMove, onStepDuplicate, onStepDelete, onStepUngroup }: {
  group: RunWorkoutEditorRepeatGroup; nodeIndex: number; context: WorkoutEditorContext; errors: Record<string, string>; disabled: boolean;
  onDragStart: (event: DragEvent) => void; onChange: (group: RunWorkoutEditorRepeatGroup) => void; onMove: (direction: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void;
  onStepChange: (id: string, step: RunWorkoutEditorStep) => void; onStepMove: (id: string, direction: -1 | 1) => void; onStepDuplicate: (id: string) => void; onStepDelete: (id: string) => void; onStepUngroup: (id: string) => void;
}) {
  const locked = disabled || !group.editable;
  const duplicateLocked = locked || group.steps.some((step) => !step.editable);
  return <motion.section layout className="workout-repeat-card" draggable={!disabled} onDragStartCapture={onDragStart}>
    <header className="workout-repeat-header"><GripVertical size={18} aria-hidden="true" /><input aria-label="Repeat group name" value={group.name} disabled={locked} onChange={(event) => onChange({ ...group, name: event.target.value })} /><div className="workout-repeat-count"><span>Repeat</span><button type="button" disabled={locked || group.repeat <= 1} onClick={() => onChange({ ...group, repeat: group.repeat - 1 })}>−</button><input aria-label="Repeat count" type="number" min="1" max="99" value={group.repeat} disabled={locked} onChange={(event) => onChange({ ...group, repeat: Number(event.target.value) })} /><button type="button" disabled={locked || group.repeat >= 99} onClick={() => onChange({ ...group, repeat: group.repeat + 1 })}>+</button></div><div className="workout-step-actions"><IconAction label="Move group up" onClick={() => onMove(-1)} disabled={disabled}><ChevronUp /></IconAction><IconAction label="Move group down" onClick={() => onMove(1)} disabled={disabled}><ChevronDown /></IconAction><IconAction label="Duplicate group" onClick={onDuplicate} disabled={duplicateLocked}><Copy /></IconAction><IconAction label="Delete group" onClick={onDelete} disabled={disabled}><Trash2 /></IconAction></div></header>
    {errors[`nodes.${nodeIndex}.repeat`] ? <p className="workout-field-error">{errors[`nodes.${nodeIndex}.repeat`]}</p> : null}
    <div className="workout-repeat-steps">{group.steps.map((step, childIndex) => <StepCard key={step.id} step={step} location={{ nodeId: group.id, childId: step.id }} context={context} disabled={disabled} draggable error={errors[`nodes.${nodeIndex}.steps.${childIndex}.target`] ?? errors[`nodes.${nodeIndex}.steps.${childIndex}.intensity`]} onDragStart={(event) => event.dataTransfer.setData("text/workout-node", step.id)} onDropCard={(sourceId) => { const from = group.steps.findIndex((candidate) => candidate.id === sourceId); const to = group.steps.findIndex((candidate) => candidate.id === step.id); if (from >= 0 && to >= 0) onChange({ ...group, steps: moveItem(group.steps, from, to) }); }} onChange={(next) => onStepChange(step.id, next)} onMove={(direction) => onStepMove(step.id, direction)} onDuplicate={() => onStepDuplicate(step.id)} onDelete={() => onStepDelete(step.id)} onUngroup={() => onStepUngroup(step.id)} />)}</div>
    <button type="button" className="ghost-button workout-repeat-add" disabled={locked} onClick={() => onChange({ ...group, steps: [...group.steps, emptyStep("rest")] })}><Plus size={14} aria-hidden="true" /> Add step to repeat</button>
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
