import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeSimulationScenario, advanceSimulationDateTime, createWatchfaceSimulation, type WatchfaceSimulation } from "./watchfaceSimulation";

export function useWatchfaceSimulation() {
  const [simulation, setSimulation] = useState(createWatchfaceSimulation);
  const simulationRef = useRef(simulation);
  const anchor = useRef({ at: performance.now(), dateTime: simulation.dateTime });
  const updateSimulation = useCallback((next: WatchfaceSimulation) => {
    anchor.current = { at: performance.now(), dateTime: next.dateTime };
    simulationRef.current = next;
    setSimulation(next);
  }, []);
  useEffect(() => {
    if (!simulation.enabled || !simulation.playing) return;
    // One render per second; elapsed time drives the clock even when a render
    // takes longer. The editor already coalesces pending canvas renders.
    const timer = window.setInterval(() => {
      const current = simulationRef.current;
      if (!current.enabled || !current.playing) return;
      const dateTime = advanceSimulationDateTime(anchor.current.dateTime, Math.floor((performance.now() - anchor.current.at) / 1000 * current.speed));
      const next = { ...current, dateTime, playing: dateTime !== "9999-12-31T23:59:59" };
      simulationRef.current = next;
      setSimulation(next);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [simulation.enabled, simulation.playing, simulation.speed]);
  const simulationScenario = useMemo(() => activeSimulationScenario(simulation), [simulation]);
  return { simulation, simulationRef, updateSimulation, simulationScenario };
}
