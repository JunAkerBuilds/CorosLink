import { describe, expect, it } from "vitest";
import { exerciseColonFace, exerciseColonSize, makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import type { CorosWatchfaceResolutionDetails, CorosWatchfaceTemplateDetails } from "../watchface/types";
import { buildControlComplicationConfigurationOverrides, buildSelectableMetricStyleOverrides, configAssetCanvasSize, placeConfigRectGroup, scaleConfigRectGroup, slotTypeIconSize } from "../watchface/engine/watchfaceStudio";
import { setFontSize } from "./studioEdits";
import type { EditorLayer } from "./studioFace";
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

describe("exercise font size", () => {
  const resolution = {
    directory: "800", width: 800, height: 800, aodConfig: {}, files: [],
    config: { exercise_font: "digits", exercise_hour_rect: "{300,600,360,680,0}", exercise_minute_rect: "{440,600,500,680,0}" },
    spriteFolders: [{ folder: "digits", kind: "digits", files: Array.from({ length: 10 }, (_, i) => ({ path: `800/digits/0${i}.png`, width: 30, height: 80 })) }],
  } as unknown as CorosWatchfaceResolutionDetails;
  const layer = { id: "exercise", kind: "metric", metricId: "exercise" } as unknown as EditorLayer;

  it("grows the hour and minute boxes around their shared center, gap included", () => {
    const [hour, minute] = scaleConfigRectGroup([resolution.config.exercise_hour_rect!, resolution.config.exercise_minute_rect!], { x: 2, y: 2 });
    // Spanning 300–500 around 400 before; 200–600 after, the 80 px gap now 160.
    expect(hour).toBe("{200,560,320,720,0}");
    expect(minute).toBe("{480,560,600,720,0}");
    // Half the size pulls them in rather than leaving them far apart.
    expect(scaleConfigRectGroup([resolution.config.exercise_hour_rect!, resolution.config.exercise_minute_rect!], { x: 0.5, y: 0.5 }))
      .toEqual(["{350,620,380,660,0}", "{420,620,450,660,0}"]);
  });

  it("keeps the colon in the gap as the digits resize", () => {
    const base = makeDefaultDesign();
    const design = {
      ...base,
      metricStyles: { exercise: { scale: 1, fontSize: 80 } },
      exerciseSeparator: { enabled: true, x: 400, y: 640, size: 80, scale: 1, color: "#ffffff", artwork: null },
      layoutOffsets: { exercise: { dx: 10, dy: -300 } },
    };
    // The boxes as drawn are moved with the layer.
    const moved = { ...resolution, config: { ...resolution.config, exercise_hour_rect: "{310,300,370,380,0}", exercise_minute_rect: "{450,300,510,380,0}" } };
    const bigger = setFontSize(design, layer, 120, moved);
    expect(bigger.metricStyles?.exercise?.fontSize).toBe(120);
    expect(bigger.exerciseSeparator).toMatchObject({ x: 400, y: 640 });
    const offCenter = setFontSize({ ...design, exerciseSeparator: { ...design.exerciseSeparator, x: 420 } }, layer, 40, moved);
    expect(offCenter.exerciseSeparator).toMatchObject({ x: 410, y: 640 });
  });
});

describe("exercise colon size", () => {
  const colon = { size: 142, scale: 1 };
  it("is the digits' font size", () => {
    expect(exerciseColonSize({ metricStyles: { exercise: { scale: 1, fontSize: 87 } } }, colon)).toBe(87);
  });
  it("follows the template digits' scale without a font size", () => {
    expect(exerciseColonSize({ metricStyles: { exercise: { scale: 1.5 } } }, { size: 40, scale: 1 })).toBe(60);
    expect(exerciseColonSize({ metricStyles: {} }, { size: 40, scale: 1 })).toBe(40);
  });
});

describe("exercise colon face", () => {
  it("takes the digits' weight and style, else the face's", () => {
    expect(exerciseColonFace({ metricStyles: { exercise: { scale: 1, fontWeight: 300, fontStyle: "italic" } }, fontWeight: 800 }))
      .toEqual({ fontWeight: 300, fontStyle: "italic" });
    expect(exerciseColonFace({ metricStyles: {}, fontWeight: 800 })).toEqual({ fontWeight: 800, fontStyle: "normal" });
  });
});

describe("selectable time values", () => {
  it("places rects with new sizes and spreads them from their shared center", () => {
    expect(placeConfigRectGroup(["{300,600,360,680,0}", "{440,600,500,680,0}"], [{ width: 120, height: 160 }, { width: 120, height: 160 }], { x: 2, y: 2 }))
      .toEqual(["{200,560,320,720,0}", "{480,560,600,720,0}"]);
  });

  it("keeps sunrise's hours and minutes apart in step with the digits", () => {
    const details = { resolutions: [{
      directory: "800", width: 800, height: 800, aodConfig: {}, files: [], icons: [],
      config: { rect_control1_pos: "{0,0}", control_sunrise_font: "digits", control_sunrise_hour_rect: "{100,100,140,140,0}", control_sunrise_minute_rect: "{160,100,200,140,0}" },
      spriteFolders: [{ folder: "digits", kind: "digits", files: Array.from({ length: 10 }, (_, i) => ({ path: `800/digits/0${i}.png`, width: 20, height: 40 })) }],
    }] } as unknown as CorosWatchfaceTemplateDetails;
    const [override] = buildSelectableMetricStyleOverrides(details, { scale: 0.5 });
    // Spanning 100–200 around 150: each half as wide, and half as far from 150.
    expect(override?.values.control_sunrise_hour_rect).toBe("{125,110,145,130,0}");
    expect(override?.values.control_sunrise_minute_rect).toBe("{155,110,175,130,0}");
  });
});

describe("selectable times Studio adds", () => {
  const details = { resolutions: [{
    directory: "800", width: 800, height: 800, aodConfig: {}, files: [], icons: [],
    config: { rect_control1_pos: "{200,300}", control_step_rect: "{0,0,120,40,hcenter|vcenter}", control_step_font: "digits" },
    spriteFolders: [{ folder: "digits", kind: "digits", files: Array.from({ length: 10 }, (_, i) => ({ path: `800/digits/0${i}.png`, width: 20, height: 40 })) }],
  }] } as unknown as CorosWatchfaceTemplateDetails;
  const values = (id: "sunrise" | "barometer") =>
    buildControlComplicationConfigurationOverrides(details, { controlComplicationEnabled: { [id]: true } })
      .find((o) => o.path.endsWith("config.txt"))?.values ?? {};

  it("gives a time a colon, and holds its hours and minutes against it", () => {
    const sunrise = values("sunrise");
    expect(sunrise.control_colon_icon).toBe("icon\\coroslink_control_colon.png");
    expect(sunrise.control_sunrise_hour_rect).toMatch(/,right\|vcenter}$/);
    expect(sunrise.control_sunrise_minute_rect).toMatch(/,left\|vcenter}$/);
  });

  it("holds the barometer's whole and decimal parts against the point", () => {
    const barometer = values("barometer");
    expect(barometer.control_barometer_integer_rect).toMatch(/,right\|vcenter}$/);
    expect(barometer.control_barometer_decimal_rect).toMatch(/,left\|vcenter}$/);
    expect(barometer.control_colon_icon).toBeUndefined();
  });
});

