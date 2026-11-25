// Maps' icons: 24 × 24 stroke paths in currentColor. Fixed strings only.
const P: Record<string, string> = {
  map: "M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20",
  watch: "M8 6V3h8v3M8 18v3h8v-3M6 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM12 9.5V12l1.5 1.5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  wifi: "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  usb: "M12 3v14M12 3 9.5 6h5zM8 9v3l4 2.5M16 8v2.5L12 13M12 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  refresh: "M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  layers: "M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  locate: "M12 2v3M12 19v3M2 12h3M19 12h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  pin: "M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  scribble: "M3 17c3-6 5-10 7-10s-2 10 1 10 4-7 6-7 1 5 4 5",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  loop: "M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4",
  outBack: "M4 9h14l-3-3M20 15H6l3 3",
  reverse: "M7 4v16M7 20l-3-3M7 4 4 7M17 20V4M17 4l3 3M17 20l3-3",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  share: "M8 12h8M12 8l4 4-4 4M4 4h16v16H4z",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  chevL: "M15 5l-7 7 7 7",
  chevR: "M9 5l7 7-7 7",
  chevD: "M6 9l6 6 6-6",
  run: "M13 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM6 20l3.5-5 3 2V21M9.5 15l1-5 3.5 2.5 3 .5M10.5 10l-3 1.5L6 14",
  walk: "M12 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM9 21l2-6 3 3v3M11 15l1-6 3 3h3M12 9l-3 2v3",
  hike: "M12 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM8 21l3-7 3 2.5V21M11 14l1-5 3 2.5M19 10v11M12 9l-3 2.5",
  bike: "M5.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5.5 14.5 9 8h6l3.5 6.5M9 8l3 6.5h-6.5M14 5h2.5L18.5 14.5",
  mtb: "M5.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18.5 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5.5 14.5 9 8h6l3.5 6.5M9 8l3 6.5h-6.5M3 21l4-3 3 2 4-3 3 2 4-3",
  mountain: "M3 20 9.5 8l4 7 2.5-4L21 20z",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  circle: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  square: "M5 5h14v14H5z",
  triangle: "M12 4l9 16H3z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  cloud: "M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z",
  hdd: "M3 13h18v6H3zM3 13l3-8h12l3 8M17 16h.01",
  warn: "M12 3 2 20h20zM12 10v4M12 17h.01",
  battery: "M3 7h16v10H3zM22 10.5v3",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
};

export type MapsIconName = keyof typeof P;

export function MapsIcon({ name, size = 18, width = 1.9 }: { name: MapsIconName | string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ""} />
    </svg>
  );
}

export const MAP_ICON_PATH = P.map;
