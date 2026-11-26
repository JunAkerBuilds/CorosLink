import Link from "next/link";
import { msg, t } from "@/lib/i18n";

const TABS = [
  { id: "workouts", label: msg("Workouts"), href: "/calendar/library" },
  { id: "plans", label: msg("Plans"), href: "/calendar/plans" },
] as const;

/** The Workout Library's tabs: saved workouts and training plans. */
export function LibraryTabs({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label={t("Workout Library")} className="pl-chips">
      {TABS.map((tab) => (
        <Link key={tab.id} className="chip lib-tab" href={tab.href} aria-current={tab.id === current ? "page" : undefined}>{t(tab.label)}</Link>
      ))}
    </nav>
  );
}
