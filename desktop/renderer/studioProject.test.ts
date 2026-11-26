import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import {
  archiveOverrideProblem, configEdited, configFilesOf, configTextOf, editedDirectories, setArchiveOverride, setConfigText, templateWatchfaceId,
} from "./studioProject";

const baselines = { "466/config.txt": "[a]=1\n", "466/AODconfig.txt": "[b]=2\n", "416/config.txt": "[c]=3\n" };
const details = {
  resolutions: [
    { directory: "466", width: 466, height: 466, config: { watchface_id: "0x00000010" }, aodConfig: { watchface_id: "0x3B9ACE60" } },
    { directory: "416", width: 416, height: 416, config: {}, aodConfig: {} },
  ],
} as unknown as CorosWatchfaceTemplateDetails;

describe("config files", () => {
  it("lists each size with the files it ships", () => {
    expect(configFilesOf(details, baselines)).toEqual([
      { directory: "466", label: "466 × 466", current: "466/config.txt", aod: "466/AODconfig.txt" },
      { directory: "416", label: "416 × 416", current: "416/config.txt" },
    ]);
  });

  it("keeps an edit, and drops it when the text is the template's again", () => {
    const design = makeDefaultDesign();
    const edited = setConfigText(design, baselines, "466/config.txt", "[a]=9\n");
    expect(configTextOf(edited, baselines, "466/config.txt")).toBe("[a]=9\n");
    expect(configEdited(edited, baselines, "466/config.txt")).toBe(true);
    expect([...editedDirectories(edited, baselines)]).toEqual(["466"]);
    const reset = setConfigText(edited, baselines, "466/config.txt", "[a]=1\n");
    expect(reset.configTextEdits).toBeUndefined();
    expect(setConfigText(design, baselines, "466/config.txt", "[a]=1\n")).toBe(design);
  });
});

describe("archive identity", () => {
  it("checks values as the archive builder does", () => {
    expect(archiveOverrideProblem("templateId", "")).toBeNull();
    expect(archiveOverrideProblem("templateId", "429496729612345")).toBeNull();
    expect(archiveOverrideProblem("templateId", "000")).not.toBeNull();
    expect(archiveOverrideProblem("templateId", "12a")).not.toBeNull();
    expect(archiveOverrideProblem("watchfaceId", "0x3b9ace60")).toBeNull();
    expect(archiveOverrideProblem("watchfaceId", "54")).toBeNull();
    expect(archiveOverrideProblem("watchfaceId", "4294967296")).not.toBeNull();
    expect(archiveOverrideProblem("watchfaceId", "0x123456789")).not.toBeNull();
    expect(archiveOverrideProblem("templateName", "x".repeat(65))).not.toBeNull();
  });

  it("sets and clears one override at a time", () => {
    const design = makeDefaultDesign();
    const one = setArchiveOverride(design, "templateId", " 123 ");
    expect(one.archiveOverrides).toEqual({ templateId: "123" });
    const two = setArchiveOverride(one, "templateName", "TOP PART");
    expect(two.archiveOverrides).toEqual({ templateId: "123", templateName: "TOP PART" });
    expect(setArchiveOverride(setArchiveOverride(two, "templateId", ""), "templateName", "").archiveOverrides).toBeUndefined();
    expect(setArchiveOverride(two, "templateId", "123")).toBe(two);
  });

  it("offers the template's watch-face ID, always-on first", () => {
    expect(templateWatchfaceId(details)).toBe("0x3B9ACE60");
  });
});
