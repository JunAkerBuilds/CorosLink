/**
 * The Go to palette's page tiles: a solid coloured tile with a white two-tone glyph (24 × 24 grid, 1.8 stroke). "F" marks
 * the see-through fill, "S" the solid white. A page with no art of its own (a host app's page added later) gets its
 * sidebar icon on a grey tile.
 */

const ART: Record<string, { color: string; art: string }> = {
  "/": { color: "#12b886", art: '<rect x="4" y="4" width="7" height="7" rx="2" fill="F"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2" fill="F"/>' },
  "/calendar": { color: "#2f7cf6", art: '<path d="M3.5 9.5V8a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v1.5z" fill="F" stroke="none"/><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="8" cy="13.5" r="1" fill="S" stroke="none"/><circle cx="12" cy="13.5" r="1" fill="S" stroke="none"/><circle cx="16" cy="13.5" r="1" fill="S" stroke="none"/><circle cx="8" cy="17" r="1" fill="S" stroke="none"/><circle cx="12" cy="17" r="1" fill="S" stroke="none"/>' },
  "/calendar/library": { color: "#14a3a3", art: '<rect x="3.5" y="4" width="4.5" height="16" rx="1.2" fill="F"/><rect x="9.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="15.6" y="4.5" width="4.2" height="15.5" rx="1.2" transform="rotate(-12 17.7 12)"/><path d="M3.5 8h4.5M9.5 8h4.5M3.5 16h4.5M9.5 16h4.5"/>' },
  "/activities": { color: "#d23fcc", art: '<path d="M3 13h3.5l2.5-6.5 4.5 11 2.5-4.5H21"/>' },
  "/health": { color: "#6a5cf2", art: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" fill="F"/><path d="M7.5 12.2h2.2l1.3-2.2 2 4 1.2-1.8h2.3"/>' },
  "/fuel": { color: "#e8a10c", art: '<path d="M12 3.5c.8 3.3 5 5 5 9.8a5 5 0 0 1-10 0c0-2.3 1.2-3.6 2.3-4.6.1 1.8.9 2.9 2 3.1-.3-3 .2-5.6.7-8.3z" fill="F"/><path d="M12 19.6a2.2 2.2 0 0 1-2.2-2.2c0-1.4 1.2-2.3 2.2-3.6 1 1.3 2.2 2.2 2.2 3.6a2.2 2.2 0 0 1-2.2 2.2z" fill="S" stroke="none"/>' },
  "/body": { color: "#1fb89a", art: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="F"/><path d="M7.5 10a5.5 5.5 0 0 1 9 0M12 11l1.6-2.6M9.5 16.5h5"/><circle cx="12" cy="11" r="0.9" fill="S" stroke="none"/>' },
  "/sports": { color: "#2f9bf6", art: '<circle cx="12" cy="13.5" r="7" fill="F"/><path d="M12 13.5V9.8M10 3h4M12 3v3.5M18.2 7.3l1.3-1.3"/><circle cx="12" cy="13.5" r="1.1" fill="S" stroke="none"/>' },
  "/strength": { color: "#e8813c", art: '<rect x="5.5" y="6.5" width="3" height="11" rx="1.2" fill="F"/><rect x="15.5" y="6.5" width="3" height="11" rx="1.2" fill="F"/><rect x="2.5" y="9" width="3" height="6" rx="1"/><rect x="18.5" y="9" width="3" height="6" rx="1"/><path d="M8.5 12h7"/>' },
  "/coach": { color: "#12b886", art: '<path d="M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5h-6.5L7 20.5V17H6a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 6 4.5z" fill="F"/><circle cx="8.5" cy="10.8" r="1.1" fill="S" stroke="none"/><circle cx="12" cy="10.8" r="1.1" fill="S" stroke="none"/><circle cx="15.5" cy="10.8" r="1.1" fill="S" stroke="none"/>' },
  "/watch": { color: "#5f706a", art: '<path d="M9 6.6l.7-3.1h4.6l.7 3.1M9 17.4l.7 3.1h4.6l.7-3.1"/><circle cx="12" cy="12" r="5.8" fill="F"/><path d="M12 9.3V12l1.8 1.2M18.6 11v2"/>' },
  "/media": { color: "#e0569a", art: '<path d="M9 17.5V6l10.5-2v11.5"/><circle cx="6.7" cy="17.5" r="2.3" fill="F"/><circle cx="17.2" cy="15.5" r="2.3" fill="F"/>' },
  "/maps": { color: "#22a06b", art: '<path d="M3.5 6.5L9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" fill="F"/><path d="M9 4.5v13M15 6.5v13"/>' },
  "/studio": { color: "#a35cf2", art: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.7-1 1.2-2-.5-1 .2-2.2 1.4-2.2H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7.3 16.7 3.5 12 3.5z" fill="F"/><circle cx="7.8" cy="11.5" r="1.2" fill="S" stroke="none"/><circle cx="10" cy="7.6" r="1.2" fill="S" stroke="none"/><circle cx="14.5" cy="7.6" r="1.2" fill="S" stroke="none"/>' },
  "/sports/running": { color: "#2f9bf6", art: '<path d="M3.5 17.5c0-2.2.4-4.4 1-6.6l3 .4c1.1 1.6 2.6 2.2 4.6 2.2l5 1.5c2 .6 3.4 1.6 3.4 3v.5z" fill="F"/><path d="M3.5 17.5h17M8 13l1.2-1.4M10.5 14l1.2-1.6"/>' },
  "/sports/riding": { color: "#e8813c", art: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l3.5-6.5h6L18 16M9.5 9.5L12 16H6M13.5 6.5H16"/>' },
  "/sports/swimming": { color: "#14a3a3", art: '<circle cx="16.5" cy="7" r="2" fill="S" stroke="none"/><path d="M5 12.5l5-4 3.5 3M3 16c1.5 0 1.5 1.2 3 1.2S7.5 16 9 16s1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2"/>' },
  "/sports/walking": { color: "#d9a21b", art: '<circle cx="13" cy="4.5" r="1.9" fill="S" stroke="none"/><path d="M8 21l2.5-6 2-2.5-.5-4-3 2-1 3.5M12.5 8.5l2.5 3 3 1M12.5 12.5l2 3.5.5 5"/>' },
  "/sports/hiking": { color: "#f0714f", art: '<path d="M3 20l6-11 4 6 2.5-4L21 20z" fill="F"/><path d="M7.5 12.5l1.5 1 1.5-1"/>' },
  "/sports/skiing": { color: "#7b6cf6", art: '<circle cx="12" cy="12" r="3" fill="F"/><path d="M12 3.5v17M4.6 7.75l14.8 8.5M4.6 16.25l14.8-8.5M9.8 4.8L12 6.6l2.2-1.8M9.8 19.2L12 17.4l2.2 1.8"/>' },
  "/sports/climbing": { color: "#e5487a", art: '<rect x="4" y="3.5" width="16" height="17" rx="3" fill="F"/><circle cx="8.5" cy="8" r="1.2" fill="S" stroke="none"/><circle cx="15" cy="6.5" r="1.2" fill="S" stroke="none"/><circle cx="11.5" cy="12" r="1.2" fill="S" stroke="none"/><circle cx="16" cy="15" r="1.2" fill="S" stroke="none"/><circle cx="9" cy="17" r="1.2" fill="S" stroke="none"/>' },
  "/health/energy": { color: "#12b886", art: '<path d="M13.5 3L5.5 13.5H11L10 21l8.5-10.5H13z" fill="F"/>' },
  "/calendar/workout": { color: "#2f7cf6", art: '<rect x="3.5" y="5" width="17" height="15" rx="3" fill="F"/><path d="M8 3v4M16 3v4M12 10.5v6M9 13.5h6"/>' },
  "/connect": { color: "#5f706a", art: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>' },
};

const FALLBACK = "#5f706a";

function mix(hex: string, to: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * amount));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A page's tile. `icon` is its sidebar path, drawn when the palette has no art for it. */
export function PageTile({ href, icon, size = 34 }: { href: string; icon?: string; size?: number }) {
  const page = ART[href];
  const color = page?.color ?? FALLBACK;
  const inner = page
    ? page.art.replaceAll('"F"', '"rgba(255,255,255,0.34)"').replaceAll('"S"', '"#ffffff"')
    : `<path d="${icon ?? ""}"/>`;
  const glyph = Math.round(size * 0.56);
  return (
    <span className="pt-tile" aria-hidden="true" style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3),
      background: `linear-gradient(180deg, ${mix(color, 255, 0.16)}, ${mix(color, 0, 0.14)})`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.12), 0 2px 6px ${alpha(color, 0.28)}`,
    }}>
      {/* The art is this file's own constant markup, never anything typed or synced. */}
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: inner }} />
    </span>
  );
}
