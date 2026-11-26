import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { setExerciseSeparator } from "./studioExerciseSeparator";

const details = { resolutions: [{ directory: "466", width: 466, height: 466, config: {}, aodConfig: {}, spriteFolders: [], files: [] }] } as unknown as CorosWatchfaceTemplateDetails;

describe("exercise separator", () => {
  it("starts from the template's colon and keeps the face's own after", () => {
    const first = setExerciseSeparator(makeDefaultDesign(), details, { color: "#ff0000" });
    expect(first.exerciseSeparator).toMatchObject({ color: "#ff0000", scale: expect.any(Number), size: expect.any(Number) });
    const second = setExerciseSeparator(first, details, { enabled: false });
    expect(second.exerciseSeparator).toMatchObject({ color: "#ff0000", enabled: false, x: first.exerciseSeparator!.x });
  });
});
