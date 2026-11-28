// The icons Studio draws for selectable-slot types the template has no picture for (heart rate, steps, sunrise …).
// Plain line drawings in one colour, the same weight as Studio's barometer gauge, so a slot full of them reads as a
// set. They're only defaults: the designer can replace any with a PNG or hide it and leave the value alone.

/** The slot types Studio has an icon for, by the type's config prefix (control_<prefix>_icon). */
export const STUDIO_CONTROL_ICON_PREFIXES = [
  "hr", "step", "kcal", "floor", "elevation", "exercise", "sunrise", "sunset", "temperature",
] as const;
export type StudioControlIconPrefix = (typeof STUDIO_CONTROL_ICON_PREFIXES)[number];

/** Where Studio puts a type's icon in the face's files. */
export const studioControlIconRelativePath = (prefix: string) => `icon/coroslink_control_${prefix}.png`;

/** The type a Studio icon path belongs to, or null for any other path. */
export function studioControlIconPrefix(relativePath: string): StudioControlIconPrefix | null {
  const match = relativePath.match(/^icon\/coroslink_control_([a-z]+)\.png$/);
  return match && (STUDIO_CONTROL_ICON_PREFIXES as readonly string[]).includes(match[1]!)
    ? (match[1] as StudioControlIconPrefix)
    : null;
}

/** Draws a type's icon on a width × height canvas, as a PNG data URL. */
export function renderStudioControlIcon(prefix: StudioControlIconPrefix, width: number, height: number, color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const c = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!c) return canvas.toDataURL("image/png");
  // Drawn in a 24-unit square centred on the canvas.
  const unit = Math.min(canvas.width, canvas.height) / 24;
  c.translate((canvas.width - unit * 24) / 2, (canvas.height - unit * 24) / 2);
  c.scale(unit, unit);
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 2;
  c.lineCap = "round";
  c.lineJoin = "round";
  const line = (...points: [number, number][]) => {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  };
  const sun = (arrowUp: boolean) => {
    // Half a sun on the horizon, its rays, and an arrow for rising or setting.
    c.beginPath();
    c.arc(12, 16, 4.5, Math.PI, 0);
    c.stroke();
    line([2, 16.5], [22, 16.5]);
    line([4.5, 12.5], [6, 13.5]);
    line([19.5, 12.5], [18, 13.5]);
    line([12, 7.5], [12, 9]);
    if (arrowUp) line([9.5, 5], [12, 2.5], [14.5, 5]);
    else line([9.5, 2.5], [12, 5], [14.5, 2.5]);
    line([7, 20.5], [17, 20.5]);
  };
  switch (prefix) {
    case "hr":
      c.beginPath();
      c.moveTo(12, 20);
      c.bezierCurveTo(4, 14.5, 2.5, 10.5, 2.5, 8);
      c.bezierCurveTo(2.5, 5, 5, 3.5, 7.2, 3.5);
      c.bezierCurveTo(9.3, 3.5, 11, 4.8, 12, 6.5);
      c.bezierCurveTo(13, 4.8, 14.7, 3.5, 16.8, 3.5);
      c.bezierCurveTo(19, 3.5, 21.5, 5, 21.5, 8);
      c.bezierCurveTo(21.5, 10.5, 20, 14.5, 12, 20);
      c.stroke();
      break;
    case "step":
      for (const [x, y] of [[8, 9], [16, 14]] as const) {
        c.beginPath();
        c.ellipse(x, y, 2.6, 4.2, 0, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.ellipse(x, y + 6.3, 2, 1.4, 0, 0, Math.PI * 2);
        c.fill();
      }
      break;
    case "kcal":
      c.beginPath();
      c.moveTo(12, 2.5);
      c.bezierCurveTo(13, 7, 18.5, 9, 18.5, 14.5);
      c.bezierCurveTo(18.5, 18.5, 15.5, 21.5, 12, 21.5);
      c.bezierCurveTo(8.5, 21.5, 5.5, 18.5, 5.5, 14.5);
      c.bezierCurveTo(5.5, 11.5, 7.5, 9.5, 8.5, 8.5);
      c.bezierCurveTo(8.7, 10.5, 9.5, 11.5, 10.5, 12);
      c.bezierCurveTo(10.5, 8, 11, 5, 12, 2.5);
      c.stroke();
      break;
    case "floor":
      line([3, 20.5], [3, 16.5], [8, 16.5], [8, 12.5], [13, 12.5], [13, 8.5], [18, 8.5], [18, 4.5], [21, 4.5]);
      line([3, 20.5], [21, 20.5]);
      break;
    case "elevation":
      line([2, 20], [9, 7], [13.5, 14], [16, 10.5], [22, 20], [2, 20]);
      line([7.2, 10.5], [9, 12], [10.8, 10.5]);
      break;
    case "exercise":
      c.beginPath();
      c.arc(12, 13.5, 7.5, 0, Math.PI * 2);
      c.stroke();
      line([10, 2.5], [14, 2.5]);
      line([12, 2.5], [12, 6]);
      line([18.2, 6.5], [19.6, 5.1]);
      line([12, 13.5], [12, 9.5]);
      line([12, 13.5], [14.8, 15.5]);
      break;
    case "sunrise":
      sun(true);
      break;
    case "sunset":
      sun(false);
      break;
    case "temperature":
      c.beginPath();
      c.moveTo(10, 14);
      c.lineTo(10, 4.5);
      c.arc(12, 4.5, 2, Math.PI, 0);
      c.lineTo(14, 14);
      c.arc(12, 17.5, 4, -Math.PI * 0.27, Math.PI * 1.27);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.arc(12, 17.5, 1.8, 0, Math.PI * 2);
      c.fill();
      line([12, 15.5], [12, 9]);
      break;
  }
  return canvas.toDataURL("image/png");
}
