import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { colour, colourChanged, colourOf, oneTemperature, resetColour, setTemperature, setVisible } from "./studioFace";

const withIcon = (temperatureEnabled?: boolean) => ({
  ...makeDefaultDesign(),
  weatherIndicator: { enabled: true, x: 500, y: 300, scale: 1, color: "#ffcc00", temperatureEnabled, assets: {
    digits: Object.fromEntries([...Array(10)].map((_, i) => [String(i), `data:image/png;base64,d${i}`])),
    symbols: { "0": "data:image/png;base64,minus", "1": "data:image/png;base64,deg" },
  } },
});

describe("one temperature", () => {
  it("turns the Temperature layer on beside the icon, never the icon's own copy", () => {
    const on = setTemperature(withIcon(false), true, 800);
    expect(on.weatherIndicator?.temperatureEnabled).toBe(false);
    expect(on.nativeData?.weather_temp).toMatchObject({ enabled: true, x: 510, y: 211, color: "#ffcc00" });
    const off = setTemperature(on, false, 800);
    expect(off.nativeData?.weather_temp?.enabled).toBe(false);
    expect(setTemperature(off, true, 800).nativeData?.weather_temp).toMatchObject({ enabled: true, x: 510, y: 211 });
  });

  it("moves the icon's own reading onto the layer with its pictures", async () => {
    const moved = await oneTemperature(withIcon(), 800);
    expect(moved.weatherIndicator?.temperatureEnabled).toBe(false);
    const t = moved.nativeData?.weather_temp;
    expect(t?.enabled).toBe(true);
    expect(t?.assets?.digits?.["7"]).toBe("data:image/png;base64,d7");
    expect(t?.assets?.symbols).toEqual({ "0": "data:image/png;base64,minus" });
    expect(t?.assets?.unit).toEqual({ "0": "data:image/png;base64,deg", "1": "data:image/png;base64,deg" });
  });

  it("leaves a face whose icon shows no reading alone", async () => {
    const d = withIcon(false);
    expect(await oneTemperature(d, 800)).toBe(d);
  });
});

describe("weather icon onto the face", () => {
  it("brings the temperature with a weather icon that comes onto the face", () => {
    const icon = { id: "weatherIndicator", kind: "weather", label: "Weather icon", weatherIndicator: true, visible: false, canHide: true, present: true, bounds: null, capabilities: { position: true, color: true, scale: true, font: false } } as never;
    const shown = setVisible(withIcon(false), icon, true);
    expect(shown.nativeData?.weather_temp?.enabled).toBe(true);
  });
});

describe("live-data colour", () => {
  const temp = { id: "native:weather_temp", nativeDataId: "weather_temp", kind: "metric", label: "Weather data", visible: true, canHide: true, present: true, bounds: null, capabilities: { position: true, color: true, scale: true, font: true } } as never;
  it("colours the field itself and goes back to white", () => {
    const d = setTemperature(withIcon(false), true, 800);
    const purple = colour({ ...d, nativeData: { ...d.nativeData, weather_temp: { ...d.nativeData!.weather_temp!, color: "#ffffff" } } }, temp, "#a77bff");
    expect(purple.nativeData?.weather_temp?.color).toBe("#a77bff");
    expect(purple.layerColors?.["native:weather_temp"]).toBeUndefined();
    expect(colourOf(purple, temp)).toBe("#a77bff");
    expect(colourChanged(purple, temp)).toBe(true);
    const back = resetColour(purple, temp);
    expect(back.nativeData?.weather_temp?.color).toBe("#ffffff");
    expect(colourChanged(back, temp)).toBe(false);
  });
});
