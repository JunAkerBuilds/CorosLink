# Switching a watch face to another watch

In Studio, choose **Export → Convert to another watch**, select the destination
watch, and convert. There is no destination template picker. The original editor
stays mounted until conversion succeeds; Cancel and failed conversions preserve
its session, selection and undo history. A successful conversion opens a new,
unsaved project with the destination model in its name. Existing saved projects
are not overwritten.

If first-use support needs a COROS session, the conversion dialog opens sign-in
with the account region, email/password and saved-account option. Signing in
resumes conversion to the selected watch automatically. Failed sign-ins stay in
the dialog, and returning to watch selection preserves the design and target.
Expired sessions follow the same flow; cached support still works offline.

## Template audit

On 2026-09-17, the authenticated COROS editable catalogs returned 418 listings
across seven watches, representing 102 distinct packages. Every distinct package
was downloaded and inspected, including every config, resolution directory and
asset inventory. The package URLs and individual conversion results are recorded
in [the audit report](research/watchface-conversion-audit.json).

| Watch | Catalog listings | Display | Default preview | Converted archive sizes |
| --- | ---: | --- | ---: | --- |
| PACE Pro | 13 | AMOLED | 416 | 416, 800 |
| PACE 4 | 10 | AMOLED | 390 | 390, 800 |
| PACE 3 | 79 | MIP | 240 | 240, 260, 280, 800 |
| NOMAD | 79 | MIP | 260 | 240, 260, 280, 800 |
| VERTIX 2 | 79 | MIP | 280 | 240, 260, 280, 800 |
| VERTIX 2S | 79 | MIP | 280 | 240, 260, 280, 800 |
| APEX 4 | 79 | MIP | 260 (46 mm) | 240 (42 mm), 260, 280, 800 |

The five MIP catalogs return the same 79 packages. Their original bundles may
also include a legacy 218px tree. All three families share an 800px authoring
layout. Six AMOLED packages only include AOD at the physical display resolution.
Four older packages use `×` or `??` instead of `x` in some folder names; the
converter normalizes those names. Another 37 packages include cached
`watchface.bin` / `watchface_ota.bin` files alongside editable configs. Conversion
discards those stale device builds so COROS can compile the destination source.
The catalogs include digital, automatic time,
analog, weather, shared selectable controls and multilingual date assets.

Device display sizes/types were also checked against the
[COROS comparison table](https://www.coros.com.br/tabela-comparativa/),
[PACE 3 specifications](https://www.coros.com.br/produtos/coros-pace-3/), and
[VERTIX 2 specifications](https://www.coros.com.au/pages/vertix-2-specs).

## Why the previous flow changed the design

Studio's scene stores edits relative to the starter archive: a font may still
mean “use the template font,” and an offset is relative to the template position.
Copying those edits onto an unrelated starter changes the underlying positions,
fonts, hands, icons, enabled fields and control origins. Raw edits were dropped
altogether. Choosing a similarly named destination template cannot solve this.

## Conversion contract

`electron/watchfaceTargets.ts` defines supported watch identity separately from
shared resolution profiles. `electron/watchfaceArchiveConversion.ts` converts the
source archive while the renderer preserves the editable scene.

1. Resolve an official destination carrier automatically. It supplies the
   destination template identity and per-resolution watchface IDs. First use
   requires COROS sign-in and connectivity; a private cache supports later
   offline conversions.
2. Carry forward the source 800px config, original PNGs, font/state folders,
   language variants and manifest metadata. Generate the destination device
   sizes from that master. The destination's visual defaults are never overlaid.
3. Fold raw config changes into the new baseline before clearing the old
   archive paths from scene state. Changed keys are rescaled from their original
   coordinate frame; the 800px edit wins conflicts, followed by the largest
   edited device resolution. Device identity comes from the carrier. Unknown
   geometry produces an error instead of a guessed conversion.
4. Preserve scene offsets, native data, image replacements, groups, guides,
   visibility, opacity, effects and strokes as editable values. They are applied
   once during normal rendering/export, avoiding double-applied transformations.
5. Preserve AOD separately. When only a physical AOD exists, scale its layout and
   isolate its assets before constructing an 800px baseline. MIP uses Current
   and retains the AOD baseline under `CorosLinkAODconfig.txt`, with its scene
   state intact. Returning to AMOLED restores it. A MIP source without AOD gets
   an editable copy of Current when converting to AMOLED.
6. Validate the destination inventory, dimensions and archive limits before
   switching editor sessions. Never overwrite the source archive.

Repeated conversions always use the retained 800px source instead of resizing
the previous device's small output. This avoids cumulative blur and coordinate
rounding. Dormant AOD references also participate in export asset retention so
the MIP exporter cannot prune resources needed by a subsequent AMOLED conversion.

## Recovered official faces

An official catalog face opened through recovery has only the tree it was
decoded from (for example `watchface_416x416` next to `recovery/source.bin`),
never an 800px master, so its scene cannot be carried live onto another watch.
Converting one therefore takes the export route: the editor composes the scene
into the native tree exactly as **Send to watch** does, and the recovered
exporter scales that composed tree straight to the destination's sizes with the
destination's official carrier supplying the template identity, thumbnails and
watchface IDs. The finished archive opens as a new, unsaved project whose
starter already contains the edits; positions, fonts and replaced artwork are
part of the new baseline rather than pending edits, and the project keeps being
editable from there. The physical tree is scaled directly from the native
layout (416 → 390 for PACE 4, for instance), while the 800px master of the new
archive is an enlargement, as in every recovered export. `Convert to another
watch` shows this difference in its dialog, and `convert` in automation rejects
a preselected `targetArchive` for these faces. Downloaded compiled catalog
packages themselves still cannot be converted; open them through recovery first.

The converted archive is not itself flagged as recovered, but it carries the
face's own weather icons and native-data sprites. Studio hydrates such sprites
from any starter that has them, the way recovery does, so the icons, their
authored size and the temperature geometry stay the original ones instead of
being replaced by the editor's generated weather defaults on reopen and export.

## Verification and limits

The audit exercises all 102 packages against each of the three archive families
(306 conversions), checks required Current/AOD trees, unique paths, archive size
limits and byte-for-byte preservation of original master PNGs. All passed.
Dedicated regression tests cover all seven target identities, proportional
geometry, analog hands, raw config migration, incomplete AOD source trees,
AMOLED/MIP round trips, automatic cached carriers and production archive export.
The Electron integration test also exercises the watch-only picker, cancellation,
first-use sign-in, failed login, saved-account login after session expiry,
automatic conversion after login,
scene preservation, previews, archive builds and automation's model-only API.

Run `npm run test:watchface-conversion`, `npm run test:recovered-watchface-conversion`,
`npm run test:watchface-editor`, `npm run test:watchface-studio`, and
`npm run test:watchface-automation-e2e`.
The optional `scripts/audit-watchface-conversion.cjs` accepts a downloaded
template inventory and writes the per-package audit report.

This verifies editable archives and desktop rendering, not installation on
physical watches. MIP colors/contrast and fine detail can differ from AMOLED;
master artwork is preserved without destructive palette conversion. A newly
generated AMOLED AOD should be reviewed for power use. Newer native data fields
remain subject to destination firmware support. Sources without a usable 800px
master, unknown raw geometry, and archives containing unrecognized compiled `.pb`/`.bin` data
are rejected rather than silently losing content; use their editable source, or
recovery for an official compiled face.
