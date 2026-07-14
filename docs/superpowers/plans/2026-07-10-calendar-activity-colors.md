# Per-sport Activity Colors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Color each Calendar activity chip by sport via a semi-transparent right-side liseré, with the five colors user-customizable in Settings and persisted in localStorage.

**Architecture:** A pure `sportColors` module owns categorization, defaults, localStorage read/write, and CSS-variable application. The renderer applies the stored colors as `--sport-*` custom properties at boot; DayCell tags each activity chip with a `calendar-sport-<cat>` class; CSS draws the right liseré via `color-mix`. A Settings card edits the colors and re-applies them live.

**Tech Stack:** React 19 renderer, TypeScript, CSS custom properties + `color-mix`, `localStorage`. No new dependencies.

## Global Constraints

- **No new runtime dependencies.**
- **Renderer UI preference persistence via `localStorage`** (key `coroslink.sportColors`) applied as CSS vars on `document.documentElement`, mirroring the theme — NOT backend/SQLite/IPC.
- **Do not touch** the existing planned-workout left-border categories (`calendar-cat-*` / `inferUpcomingWorkoutCategory`) — that is workout-type coloring on the LEFT border and is unrelated.
- **Five categories, fixed keys:** `strength`, `trail`, `run`, `bike`, `other`. Defaults: `#e5484d`, `#4c8dff`, `#2fbe91`, `#e6b800`, `#7fd8cf`.
- **Visual:** keep the existing left gray border; add a RIGHT border liseré at ~60% opacity via `color-mix(in srgb, var(--sport-<cat>) 60%, transparent)`.
- **Renderer test convention:** `.ts` source is imported directly by a `scripts/test-<name>.mjs` run with `node --experimental-strip-types` (see `scripts/test-greetings.mjs` / `package.json` `test:greetings`) — no build step needed for a self-contained src module. Use `node:assert/strict`, print `<name> tests passed`.

---

### Task 1: `sportColors` module

**Files:**
- Create: `src/calendar/sportColors.ts`
- Test: `scripts/test-sport-colors.mjs`
- Modify: `package.json` (add `test:sport-colors`)

**Interfaces:**
- Produces: `SportColorCategory`, `SPORT_COLOR_CATEGORIES`, `DEFAULT_SPORT_COLORS`, `SPORT_COLOR_LABELS`, `sportColorCategory(name)`, `parseSportColors(raw)`, `readStoredSportColors()`, `storeSportColors(colors)`, `applySportColors(colors)`.

- [ ] **Step 1: Write the failing test.** Create `scripts/test-sport-colors.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "calendar", "sportColors.ts")
);
const { sportColorCategory, parseSportColors, DEFAULT_SPORT_COLORS } =
  await import(`${modUrl.href}?c=${Date.now()}`);

// Categorization (trail before run; bike before run; French + English names).
assert.equal(sportColorCategory("TrailRun"), "trail");
assert.equal(sportColorCategory("Morning Trail Run"), "trail");
assert.equal(sportColorCategory("Run"), "run");
assert.equal(sportColorCategory("Lunch Trail Run"), "trail");
assert.equal(sportColorCategory("Lunch Cyclisme"), "bike");
assert.equal(sportColorCategory("VirtualRide"), "bike");
assert.equal(sportColorCategory("Evening Vélo"), "bike");
assert.equal(sportColorCategory("WeightTraining"), "strength");
assert.equal(sportColorCategory("Afternoon Musculation"), "strength");
assert.equal(sportColorCategory("Afternoon Entraînement"), "strength");
assert.equal(sportColorCategory("Workout"), "strength");
assert.equal(sportColorCategory("Pool Swim"), "other");
assert.equal(sportColorCategory(""), "other");
assert.equal(sportColorCategory(undefined), "other");

// parseSportColors: merge partial over defaults, ignore invalid, malformed → defaults.
assert.deepEqual(parseSportColors(null), DEFAULT_SPORT_COLORS);
assert.equal(parseSportColors('{"run":"#123456"}').run, "#123456");
assert.equal(
  parseSportColors('{"run":"#123456"}').trail,
  DEFAULT_SPORT_COLORS.trail
);
assert.equal(
  parseSportColors('{"run":"not-a-color"}').run,
  DEFAULT_SPORT_COLORS.run
);
assert.deepEqual(parseSportColors("{malformed"), DEFAULT_SPORT_COLORS);

console.log("sport-colors tests passed");
```

- [ ] **Step 2: Add the script to package.json:**
```json
"test:sport-colors": "node --experimental-strip-types scripts/test-sport-colors.mjs",
```

- [ ] **Step 3: Run test to verify it fails.** `npm run test:sport-colors` → module not found (`src/calendar/sportColors.ts` missing).

- [ ] **Step 4: Implement.** Create `src/calendar/sportColors.ts`:

