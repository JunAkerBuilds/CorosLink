// The fixed Exercise metric's colon (parts/StudioExerciseSeparator.tsx), as a design edit.
import type { CorosWatchfaceExerciseSeparatorStyle, CorosWatchfaceTemplateDetails } from "../watchface/types";
import { inferExerciseSeparatorStyle } from "../watchface/engine/watchfaceStudio";
import type { Design } from "./studioFace";

/** Changes the separator, starting from the template's colon when the face has none yet. */
export function setExerciseSeparator(design: Design, details: CorosWatchfaceTemplateDetails, patch: Partial<CorosWatchfaceExerciseSeparatorStyle>): Design {
  const current = design.exerciseSeparator ?? inferExerciseSeparatorStyle(details, design.metricStyles?.exercise?.color ?? design.digitColor);
  return { ...design, exerciseSeparator: { ...current, ...patch } };
}
