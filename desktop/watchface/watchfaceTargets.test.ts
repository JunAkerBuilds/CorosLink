import { describe, expect, it } from "vitest";
import { assertFirmwareResolutionCompatibility } from "./archive/build";
import { fallbackBytesForModel, getWatchfaceDeviceProfile, getWatchfaceDeviceProfileByFirmware, resolveWatchModel } from "./watchModels";
import { getWatchfaceTarget, watchfaceTargetHardware } from "./watchfaceTargets";

describe("VERTIX 4 (W706)", () => {
  it("is a 466 px AMOLED target known by model and firmware type", () => {
    const target = getWatchfaceTarget("vertix-4");
    expect(target).toMatchObject({ label: "VERTIX 4", display: "amoled", previewSize: 466, sizes: [466, 800] });
    expect(getWatchfaceTarget("COROS W706")?.model).toBe("vertix-4");
    expect(target && watchfaceTargetHardware(target)).toBe("W706");
  });

  it("is read from its watch and drive names, not as an older VERTIX", () => {
    for (const name of ["COROS VERTIX 4", "VERTIX 4", "VERTIX4", "COROS_VERTIX_4"]) expect(resolveWatchModel(name)).toBe("vertix-4");
    expect(resolveWatchModel("COROS VERTIX 2S")).toBe("vertix-2s");
    expect(resolveWatchModel("COROS VERTIX")).toBe("vertix");
  });

  it("has a device profile and 64 GB fallback", () => {
    expect(getWatchfaceDeviceProfile("vertix-4")).toEqual({ firmwareType: "COROS W706" });
    expect(getWatchfaceDeviceProfileByFirmware("coros w706")).toEqual({ firmwareType: "COROS W706" });
    expect(fallbackBytesForModel("vertix-4")).toBe(64 * 1024 * 1024 * 1024);
  });

  it("needs the 466 and 800 layouts", () => {
    expect(() => assertFirmwareResolutionCompatibility(["watchface_466x466", "watchface_800x800"], "COROS W706")).not.toThrow();
    expect(() => assertFirmwareResolutionCompatibility(["watchface_416x416", "watchface_800x800"], undefined, "vertix-4")).toThrow(/VERTIX 4/);
  });
});
