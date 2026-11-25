import { describe, expect, it } from "vitest";
import { basemapConfig, baseAlpha, lightAt, lookLight, mapStyle, ROUTE_MAP_TYPES, sunAt, takesLighting } from "./routeMap";

describe("sunAt", () => {
  it("puts the equinox noon sun overhead at the equator", () => {
    const sun = sunAt(new Date(Date.UTC(2026, 2, 20, 12, 7)), 0, 0);
    expect(sun.elevation).toBeGreaterThan(88);
  });
  it("knows morning from afternoon by longitude", () => {
    // 12:00 UTC is early morning in Montreal and evening in Tokyo.
    expect(sunAt(new Date(Date.UTC(2026, 5, 21, 12, 0)), 45.5, -73.57).morning).toBe(true);
    expect(sunAt(new Date(Date.UTC(2026, 5, 21, 9, 0)), 35.68, 139.69).morning).toBe(false);
  });
  it("has the midsummer noon sun at 90 - latitude + 23.4 degrees", () => {
    // Solar noon in Montreal on 21 June is about 16:56 UTC.
    const sun = sunAt(new Date(Date.UTC(2026, 5, 21, 16, 56)), 45.5, -73.57);
    expect(sun.elevation).toBeGreaterThan(67.4);
    expect(sun.elevation).toBeLessThan(68.4);
  });
});

describe("lightAt", () => {
  const montreal = [45.5017, -73.5673] as const;
  it("is day at noon and night at midnight", () => {
    expect(lightAt(new Date(Date.UTC(2026, 10, 19, 17, 0)), ...montreal)).toBe("day");
    expect(lightAt(new Date(Date.UTC(2026, 10, 19, 5, 0)), ...montreal)).toBe("night");
  });
  it("is dawn around sunrise and dusk around sunset", () => {
    // Sunrise in Montreal on 19 November is about 11:58 UTC, sunset about 21:20 UTC.
    expect(lightAt(new Date(Date.UTC(2026, 10, 19, 12, 0)), ...montreal)).toBe("dawn");
    expect(lightAt(new Date(Date.UTC(2026, 10, 19, 21, 20)), ...montreal)).toBe("dusk");
  });
});

describe("the map's look", () => {
  it("offers the phone's six types", () => {
    expect(ROUTE_MAP_TYPES.map((t) => t.label)).toEqual(["Standard", "3D city", "Monochrome", "Outdoors", "Satellite", "Hybrid"]);
  });
  it("uses three styles", () => {
    expect(mapStyle("standard")).toBe(mapStyle("city3d"));
    expect(mapStyle("monochrome")).toBe("mapbox://styles/mapbox/standard");
    expect(mapStyle("satellite")).toBe(mapStyle("hybrid"));
    expect(mapStyle("outdoors")).toBe("mapbox://styles/mapbox/outdoors-v12");
  });
  it("lights only the drawn Standard maps by the time of day", () => {
    expect(ROUTE_MAP_TYPES.filter((t) => takesLighting(t.value)).map((t) => t.value)).toEqual(["standard", "city3d", "monochrome"]);
    expect(lookLight({ type: "standard", dark: false, timeOfDay: "dusk" })).toBe("dusk");
    expect(lookLight({ type: "satellite", dark: true, timeOfDay: "dusk" })).toBe("day");
    expect(lookLight({ type: "standard", dark: true, timeOfDay: null })).toBe("night");
    expect(lookLight({ type: "monochrome", dark: false, timeOfDay: null })).toBe("day");
  });
  it("configures each type fully, so switching in place leaves nothing behind", () => {
    expect(basemapConfig({ type: "standard", dark: false, timeOfDay: null })).toEqual({
      theme: "faded", lightPreset: "day", show3dObjects: false, showLandmarkIcons: false, showPointOfInterestLabels: false,
    });
    expect(basemapConfig({ type: "city3d", dark: true, timeOfDay: "dawn" })).toMatchObject({ theme: "default", lightPreset: "dawn", show3dObjects: true });
    expect(basemapConfig({ type: "satellite", dark: true, timeOfDay: null })).toMatchObject({ lightPreset: "day", showRoadsAndTransit: false, showPlaceLabels: false });
    expect(basemapConfig({ type: "hybrid", dark: true, timeOfDay: null })).toMatchObject({ showRoadsAndTransit: true, showRoadLabels: true });
    expect(basemapConfig({ type: "outdoors", dark: true, timeOfDay: null })).toBeNull();
  });
  it("draws the route still to come stronger over imagery", () => {
    expect(baseAlpha("hybrid")).toBeGreaterThan(baseAlpha("standard"));
  });
});
