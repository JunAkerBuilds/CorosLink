import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  Search,
  X
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import type { WorkoutExerciseOption } from "../../electron/types";
import { resolveExerciseName } from "../training/exerciseNames";

export interface ExerciseComboboxSelection {
  name: string;
  id?: string;
  exerciseKind?: number;
}

interface ExerciseComboboxProps {
  value: string;
  selectedId?: string;
  options: WorkoutExerciseOption[];
  placeholder: string;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (selection: ExerciseComboboxSelection) => void;
}

interface LabeledExerciseOption extends WorkoutExerciseOption {
  label: string;
}

const MAX_VISIBLE_RESULTS = 12;

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function exerciseLabel(option: WorkoutExerciseOption): string {
  return resolveExerciseName(option.name) || option.name;
}

export function ExerciseCombobox({
  value,
  selectedId,
  options,
  placeholder,
  label,
  loading = false,
  disabled = false,
  onChange
}: ExerciseComboboxProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMediaIndex, setPreviewMediaIndex] = useState(0);
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listboxId = `${id}-listbox`;

  const labeledOptions = useMemo<LabeledExerciseOption[]>(() => options
    .map((option) => ({ ...option, label: exerciseLabel(option) }))
    .sort((left, right) => left.label.localeCompare(right.label)), [options]);
  const selectedOption = useMemo(
    () => labeledOptions.find((option) => option.id === selectedId),
    [labeledOptions, selectedId]
  );
  const previewMedia = useMemo(
    () => selectedOption?.media?.filter((entry) => entry.videoUrl) ?? [],
    [selectedOption]
  );
  const activePreviewMedia = previewMedia[previewMediaIndex] ?? previewMedia[0];

  const filteredOptions = useMemo(() => {
    const term = normalizeSearch(query);
    const selectedLabel = labeledOptions.find((option) => option.id === selectedId)?.label;
    const showAll = !term || Boolean(
      selectedId && selectedLabel && normalizeSearch(selectedLabel) === term
    );
    const matches = showAll
      ? labeledOptions
      : labeledOptions.filter((option) => normalizeSearch(option.label).includes(term));
    return matches.slice(0, MAX_VISIBLE_RESULTS);
  }, [labeledOptions, query, selectedId]);

  useEffect(() => {
    if (!isOpen) setQuery(value);
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedIndex = filteredOptions.findIndex((option) => option.id === selectedId);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filteredOptions, isOpen, selectedId]);

  useEffect(() => {
    setPreviewOpen(false);
    setPreviewMediaIndex(0);
  }, [selectedId]);

  useEffect(() => {
    if (!isOpen && !previewOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setPreviewOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, previewOpen]);

  const selectOption = (option: LabeledExerciseOption) => {
    setQuery(option.label);
    setIsOpen(false);
    setPreviewOpen(false);
    onChange({
      name: option.label,
      id: option.id,
      exerciseKind: option.exerciseKind
    });
  };

  const open = () => {
    if (!disabled) {
      setPreviewOpen(false);
      setIsOpen(true);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        open();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setHighlightedIndex((current) => {
        if (filteredOptions.length === 0) return 0;
        return (current + direction + filteredOptions.length) % filteredOptions.length;
      });
      return;
    }
    if (event.key === "Enter" && isOpen) {
      const option = filteredOptions[highlightedIndex];
      if (option) {
        event.preventDefault();
        selectOption(option);
      }
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setQuery(value);
      return;
    }
    if (event.key === "Tab") setIsOpen(false);
  };

  const activeOption = isOpen ? filteredOptions[highlightedIndex] : undefined;

  return (
    <div
      className="exercise-combobox"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && previewOpen) {
          event.stopPropagation();
          setPreviewOpen(false);
        }
      }}
    >
      <div className={`exercise-combobox-input ${isOpen ? "is-open" : ""}`}>
        {selectedOption?.thumbnailUrl ? (
          <img
            className="exercise-combobox-input-thumbnail"
            src={selectedOption.thumbnailUrl}
            alt=""
            decoding="async"
            onError={(event) => { event.currentTarget.hidden = true; }}
          />
        ) : <Search size={15} aria-hidden="true" />}
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-activedescendant={activeOption ? `${id}-option-${activeOption.id}` : undefined}
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onFocus={open}
          onClick={open}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            const name = event.target.value;
            setQuery(name);
            setHighlightedIndex(0);
            setIsOpen(true);
            onChange({ name });
          }}
        />
        {activePreviewMedia?.videoUrl ? (
          <button
            className="exercise-combobox-preview-trigger"
            type="button"
            aria-label={previewOpen ? "Close movement preview" : `Preview ${selectedOption?.label ?? "exercise"}`}
            aria-expanded={previewOpen}
            onClick={() => {
              setIsOpen(false);
              setPreviewOpen((current) => !current);
            }}
          >
            <Play size={15} aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="exercise-combobox-toggle"
          type="button"
          aria-label={isOpen ? "Close exercise suggestions" : "Show exercise suggestions"}
          aria-expanded={isOpen}
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
            } else {
              setPreviewOpen(false);
              setQuery(value);
              setIsOpen(true);
              inputRef.current?.focus();
            }
          }}
        >
          <ChevronDown className={isOpen ? "is-open" : ""} size={16} aria-hidden="true" />
        </button>
      </div>

      {isOpen ? (
        <div className="exercise-combobox-menu">
          <div id={listboxId} role="listbox" aria-label={`${label} suggestions`}>
            {loading ? (
              <p className="exercise-combobox-state" role="status">Loading COROS exercises...</p>
            ) : filteredOptions.length === 0 ? (
              <p className="exercise-combobox-state">No matching exercises.</p>
            ) : filteredOptions.map((option, index) => {
              const isSelected = option.id === selectedId;
              const isActive = index === highlightedIndex;
              return (
                <button
                  type="button"
                  id={`${id}-option-${option.id}`}
                  key={option.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`.trim()}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span className="exercise-combobox-option-main">
                    {option.thumbnailUrl ? (
                      <img
                        src={option.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(event) => { event.currentTarget.hidden = true; }}
                      />
                    ) : null}
                    <span>{option.label}</span>
                  </span>
                  {isSelected ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {previewOpen && activePreviewMedia?.videoUrl ? (
        <div className="exercise-combobox-preview" role="dialog" aria-label={`${selectedOption?.label ?? "Exercise"} movement preview`}>
          <div className="exercise-combobox-preview-header">
            <div className="exercise-combobox-preview-title">
              <strong>{selectedOption?.label}</strong>
              <span>Official COROS movement preview</span>
            </div>
            <div className="exercise-combobox-preview-actions">
              {previewMedia.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Previous movement angle"
                    onClick={() => setPreviewMediaIndex((current) => (current - 1 + previewMedia.length) % previewMedia.length)}
                  >
                    <ChevronLeft size={14} aria-hidden="true" />
                  </button>
                  <span>{previewMediaIndex + 1} / {previewMedia.length}</span>
                  <button
                    type="button"
                    aria-label="Next movement angle"
                    onClick={() => setPreviewMediaIndex((current) => (current + 1) % previewMedia.length)}
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              <button type="button" aria-label="Close movement preview" onClick={() => setPreviewOpen(false)}>
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
          <video
            key={activePreviewMedia.videoUrl}
            src={activePreviewMedia.videoUrl}
            poster={activePreviewMedia.coverUrl ?? selectedOption?.thumbnailUrl}
            controls
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-label={`${selectedOption?.label ?? "Exercise"} demonstration`}
          />
        </div>
      ) : null}
    </div>
  );
}