```ts
export type SportColorCategory = "strength" | "trail" | "run" | "bike" | "other";

export const SPORT_COLOR_CATEGORIES: SportColorCategory[] = [
  "strength",
  "trail",
  "run",
  "bike",
  "other"
];

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

const STORAGE_KEY = "coroslink.sportColors";
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Categorize an activity by sport name. Trail and bike are checked before run
 *  so "TrailRun"/"VirtualRide" don't fall into run. Matches FR + EN names. */
export function sportColorCategory(
  name: string | undefined
): SportColorCategory {
  const n = (name ?? "").toLowerCase();
  if (!n) return "other";
  if (/trail/.test(n)) return "trail";
  if (/(bike|cycl|ride|v[ée]lo|spin)/.test(n)) return "bike";
  if (/(run|jog|course|marathon|tempo|track|\d+\s?k\b)/.test(n)) return "run";
  if (/(muscu|weight|strength|gym|\bcore\b|workout|entra[iî]n)/.test(n)) {
    return "strength";
  }
  return "other";
}

/** Parse a stored JSON blob, merging valid hex values over the defaults. */
export function parseSportColors(
  raw: string | null
): Record<SportColorCategory, string> {
  const result = { ...DEFAULT_SPORT_COLORS };
  if (!raw) return result;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const cat of SPORT_COLOR_CATEGORIES) {
      const value = parsed[cat];
      if (typeof value === "string" && HEX_RE.test(value)) {
        result[cat] = value;
      }
    }
  } catch {
    // malformed → defaults
  }
  return result;
}

export function readStoredSportColors(): Record<SportColorCategory, string> {
  const raw =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(STORAGE_KEY)
      : null;
  return parseSportColors(raw);
}

export function storeSportColors(
  colors: Record<SportColorCategory, string>
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // storage unavailable — ignore
  }
}

/** Set --sport-<cat> custom properties on the document root. */
export function applySportColors(
  colors: Record<SportColorCategory, string>
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const cat of SPORT_COLOR_CATEGORIES) {
    root.style.setProperty(`--sport-${cat}`, colors[cat]);
  }
}
```

- [ ] **Step 5: Run test to verify it passes.** `npm run test:sport-colors` → `sport-colors tests passed`

- [ ] **Step 6: Commit.**
```bash
git add src/calendar/sportColors.ts scripts/test-sport-colors.mjs package.json
git commit -m "feat: add sportColors module (categorization + persistence)"
```

---

### Task 2: Apply colors to Calendar chips (boot + DayCell + CSS)

**Files:**
- Modify: `src/main.tsx` (apply stored colors at boot)
- Modify: `src/calendar/DayCell.tsx` (tag activity chips with `calendar-sport-<cat>`)
- Modify: `src/styles.css` (`:root` defaults + right liseré rules)

**Interfaces:**
- Consumes: `sportColorCategory`, `readStoredSportColors`, `applySportColors` (Task 1).

- [ ] **Step 1: Apply colors at boot in `src/main.tsx`.** Near the top-level render (before `createRoot(...).render(...)`), add:

```ts
import { applySportColors, readStoredSportColors } from "./calendar/sportColors";

applySportColors(readStoredSportColors());
```
(Place the call after imports, before the render call so the `--sport-*` vars exist on first paint. If the theme is applied here too, colocate with it.)

- [ ] **Step 2: Tag activity chips in `src/calendar/DayCell.tsx`.**
  - Add the import: `import { sportColorCategory } from "./sportColors";`
  - Add a helper near the existing `categoryClass`:
    ```ts
    function sportChipClass(name: string | undefined): string {
      return `calendar-sport-${sportColorCategory(name)}`;
    }
    ```
  - On the **unplanned activity** chip, change:
    ```tsx
    className="calendar-chip calendar-chip-activity"
    ```
    to:
    ```tsx
    className={`calendar-chip calendar-chip-activity ${sportChipClass(
      activity.sportName ?? activity.name
    )}`}
    ```
  - On the **PairChip completed-activity** branch (the `if (activity) { ... }` button, currently `className={`calendar-chip calendar-chip-paired ${categoryClass(scheduled.name)}`}`), append the sport class from the ACTUAL activity:
    ```tsx
    className={`calendar-chip calendar-chip-paired ${categoryClass(
      scheduled.name
    )} ${sportChipClass(activity.sportName ?? activity.name)}`}
    ```
  Leave the planned-only chip (`calendar-chip-planned`) untouched.

- [ ] **Step 3: Add CSS in `src/styles.css`.** Add the defaults to the existing `:root` block (near the other color tokens, e.g. after `--accent-gold`):

```css
  --sport-strength: #e5484d;
  --sport-trail: #4c8dff;
  --sport-run: #2fbe91;
  --sport-bike: #e6b800;
  --sport-other: #7fd8cf;
```

Then add, next to the existing `.calendar-cat-*` rules (near the end of the calendar styles):

