import type { FieldKind } from "./fields";

/**
 * CorosLink-only config keys: header records official faces use but COROS's
 * 4.9.9 parser has no key for (it ignores these). Same shape as FIELDS:
 * [kind, header offset, gates, format version].
 *
 * WFChartInfo.heart_rate at 0xf86 is a chart readout (position, icon, rect,
 * font) like chart_step's at 0xf6c. Official NOMAD puts it in the right slot
 * of the second daily-data page and shares the readout font.
 */
export const STUDIO_FIELDS: Readonly<Record<string, readonly [FieldKind, number, readonly string[], number]>> = {
  chart_heart_rate_icon_pos: ["pos", 0xf86, ["chart_heart_rate_icon"], 2],
  chart_heart_rate_icon: ["icon", 0xf8e, ["chart_heart_rate_icon_pos"], 2],
  chart_heart_rate_rect: ["rect", 0xf92, ["chart_heart_rate_font"], 2],
  chart_heart_rate_font: ["frames", 0xf9c, ["chart_heart_rate_rect"], 2]
};

/**
 * Where each Studio image key joins WRITE_ORDER: after the named key. In
 * official NOMAD the heart-rate icon block follows the step readout's.
 */
export const STUDIO_WRITE_AFTER: Readonly<Record<string, readonly string[]>> = {
  chart_step_font: ["chart_heart_rate_icon", "chart_heart_rate_font"]
};
