import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { UnitSystem } from "../../electron/types";
import { readStoredUnitSystem, storeUnitSystem } from "./units";

interface UnitSystemContextValue {
  unitSystem: UnitSystem;
  setUnitSystem: (unitSystem: UnitSystem) => void;
}

const UnitSystemContext = createContext<UnitSystemContextValue | null>(null);

export function UnitSystemProvider({ children }: { children: ReactNode }) {
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(readStoredUnitSystem);

  useEffect(() => {
    storeUnitSystem(unitSystem);
  }, [unitSystem]);

  const setUnitSystem = useCallback((next: UnitSystem) => {
    setUnitSystemState(next);
  }, []);

  const value = useMemo(
    () => ({ unitSystem, setUnitSystem }),
    [setUnitSystem, unitSystem]
  );

  return (
    <UnitSystemContext.Provider value={value}>
      {children}
    </UnitSystemContext.Provider>
  );
}

export function useUnitSystem(): UnitSystemContextValue {
  const value = useContext(UnitSystemContext);
  if (!value) {
    throw new Error("useUnitSystem must be used within UnitSystemProvider");
  }
  return value;
}
