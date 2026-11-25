// Measures a chart readout's artwork on the page, for making it fixed (studioCharts.ts fixChartReadout): the icon and
// digit image sizes, and where the digits' ink sits in its frame. CorosLink's measureDigitInk, as it is there.
import { loadStudioImage } from "../watchface/engine/watchfaceStudio";
import { chartReadoutOf, type ChartReadoutArt } from "./studioCharts";
import type { Design } from "./studioFace";

/** The digits' ink height and baseline as fractions of the tallest frame; null when nothing is drawn. */
async function measureDigitInk(urls: string[]): Promise<{ height: number; baseline: number } | null> {
  let top = Infinity, bottom = -Infinity, frame = 0;
  for (const url of urls) {
    const image = await loadStudioImage(url).catch(() => null);
    if (!image?.naturalHeight) continue;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    frame = Math.max(frame, canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3]! > 32) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
    }
  }
  return frame && bottom > top ? { height: (bottom - top) / frame, baseline: bottom / frame } : null;
}

export async function measureChartReadoutArt(design: Design, source: string): Promise<ChartReadoutArt> {
  const readout = chartReadoutOf(design, source);
  const art: ChartReadoutArt = { spriteId: window.crypto.randomUUID() };
  const iconUrl = readout?.assets?.icon?.["0"], digitUrl = readout?.assets?.digits?.["0"];
  const icon = iconUrl ? await loadStudioImage(iconUrl).catch(() => null) : null;
  if (icon) art.icon = { width: icon.naturalWidth, height: icon.naturalHeight };
  const digit = digitUrl ? await loadStudioImage(digitUrl).catch(() => null) : null;
  if (digit) { art.digit = { width: digit.naturalWidth, height: digit.naturalHeight }; art.ink = await measureDigitInk(Object.values(readout?.assets?.digits ?? {})); }
  return art;
}
