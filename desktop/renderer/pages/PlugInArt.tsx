// Looping "plug in your watch" picture for the Media page's empty watch pane:
// a USB-C plug slides into the watch, the screen wakes, a ring fills and dots
// run down the cable, then it lets go and starts again. `held` keeps the plug
// in (the watch is there but not showing up as a drive yet).
// The view box puts the watch on the centre line so it sits over the text below;
// the cable runs off to the right and fades out.
import "./plugInArt.css";

export function PlugInArt({ held = false }: { held?: boolean }) {
  return (
    <svg className="pia" data-held={held || undefined} viewBox="-30 0 200 120" width="200" height="120" aria-hidden="true">
      <defs>
        <linearGradient id="pia-strap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id="pia-strap-b" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id="pia-cable" gradientUnits="userSpaceOnUse" x1="136" y1="0" x2="168" y2="0">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="pia-fade" maskUnits="userSpaceOnUse" x="100" y="40" width="140" height="40">
          <rect x="100" y="40" width="140" height="40" fill="url(#pia-cable)" />
        </mask>
        <radialGradient id="pia-glow">
          <stop offset="0" stopColor="var(--h-mint)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--h-mint)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Watch */}
      <g className="pia-watch">
        <rect x="56" y="0" width="28" height="36" rx="6" fill="url(#pia-strap)" />
        <rect x="56" y="84" width="28" height="36" rx="6" fill="url(#pia-strap-b)" />
        <circle className="pia-halo" cx="70" cy="60" r="44" fill="url(#pia-glow)" />
        <circle cx="70" cy="60" r="27" className="pia-case" />
        <rect x="95.5" y="54" width="3" height="12" rx="1.5" className="pia-port" />
        <circle cx="70" cy="60" r="20" className="pia-screen" />
        <circle cx="70" cy="60" r="16" className="pia-ring-track" />
        <circle cx="70" cy="60" r="16" className="pia-ring" pathLength="100" transform="rotate(-90 70 60)" />
        <path d="M72.5 50.5 L64.5 61.5 H70 L67.5 69.5 L75.5 58.5 H70 Z" className="pia-bolt" />
      </g>

      {/* Spark where the plug meets the port */}
      <g className="pia-spark">
        <path d="M104 48 l4 -5 M106 60 h7 M104 72 l4 5" />
      </g>

      {/* Cable and plug */}
      <g className="pia-plug">
        <g mask="url(#pia-fade)">
          <path d="M128 60 C 150 60, 160 60, 230 60" className="pia-cable" />
          <path d="M128 60 C 150 60, 160 60, 230 60" className="pia-data" pathLength="100" />
        </g>
        <rect x="98" y="55" width="10" height="10" rx="2" className="pia-tip" />
        <rect x="106" y="51" width="24" height="18" rx="6" className="pia-body" />
        <rect x="113" y="57.5" width="10" height="5" rx="2.5" className="pia-grip" />
      </g>
    </svg>
  );
}
