# Add Manual Activity to COROS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Training Hub form that uploads a hand-entered activity to the user's COROS account by generating a minimal TCX and reusing the existing verified upload pipeline.

**Architecture:** A pure `tcxBuilder` turns `ManualActivityInput` into a minimal valid TCX string; an IPC handler writes it to a temp `.tcx` and hands it to the already-built, already-verified `uploadActivityFitToCoros` (STS→zip→S3→`/activity/fit/import`); a Training Hub panel collects the input.

**Tech Stack:** Electron main (TS→`dist-electron/`), React 19 renderer, `node:fs`/`node:os`/`node:path`. No new runtime dependencies.

## Global Constraints

- **No new runtime dependencies.** TCX is built by string assembly.
- **Reuse `uploadActivityFitToCoros`** (handles `.tcx`); do NOT rename it, do NOT add a second upload path or COROS login.
- **Test convention:** `scripts/test-<name>.mjs`, `node:assert/strict`, import compiled output from `dist-electron/<file>.js`, print `<name> tests passed`, wired as `npm run test:<name>` running `npm run build:electron` first.
- **Renderer API is a flat object** exposed as `window.corosLink` and typed in `src/coroslink-api.ts` (`CorosLinkApi`); mirror that convention (as the intervals methods do). UI panels follow `src/training/components/ActivityBackupPanel.tsx` and mount in `src/training/TrainingHubView.tsx` behind the same `connected`/authenticated guard as sibling panels.
- **Sport mapping:** `run→Running`, `bike→Biking`, `other→Other`.
- **TCX Lap required children, in order:** `TotalTimeSeconds`, `DistanceMeters`, `Calories`, `Intensity`, `TriggerMethod`; optional `AverageHeartRateBpm` emitted immediately before `Intensity`. `Calories` defaults to `0` when omitted.

---

### Task 1: TCX builder

**Files:**
- Create: `electron/tcxBuilder.ts`
- Modify: `electron/types.ts` (add `ManualActivityInput`)
- Test: `scripts/test-tcx-builder.mjs`
- Modify: `package.json` (add `test:tcx-builder`)

**Interfaces:**
- Produces: `buildManualTcx(input: ManualActivityInput): string`
- Type (add to `electron/types.ts`):
  ```ts
  export interface ManualActivityInput {
    sport: "run" | "bike" | "other";
    startTimeIso: string;
    durationSec: number;
    distanceM: number;
    calories?: number;
    avgHr?: number;
  }
  ```

- [ ] **Step 1: Add the `ManualActivityInput` type** to `electron/types.ts` (append; do not touch unrelated types).

- [ ] **Step 2: Write the failing test.** Create `scripts/test-tcx-builder.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { buildManualTcx } = await import(
  `${distUrl("tcxBuilder.js")}?cacheBust=${Date.now()}`
);

// Full case with effort fields.
const xml = buildManualTcx({
  sport: "run",
  startTimeIso: "2026-07-08T14:00:00Z",
  durationSec: 2700,
  distanceM: 8000,
  calories: 500,
  avgHr: 145
});
assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
assert.match(xml, /<Activity Sport="Running">/);
assert.match(xml, /<Id>2026-07-08T14:00:00Z<\/Id>/);
assert.match(xml, /<Lap StartTime="2026-07-08T14:00:00Z">/);
assert.match(xml, /<TotalTimeSeconds>2700<\/TotalTimeSeconds>/);
assert.match(xml, /<DistanceMeters>8000<\/DistanceMeters>/);
assert.match(xml, /<Calories>500<\/Calories>/);
assert.match(xml, /<AverageHeartRateBpm><Value>145<\/Value><\/AverageHeartRateBpm>/);
assert.match(xml, /<Intensity>Active<\/Intensity>/);
assert.match(xml, /<TriggerMethod>Manual<\/TriggerMethod>/);
// AverageHeartRateBpm must appear before Intensity (schema order).
assert.ok(xml.indexOf("AverageHeartRateBpm") < xml.indexOf("<Intensity>"));

// Sport mapping.
assert.match(buildManualTcx({ sport: "bike", startTimeIso: "2026-07-08T00:00:00Z", durationSec: 60, distanceM: 0 }), /Sport="Biking"/);
assert.match(buildManualTcx({ sport: "other", startTimeIso: "2026-07-08T00:00:00Z", durationSec: 60, distanceM: 0 }), /Sport="Other"/);

// Effort fields omitted: Calories defaults to 0, no AverageHeartRateBpm element.
const bare = buildManualTcx({ sport: "other", startTimeIso: "2026-07-08T00:00:00Z", durationSec: 1800, distanceM: 0 });
assert.match(bare, /<Calories>0<\/Calories>/);
assert.ok(!bare.includes("AverageHeartRateBpm"));

console.log("tcx-builder tests passed");
```

