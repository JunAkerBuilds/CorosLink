# Design — Per-sport activity colors in the Calendar

**Date:** 2026-07-10
**Status:** Approved (design phase). Branch `feat/calendar-activity-colors`.

## Problem

In the Calendar view (week/month), completed activities render as gray chips with a single green accent stripe on the left. There's no way to tell a run from a ride from a gym session at a glance. Add a **per-sport color** to each activity chip, shown as a **right-side colored liseré** (semi-transparent), with the colors **user-customizable in Settings**.

## Scope (from brainstorming)

- **Five sport categories, all user-customizable**, with these defaults:
  | Category | Matches (sportName / name) | Default color |
  |----------|----------------------------|---------------|
  | `strength` | Musculation, Weight Training, Workout, Entraînement, gym, core | red `#e5484d` |
  | `trail` | Trail (matched **before** run) | blue `#4c8dff` |
  | `run` | Course, Run, jog, marathon, 5k/10k, tempo, track (non-trail) | green `#2fbe91` |
  | `bike` | Vélo, Cyclisme, Ride, VirtualRide, bike, cycl, spin | yellow `#e6b800` |
  | `other` | everything else | pastel turquoise `#7fd8cf` |
- **Visual (revised after live review):** color the **left** border of the activity chip with the sport color, replacing the default green accent. (An earlier iteration added a semi-transparent right-side liseré; the user preferred moving the color to the existing left border instead and dropping the right stripe.) Applies to **unplanned** activity chips (the ones that showed the accent); planned/actual pair chips keep their existing workout-type left-border color.
- **Where editable:** a new "Activity colors" card in the existing Settings view (`src/settings/SettingsView.tsx`), with five `<input type="color">` swatches (label + a live preview chip) and a **Reset to defaults** button.
- **Persistence:** `localStorage` (`coroslink.sportColors`), applied as CSS custom properties on `document.documentElement` (same approach as the theme). One color set, valid in both light and dark themes.
- **Feature scope:** the Calendar view only — the completed-activity chips (unplanned activities and the actual activity inside planned/actual pairs). The existing planned-workout categories (`calendar-cat-*` on the LEFT border, based on workout *type* — Race/Long/Easy/Intervals) are unrelated and left untouched.

## Non-goals

- No change to the planned-workout left-border category coloring.
- No backend/SQLite/IPC persistence — this is a renderer UI preference, stored client-side like the theme.
- No per-theme color sets; no color for swim/walk as separate categories (folded into `other`).
- No new runtime dependencies.

## Architecture

### `src/calendar/sportColors.ts` (new, pure + side-effecting apply)
The single source of truth for categories, defaults, storage, and CSS application.

```ts
export type SportColorCategory = "strength" | "trail" | "run" | "bike" | "other";

export const SPORT_COLOR_CATEGORIES: SportColorCategory[] =
  ["strength", "trail", "run", "bike", "other"];

export const DEFAULT_SPORT_COLORS: Record<SportColorCategory, string> = {
  strength: "#e5484d",
  trail: "#4c8dff",
  run: "#2fbe91",
  bike: "#e6b800",
  other: "#7fd8cf"
};

export const SPORT_COLOR_LABELS: Record<SportColorCategory, string> = {
  strength: "Strength / Gym",
  trail: "Trail",
  run: "Running",
  bike: "Cycling",
  other: "Other"
};

/** Categorize an activity by its sport name (trail checked before run). Pure. */
export function sportColorCategory(name: string | undefined): SportColorCategory;

/** localStorage read (merges stored over defaults; ignores malformed). */
export function readStoredSportColors(): Record<SportColorCategory, string>;

/** localStorage write. */
export function storeSportColors(colors: Record<SportColorCategory, string>): void;

/** Set --sport-<cat> custom properties on document.documentElement. */
export function applySportColors(colors: Record<SportColorCategory, string>): void;
```