describe("a selectable value beside its icon", () => {
  it("grows from the icon's corner, so it never runs over the icon", () => {
    // Icon at x 100 (20 wide); value 130–200. At twice the size the icon reaches 140 and the value starts at 160.
    expect(placeConfigRectGroup(["{130,100,190,140,0}", "{194,100,200,140,0}"], [{ width: 120, height: 80 }, { width: 12, height: 80 }], { x: 2, y: 2 }, { x: 100, y: 100 }))
      .toEqual(["{160,100,280,180,0}", "{288,100,300,180,0}"]);
  });
});

describe("a slot icon's own size", () => {
  it("is set on the type's icon alone, with own size on", () => {
    expect(slotTypeIconSize("control_hr_icon", { nativeSize: true, scale: 1.5 })).toBe(1.5);
    expect(slotTypeIconSize("control_barometer_up_icon", { nativeSize: true, scale: 0.5 })).toBe(0.5);
    // Left at the slot's size, or a picture that isn't a type's icon.
    expect(slotTypeIconSize("control_hr_icon", { scale: 1.5 })).toBe(1);
    expect(slotTypeIconSize("control_colon_icon", { nativeSize: true, scale: 2 })).toBe(1);
  });

  it("resizes the template's own icon picture", () => {
    expect(configAssetCanvasSize("control_sunrise_icon", { nativeSize: true, scale: 2 }, { width: 24, height: 20 }))
      .toEqual({ width: 48, height: 40, native: true });
  });
});
