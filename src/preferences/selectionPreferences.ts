import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

const SELECTION_STORAGE_PREFIX = "coroslink.selection.v1";

export interface SelectionPreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface SelectionPreference<T> {
  key: string;
  defaultValue: T;
  validate: (value: unknown) => value is T;
}

export interface RestoredSelectionPreference<T> {
  value: T;
  restored: boolean;
}

export interface SelectionPreferenceMeta {
  /** True only when the initial value came from a valid persisted entry. */
  restored: boolean;
}

export type SelectionPreferenceState<T> = readonly [
  T,
  Dispatch<SetStateAction<T>>,
  SelectionPreferenceMeta
];

export function defineSelectionPreference<T>(
  preference: SelectionPreference<T>
): SelectionPreference<T> {
  return preference;
}

export function selectionPreferenceStorageKey(key: string): string {
  return `${SELECTION_STORAGE_PREFIX}.${key}`;
}

function browserStorage(): SelectionPreferenceStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSelectionPreference<T>(
  preference: SelectionPreference<T>,
  storage: SelectionPreferenceStorage | undefined = browserStorage(),
  fallback: T = preference.defaultValue
): RestoredSelectionPreference<T> {
  if (!storage) {
    return { value: fallback, restored: false };
  }

  try {
    const raw = storage.getItem(selectionPreferenceStorageKey(preference.key));
    if (raw === null) {
      return { value: fallback, restored: false };
    }
    const parsed: unknown = JSON.parse(raw);
    return preference.validate(parsed)
      ? { value: parsed, restored: true }
      : { value: fallback, restored: false };
  } catch {
    return { value: fallback, restored: false };
  }
}

export function writeSelectionPreference<T>(
  preference: SelectionPreference<T>,
  value: T,
  storage: SelectionPreferenceStorage | undefined = browserStorage()
): void {
  if (!storage || !preference.validate(value)) {
    return;
  }

  try {
    storage.setItem(
      selectionPreferenceStorageKey(preference.key),
      JSON.stringify(value)
    );
  } catch {
    // The renderer remains fully usable when storage is unavailable or full.
  }
}

export function useSelectionPreference<T>(
  preference: SelectionPreference<T>,
  fallback: T = preference.defaultValue
): SelectionPreferenceState<T> {
  const initialRef = useRef<RestoredSelectionPreference<T> | null>(null);
  if (initialRef.current === null) {
    initialRef.current = readSelectionPreference(preference, undefined, fallback);
  }

  const [value, setValueState] = useState<T>(() => initialRef.current!.value);
  const valueRef = useRef(value);
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const current = valueRef.current;
    const next =
      typeof action === "function"
        ? (action as (previous: T) => T)(current)
        : action;
    valueRef.current = next;
    setValueState(next);
    writeSelectionPreference(preferenceRef.current, next);
  }, []);

  return [value, setValue, { restored: initialRef.current.restored }] as const;
}

export function selectionIsOneOf<const T extends readonly unknown[]>(
  values: T
): (value: unknown) => value is T[number] {
  const allowed = new Set<unknown>(values);
  return (value: unknown): value is T[number] => allowed.has(value);
}

export function selectionIsBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function selectionIsArrayOf<T>(
  validateItem: (value: unknown) => value is T,
  options: { minLength?: number; unique?: boolean } = {}
): (value: unknown) => value is T[] {
  return (value: unknown): value is T[] => {
    if (!Array.isArray(value) || value.length < (options.minLength ?? 0)) {
      return false;
    }
    if (!value.every(validateItem)) {
      return false;
    }
    return !options.unique || new Set(value).size === value.length;
  };
}
