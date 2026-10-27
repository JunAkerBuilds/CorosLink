import { createContext, useContext, type ReactNode } from "react";

/**
 * False while App keeps Training Hub mounted behind another view. Only leaf
 * components read it, so parking and returning never re-render the dashboard
 * (a re-render replays every chart's entrance animation).
 */
export const TrainingHubActiveContext = createContext(true);

export function useTrainingHubActive(): boolean {
  return useContext(TrainingHubActiveContext);
}

/** Renders its children only while the hub is on screen. */
export function WhileTrainingHubActive({ children }: { children: ReactNode }) {
  return useTrainingHubActive() ? children : null;
}
