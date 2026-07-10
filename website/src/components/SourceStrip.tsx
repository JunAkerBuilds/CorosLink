import {
  Music2,
  Youtube,
  ListMusic,
  Apple,
  Podcast,
  Map,
  Route,
  MountainSnow,
  Activity,
  type LucideIcon,
} from "lucide-react";

const SOURCES: { label: string; Icon: LucideIcon }[] = [
  { label: "Spotify", Icon: Music2 },
  { label: "YouTube", Icon: Youtube },
  { label: "YouTube Music", Icon: ListMusic },
  { label: "Apple Music", Icon: Apple },
  { label: "Apple Podcasts", Icon: Podcast },
  { label: "COROS Maps", Icon: Map },
  { label: "OpenRouteService", Icon: Route },
  { label: "GPX routes", Icon: MountainSnow },
  { label: "FIT export", Icon: Activity },
];

export function SourceStrip() {
  const row = [...SOURCES, ...SOURCES];

  return (
    <div className="relative pt-6">
      <p className="mb-4 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-quiet">
        Works with everything you already use
      </p>
      <div className="marquee-mask overflow-hidden">
        <div className="animate-marquee flex w-max items-center gap-3">
          {row.map((s, i) => (
            <span
              key={`${s.label}-${i}`}
              className="glass-soft flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm font-medium text-muted"
            >
              <s.Icon size={16} className="text-accent-strong" />
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
