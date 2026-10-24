import type { FieldKind } from "./fields";

/**
 * Activity totals in the order the firmware keeps their decimal points:
 * one pointer per WFMetricValue at 0x1202 + 4 × index.
 */
const TOTALS = ["today_run", "today_swim", "today_bike", "today_elev", "week_run", "week_swim", "week_bike", "week_elev"] as const;
/** Elevation reads hundredths of a metre or foot with a point, so it gets none. */
const DECIMAL_TOTALS = TOTALS.filter(total => !total.endsWith("_elev"));

/**
 * CorosLink-only config keys: header records official faces use but COROS's
 * 4.9.9 parser has no key for (it ignores these). Same shape as FIELDS:
 * [kind, header offset, gates, format version].
 *
 * WFChartInfo.heart_rate at 0xf86 is a chart readout (position, icon, rect,
 * font) like chart_step's at 0xf6c. Official NOMAD puts it in the right slot
 * of the second daily-data page and shares the readout font.
 *
 * `*_point_icon` is an activity total's decimal point, past the end of the
 * 0x1202 header COROS writes. PACE Pro 3.2008.0 loads a 0x1222-byte header
 * and zeroes what a face's declared size leaves out (0x454428). Its totals
 * formatter (0x453388) draws a total with that point as value / 100, point,
 * two digits, and without it rounds to (value + 50) / 100. The value is in
 * hundredths of a km or mile, or of a yard for imperial swims, so a metric
 * 750 m swim reads 1 without the point and 0.75 with it (issue #153).
 */
export const STUDIO_FIELDS: Readonly<Record<string, readonly [FieldKind, number, readonly string[], number]>> = {
  chart_heart_rate_icon_pos: ["pos", 0xf86, ["chart_heart_rate_icon"], 2],
  chart_heart_rate_icon: ["icon", 0xf8e, ["chart_heart_rate_icon_pos"], 2],
  chart_heart_rate_rect: ["rect", 0xf92, ["chart_heart_rate_font"], 2],
  chart_heart_rate_font: ["frames", 0xf9c, ["chart_heart_rate_rect"], 2],
  ...Object.fromEntries(DECIMAL_TOTALS.map(total => [`${total}_point_icon`, ["icon", 0x1202 + 4 * TOTALS.indexOf(total), [`${total}_icon_pos`], 4] as const]))
};

/**
 * Where each Studio image key joins WRITE_ORDER: after the named key. In
 * official NOMAD the heart-rate icon block follows the step readout's.
 */
export const STUDIO_WRITE_AFTER: Readonly<Record<string, readonly string[]>> = {
  chart_step_font: ["chart_heart_rate_icon", "chart_heart_rate_font"],
  ...Object.fromEntries(DECIMAL_TOTALS.map(total => [`${total}_unit_icon`, [`${total}_point_icon`]]))
};