```css
.calendar-chip-activity,
.calendar-chip-paired {
  border-right: 3px solid transparent;
}
.calendar-sport-strength { border-right-color: color-mix(in srgb, var(--sport-strength) 60%, transparent); }
.calendar-sport-trail    { border-right-color: color-mix(in srgb, var(--sport-trail) 60%, transparent); }
.calendar-sport-run      { border-right-color: color-mix(in srgb, var(--sport-run) 60%, transparent); }
.calendar-sport-bike     { border-right-color: color-mix(in srgb, var(--sport-bike) 60%, transparent); }
.calendar-sport-other    { border-right-color: color-mix(in srgb, var(--sport-other) 60%, transparent); }
```

- [ ] **Step 4: Build the renderer to verify it compiles.** `npm run build:renderer` → no TypeScript errors.

- [ ] **Step 5: Commit.**
```bash
git add src/main.tsx src/calendar/DayCell.tsx src/styles.css
git commit -m "feat: render per-sport right liseré on calendar activity chips"
```

---

### Task 3: "Activity colors" card in Settings

**Files:**
- Modify: `src/settings/SettingsView.tsx`
- Modify: `src/styles.css` (small styles for the color rows/preview, reusing existing settings-card classes where possible)

**Interfaces:**
- Consumes: `SPORT_COLOR_CATEGORIES`, `SPORT_COLOR_LABELS`, `DEFAULT_SPORT_COLORS`, `readStoredSportColors`, `storeSportColors`, `applySportColors`, `SportColorCategory` (Task 1).

- [ ] **Step 1: Read the existing SettingsView card structure** so the new card matches the sibling cards' markup/classNames (headings, card container, layout). It renders a list of cards (About, app info, updates).

- [ ] **Step 2: Add the "Activity colors" card.** In `src/settings/SettingsView.tsx`:
  - Import: `import { SPORT_COLOR_CATEGORIES, SPORT_COLOR_LABELS, DEFAULT_SPORT_COLORS, readStoredSportColors, storeSportColors, applySportColors, type SportColorCategory } from "../calendar/sportColors";`
  - State: `const [sportColors, setSportColors] = useState(() => readStoredSportColors());`
  - Handler:
    ```tsx
    function updateSportColor(cat: SportColorCategory, value: string) {
      const next = { ...sportColors, [cat]: value };
      setSportColors(next);
      storeSportColors(next);
      applySportColors(next);
    }
    function resetSportColors() {
      const next = { ...DEFAULT_SPORT_COLORS };
      setSportColors(next);
      storeSportColors(next);
      applySportColors(next);
    }
    ```
  - Render a card (matching the sibling cards) titled "Activity colors" with one row per `SPORT_COLOR_CATEGORIES`:
    ```tsx
    <div className="settings-card">
      <h3>Activity colors</h3>
      <p className="settings-card-hint">
        Colors of the right edge of each activity in the calendar, by sport.
      </p>
      <div className="sport-color-rows">
        {SPORT_COLOR_CATEGORIES.map((cat) => (
          <label key={cat} className="sport-color-row">
            <span
              className={`calendar-chip calendar-chip-activity calendar-sport-${cat} sport-color-preview`}
              aria-hidden="true"
            >
              <span className="calendar-chip-title">
                <span className="calendar-chip-name">{SPORT_COLOR_LABELS[cat]}</span>
              </span>
            </span>
            <input
              type="color"
              value={sportColors[cat]}
              onChange={(e) => updateSportColor(cat, e.target.value)}
              aria-label={`${SPORT_COLOR_LABELS[cat]} color`}
            />
          </label>
        ))}
      </div>
      <button type="button" className="settings-secondary-button" onClick={resetSportColors}>
        Reset to defaults
      </button>
    </div>
    ```
  Match the real card container class and button class used by the sibling cards (read them in Step 1 — the snippet's `settings-card`/`settings-secondary-button` names may differ; use the file's actual conventions).

- [ ] **Step 3: Add minimal CSS in `src/styles.css`** for `.sport-color-rows` (vertical stack, gap), `.sport-color-row` (flex, space-between, align center), and `.sport-color-preview` (fixed small width, `cursor: default`). Reuse existing tokens (`--radius-sm`, spacing) and follow nearby settings styles.

- [ ] **Step 4: Build the renderer.** `npm run build:renderer` → no TypeScript errors.

- [ ] **Step 5: Commit.**
```bash
git add src/settings/SettingsView.tsx src/styles.css
git commit -m "feat: add Activity colors settings card"
```

---

## Final validation gate (with user) then PR

- [ ] `npm run test:sport-colors` passes; all previously-added `test:*` suites still pass.
- [ ] `npm run build` (electron + renderer) clean.
- [ ] Live (`npm run dev`): calendar activity chips show the right-side colored liseré per sport (spot-check a trail=blue, run=green, ride=yellow, strength=red, other=turquoise); the left gray/planned borders are unchanged.
- [ ] In Settings → Activity colors: change a color → matching chips update live; **Reset** restores defaults; colors persist across an app restart.
- [ ] Then fork is already set up (`fork` remote → GitjoPowershell); push `feat/calendar-activity-colors` and open the PR to `JunAkerBuilds/CorosLink`.