Categorization order (first match wins), against `(sportName ?? name ?? "").toLowerCase()`:
1. `trail` — `/trail/`
2. `bike` — `/(bike|cycl|ride|v[ée]lo|spin)/`
3. `run` — `/(run|jog|course|marathon|tempo|track|\d+\s?k\b)/`
4. `strength` — `/(muscu|weight|strength|gym|\bcore\b|workout|entra[iî]n)/`
5. `other` — default

(Order note: `trail` before `run` so "TrailRun" → trail; `bike` before `run` so nothing cross-matches; `strength` matches French "Musculation"/"Entraînement" and English "Weight Training"/"Workout".)

### Boot application
On app start (renderer entry `src/main.tsx`, or the top-level `App`), call `applySportColors(readStoredSportColors())` once so the CSS vars exist before the Calendar renders. The theme already applies at boot the same way — colocate.

### `DayCell.tsx`
Add a helper `sportChipClass(activity)` → `calendar-sport-${sportColorCategory(activity.sportName ?? activity.name)}` and append it to the className of:
- the unplanned activity chip (`.calendar-chip-activity`), and
- the completed-activity `PairChip` (the branch where `pair.activity` exists).

### `styles.css`
- Define defaults in `:root` (and they get overridden at runtime by `applySportColors`):
  ```css
  :root {
    --sport-strength: #e5484d;
    --sport-trail: #4c8dff;
    --sport-run: #2fbe91;
    --sport-bike: #e6b800;
    --sport-other: #7fd8cf;
  }
  ```
- Right-side liseré (kept transparent by default; colored per sport class):
  ```css
  .calendar-chip-activity { border-right: 3px solid transparent; }
  .calendar-sport-strength { border-right-color: color-mix(in srgb, var(--sport-strength) 60%, transparent); }
  .calendar-sport-trail    { border-right-color: color-mix(in srgb, var(--sport-trail) 60%, transparent); }
  .calendar-sport-run      { border-right-color: color-mix(in srgb, var(--sport-run) 60%, transparent); }
  .calendar-sport-bike     { border-right-color: color-mix(in srgb, var(--sport-bike) 60%, transparent); }
  .calendar-sport-other    { border-right-color: color-mix(in srgb, var(--sport-other) 60%, transparent); }
  ```
  (`color-mix` is supported by the app's Chromium/Electron 42 runtime.)

### `SettingsView.tsx`
New "Activity colors" card: five rows, each a color `<input type="color">` bound to the category, its label, and a small preview chip using the live value. Editing updates React state → `storeSportColors` + `applySportColors` immediately (Calendar reflects it on next render / via the CSS vars). A **Reset to defaults** button restores `DEFAULT_SPORT_COLORS`.

## Data flow

```
localStorage[coroslink.sportColors]
      │ read at boot + on Settings mount
      ▼
applySportColors → :root { --sport-* }
      │                         ▲
      ▼                         │ Settings color pickers write + re-apply
.calendar-sport-<cat> chips ────┘ (border-right color-mix)
sportColorCategory(name) picks the class
```

## Error handling / edge cases

- Malformed/missing localStorage → fall back to `DEFAULT_SPORT_COLORS` (merge per-key so a partial/old blob still yields all five).
- Unknown/empty sport name → `other`.
- Invalid hex from a color input can't occur (`<input type="color">` always yields `#rrggbb`); still, `applySportColors` only sets known keys.

## Testing

- **Unit** (`sportColors`): `sportColorCategory` mapping — TrailRun→trail, Run→run, Ride/VirtualRide/Cyclisme→bike, WeightTraining/Musculation/Entraînement/Workout→strength, Swim/unknown→other, empty→other; `readStoredSportColors` merges partial stored over defaults and ignores malformed JSON.
- **Manual (UI):** change each color in Settings → the matching calendar chips' right liseré updates and persists across app restart; Reset restores defaults; existing left-border planned-workout colors unchanged.
