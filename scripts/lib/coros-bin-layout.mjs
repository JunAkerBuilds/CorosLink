// The CLI and packaged app share the same decoder. Node 22.18+ strips TS types.
export { hex, readLayoutHeaders, decodeCorosLayout, chartConfigValues, expandChartColor, formatConfigPos, formatConfigRect, parseCorosFaceMagic, findCorosBitmapBlocks, decodeCorosBitmapFrame } from "../../electron/corosBinLayout.ts";
