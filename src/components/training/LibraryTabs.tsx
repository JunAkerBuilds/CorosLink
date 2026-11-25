import Link from "next/link";

const TABS = [
  { id: "workouts", label: "Workouts", href: "/calendar/library" },
  { id: "plans", label: "Plans", href: "/calendar/plans" },
] as const;

/** The Workout Library's tabs: saved workouts and training plans. */
export function LibraryTabs({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="Workout Library" className="pl-chips">
      {TABS.map((t) => (
        <Link key={t.id} className="chip lib-tab" href={t.href} aria-current={t.id === current ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