- [ ] **Step 3: Add the script to package.json:**
```json
"test:tcx-builder": "npm run build:electron && node scripts/test-tcx-builder.mjs",
```

- [ ] **Step 4: Run test to verify it fails.** `npm run test:tcx-builder` → module not found.

- [ ] **Step 5: Implement.** Create `electron/tcxBuilder.ts`:

```ts
import type { ManualActivityInput } from "./types";

const SPORT_MAP: Record<ManualActivityInput["sport"], string> = {
  run: "Running",
  bike: "Biking",
  other: "Other"
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a minimal, schema-valid TCX for a hand-entered activity. */
export function buildManualTcx(input: ManualActivityInput): string {
  const sport = SPORT_MAP[input.sport] ?? "Other";
  const start = xmlEscape(input.startTimeIso);
  const total = Math.max(0, Math.round(input.durationSec));
  const distance = Math.max(0, Math.round(input.distanceM));
  const calories = Math.max(0, Math.round(input.calories ?? 0));
  const hr =
    input.avgHr != null && input.avgHr > 0
      ? `        <AverageHeartRateBpm><Value>${Math.round(
          input.avgHr
        )}</Value></AverageHeartRateBpm>\n`
      : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n` +
    `  <Activities>\n` +
    `    <Activity Sport="${sport}">\n` +
    `      <Id>${start}</Id>\n` +
    `      <Lap StartTime="${start}">\n` +
    `        <TotalTimeSeconds>${total}</TotalTimeSeconds>\n` +
    `        <DistanceMeters>${distance}</DistanceMeters>\n` +
    `        <Calories>${calories}</Calories>\n` +
    hr +
    `        <Intensity>Active</Intensity>\n` +
    `        <TriggerMethod>Manual</TriggerMethod>\n` +
    `      </Lap>\n` +
    `    </Activity>\n` +
    `  </Activities>\n` +
    `</TrainingCenterDatabase>\n`
  );
}
```

- [ ] **Step 6: Run test to verify it passes.** `npm run test:tcx-builder` → `tcx-builder tests passed`

- [ ] **Step 7: Commit.**
```bash
git add electron/tcxBuilder.ts electron/types.ts scripts/test-tcx-builder.mjs package.json
git commit -m "feat: add TCX builder for manual activities"
```

---

### Task 2: IPC wiring + live spike

**Files:**
- Modify: `electron/main.ts` (handler `coros:addManualActivity`)
- Modify: `electron/preload.ts` (expose `addManualActivityToCoros`)
- Modify: `src/coroslink-api.ts` (typed method + `ManualActivityInput` type on renderer)

**Interfaces:**
- Consumes: `buildManualTcx` (Task 1); `uploadActivityFitToCoros(fitPath)` (existing, verified).
- Produces (renderer): `addManualActivityToCoros(input: ManualActivityInput): Promise<{ importId: string }>`

- [ ] **Step 1: Register the handler in `electron/main.ts`.** Import `buildManualTcx` from `./tcxBuilder` (and `ManualActivityInput` type); `uploadActivityFitToCoros` is already imported for the intervals feature. Add near the `intervals:*` handlers:

```ts
ipcMain.handle(
  "coros:addManualActivity",
  async (_e, input: ManualActivityInput): Promise<{ importId: string }> => {
    if (!(input.durationSec > 0)) {
      throw new Error("Duration must be greater than 0.");
    }
    if (Number.isNaN(Date.parse(input.startTimeIso))) {
      throw new Error("Invalid start time.");
    }
    const tcx = buildManualTcx(input);
    const tmp = path.join(
      os.tmpdir(),
      `coroslink-manual-${Date.now()}.tcx`
    );
    fs.writeFileSync(tmp, tcx, "utf8");
    try {
      return await uploadActivityFitToCoros(tmp);
    } finally {
      try {
        fs.rmSync(tmp);
      } catch {
        /* best effort */
      }
    }
  }
);
```
(`os`, `path`, `fs` are already imported in `main.ts` from the intervals handler; reuse them.)

- [ ] **Step 2: Expose in `electron/preload.ts`.** Add to the flat `api` object next to the intervals methods:
```ts
addManualActivityToCoros: (input: ManualActivityInput) =>
  ipcRenderer.invoke("coros:addManualActivity", input),
