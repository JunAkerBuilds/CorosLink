import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
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
  details?: ReactNode;
  onChange: (selection: ExerciseComboboxSelection) => void;
}

interface LabeledExerciseOption extends WorkoutExerciseOption {
  label: string;
}

interface ExerciseMenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
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
  details,
  onChange
}: ExerciseComboboxProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputShellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);
  const [previewMediaIndex, setPreviewMediaIndex] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<ExerciseMenuPosition>();
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
    setPreviewMediaIndex(0);
    setPreviewStatus("loading");
  }, [selectedId]);

  useEffect(() => {
    setPreviewStatus("loading");
  }, [activePreviewMedia?.videoUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setMenuPosition(undefined);
      return;
    }
    const updateMenuPosition = () => {
      const rect = inputShellRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const viewportPadding = 12;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      setMenuPosition({
        left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding)),
        width: Math.min(rect.width, window.innerWidth - viewportPadding * 2),
        maxHeight: Math.max(140, Math.min(300, (placeAbove ? spaceAbove : spaceBelow) - gap)),
        ...(placeAbove
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap })
      });
    };
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen]);

  const selectOption = (option: LabeledExerciseOption) => {
    setQuery(option.label);
    setIsOpen(false);
    onChange({
      name: option.label,
      id: option.id,
      exerciseKind: option.exerciseKind
    });
  };

  const open = () => {
    if (!disabled) {
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
      className={`exercise-combobox ${activePreviewMedia?.videoUrl ? "has-inline-video" : ""}`}
      ref={rootRef}
    >
      <div className="exercise-combobox-picker">
        <div ref={inputShellRef} className={`exercise-combobox-input ${isOpen ? "is-open" : ""}`}>
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
                setQuery(value);
                setIsOpen(true);
                inputRef.current?.focus();
              }
            }}
          >
            <ChevronDown className={isOpen ? "is-open" : ""} size={16} aria-hidden="true" />
          </button>
        </div>

        {isOpen && menuPosition ? createPortal(
          <div
            ref={menuRef}
            className="exercise-combobox-menu is-portal"
            style={menuPosition}
          >
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
          </div>,
          document.body
        ) : null}

        {details ? <div className="exercise-combobox-details">{details}</div> : null}
      </div>

      {activePreviewMedia?.videoUrl ? (
        <section className="exercise-inline-video" aria-label={`${selectedOption?.label ?? "Exercise"} movement demonstration`}>
          <header className="exercise-inline-video-header">
            <div>
              <strong>{selectedOption?.label}</strong>
              <span>Movement demonstration</span>
            </div>
            {previewMedia.length > 1 ? (
              <div className="exercise-inline-video-actions">
                <button
                  type="button"
                  aria-label="Previous movement angle"
                  onClick={() => setPreviewMediaIndex((current) => (current - 1 + previewMedia.length) % previewMedia.length)}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <span>{previewMediaIndex + 1} / {previewMedia.length}</span>
                <button
                  type="button"
                  aria-label="Next movement angle"
                  onClick={() => setPreviewMediaIndex((current) => (current + 1) % previewMedia.length)}
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </header>
          <div className="exercise-inline-video-stage">
            {previewStatus === "loading" ? (
              <div className="exercise-inline-video-loading" role="status">
                <span aria-hidden="true" />
                <strong>Loading movement</strong>
              </div>
            ) : null}
            {previewStatus === "error" ? (
              <div className="exercise-inline-video-error" role="alert">
                <AlertCircle size={21} aria-hidden="true" />
                <strong>Video unavailable</strong>
                <span>Try another angle.</span>
              </div>
            ) : null}
            <video
              key={activePreviewMedia.videoUrl}
              className={previewStatus === "ready" ? "is-ready" : ""}
              src={activePreviewMedia.videoUrl}
              poster={activePreviewMedia.coverUrl ?? selectedOption?.thumbnailUrl}
              controls
              autoPlay={!reducedMotion}
              muted
              loop={!reducedMotion}
              playsInline
              preload="metadata"
              onLoadedData={() => setPreviewStatus("ready")}
              onError={() => setPreviewStatus("error")}
              aria-label={`${selectedOption?.label ?? "Exercise"} demonstration`}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