```
Import the `ManualActivityInput` type at the top alongside the other type imports.

- [ ] **Step 3: Type it in `src/coroslink-api.ts`.** Add `addManualActivityToCoros(input: ManualActivityInput): Promise<{ importId: string }>` to the `CorosLinkApi` interface and re-export/declare `ManualActivityInput` (mirror how `IntervalsActivityWithStatus` is handled there).

- [ ] **Step 4: Build both projects.** `npm run build:electron && npm run build:renderer` → no TS errors.

- [ ] **Step 5: LIVE SPIKE (manual, user + real COROS session).** With the app running (`npm run dev`) and logged into COROS, trigger `addManualActivityToCoros` once (via the UI in Task 3, or a temporary devtools call) with a metadata-only run and confirm it appears in COROS within ~1 min.
  - **If COROS rejects the metadata-only TCX** (no trackpoint): update `buildManualTcx` to append a single `<Track><Trackpoint><Time>${start}</Time></Trackpoint></Track>` inside the Lap (after `TriggerMethod`), update the Task 1 test to assert the trackpoint is present, re-run `test:tcx-builder`, and re-test live. Commit that adjustment separately.

- [ ] **Step 6: Commit.**
```bash
git add electron/main.ts electron/preload.ts src/coroslink-api.ts
git commit -m "feat: wire manual-activity-to-COROS IPC channel"
```

---

### Task 3: Training Hub "Add activity" panel

**Files:**
- Create: `src/training/components/ManualActivityPanel.tsx`
- Modify: `src/training/TrainingHubView.tsx` (mount)

**Interfaces:**
- Consumes: renderer `addManualActivityToCoros(input)` (Task 2).

- [ ] **Step 1: Read conventions first.** Open `src/training/components/ActivityBackupPanel.tsx` for styling/classNames and how it accesses the renderer API (`window.corosLink` / the imported api object), and `src/training/TrainingHubView.tsx` for the auth-guarded region where sibling panels mount.

- [ ] **Step 2: Write `ManualActivityPanel.tsx`.** A panel titled "Add activity to COROS" with:
  - Sport `<select>`: Course (`run`) / Vélo (`bike`) / Autre (`other`).
  - Start date-time input → convert to ISO-8601 UTC (`new Date(local).toISOString()`).
  - Duration: hours + minutes (or minutes) → `durationSec`.
  - Distance in km → meters (`* 1000`); allow 0/empty → 0.
  - Optional calories and average HR number inputs.
  - An **Add to COROS** button calling `addManualActivityToCoros(input)`, disabled while in flight (spinner); on success show a confirmation and reset the form; on error show a clear inline message. Validate `durationSec > 0` before calling.
  Use the same className/layout patterns as `ActivityBackupPanel`. Match its export style (named export + `api` prop if that is the sibling convention).

- [ ] **Step 3: Mount in `TrainingHubView.tsx`** in the same authenticated block as `ActivityBackupPanel`/`IntervalsImportPanel`, using the same guard. Pass the api prop the same way siblings do.

- [ ] **Step 4: Build renderer.** `npm run build:renderer` → no TS errors.

- [ ] **Step 5: Manual UI validation (with user).** In `npm run dev`: fill the form, submit, confirm the activity lands in COROS and the effort fields (calories/HR) show where COROS displays them.

- [ ] **Step 6: Commit.**
```bash
git add src/training/components/ManualActivityPanel.tsx src/training/TrainingHubView.tsx
git commit -m "feat: add manual-activity panel to Training Hub"
```

---

## Final validation gate (with user) then PR

- [ ] `npm run test:tcx-builder` passes, and all previously-added `test:*` suites still pass.
- [ ] `npm run build` (electron + renderer) clean.
- [ ] Live: added a manual activity end-to-end and it appears in COROS (this is the TCX-acceptance spike — hard blocker).
- [ ] Then proceed to the combined fork + PR for the whole branch.
