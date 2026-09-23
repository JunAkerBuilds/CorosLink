# Watchmaker editing loop

Watchmaker uses the editor's existing automation commands with an in-process
agent loop. These changes improve the context and feedback available to the
selected model; they do not substitute a different model or establish a
particular multiplier in design quality.

Each turn starts with all command definitions, a compact live document and a
preview. Detailed design definitions, native-field catalogs and simulation
documentation are available through `get_schema`'s `section` parameter.
`get_document` with `full: true` restores raw configs, sprite catalogs and all
display-mode designs. External MCP tool contracts are unchanged.

After mutations, the loop reads the live document and reports changed layer
bounds and movement warnings. A concurrent revision is reported separately
from the AI's own edit. Revision conflicts require a fresh document read before
another mutation. An identical tool failure is attempted at most twice per
revision. Preview and validation checks still run before completion, and an
unfinished plan gets a reminder to complete its work or explain a blocker.

`inspect_asset` lets the model see existing image pixels without generating a
replacement. `update_plan` keeps a short list of tasks and their statuses.
Plans, observed changes, verification results and failures are saved with each
assistant message. Failed and cancelled replies remain available on the next
turn. Evidence from a different known project is excluded. Historical evidence
is treated as data, and the fresh document takes precedence over old positions.

Long turns retain two recent document snapshots and two rendered previews;
older snapshots become revision references. User reference images are preserved
by this compaction. Durable evidence excludes inline bitmap payloads.

Run `npm run test:watchface-ai-chat` for scripted agent scenarios and context /
chat-store tests. The schema benchmark currently measures 136,010 characters
before focusing and 32,332 afterward (76% smaller), with command definitions
unchanged. The tests cover stationary edits, recovery after conflicts, repeated
failures, image inspection, saved plans, cross-project isolation, and reopening
failed-attempt evidence. These are deterministic workflow tests, not a live
model comparison or proof of visual quality on a physical watch.

Before mutations or image generation, `update_requirements` records constraints
grounded in quotes from the user's messages. It appends immutable items rather
than replacing the list. The checklist is saved separately from the short work
plan and shown in the panel. On later turns it must be reconciled with the user's
corrections; verified items require new evidence, and concrete blockers remain
visible. An older requirement can be superseded only by quoting a later user
instruction. A plan marked complete does not complete a requirement.

`review_requirements` checks successful tool call IDs at the current document
revision. Visual checks need a rendered image; other checks need the actual
document. Generated artwork needs provenance and an installed asset reference.
Generated fonts also need active raster-font configuration and complete
character artwork; an installed font override does not count. Resolution checks
compare retained source pixels to stated rendered dimensions and require
geometry evidence. Further edits invalidate verification. The model still
judges requirement extraction, visual resemblance, the appropriate dimensions
and metric meaning; these are not automatically proven by technical validation.

Final-response text is held while completion checks run. Unresolved requirements
return the agent to work; persistent unverified requirements produce an
incomplete-task error. Explicit blockers produce an incomplete report listing
what remains, rather than releasing a draft success claim.

Consecutive independent `generate_image` calls run with at most three workers.
Each receives its own brief and references, and results retain their call order.
One failed image does not discard successful siblings. Cancellation stops queued
work and waits for active jobs to settle. Crops and editor mutations stay in
sequence with one coordinating agent. These workers generate images; they are
not independent model subagents editing the shared face. Token refresh is shared
across concurrent requests to avoid competing credential rotations.

The built-in Watchmaker engine's initial work allowance is 40 model/tool rounds. Recent new assets, observed
design changes or newly verified requirements extend it in blocks of 20 up to
120; repeated reads, previews, failures and plan updates alone do not. A budget
pause saves a checkpoint with outstanding requirements instead of implying the
work was completed. The current revision's evidence IDs are kept visible to the
model, including the actual document reads after edits, to avoid wasteful
verification retries against old IDs.

`capabilities.assetContracts` describes component artwork requirements from the
active template and the same role rules used by the exporter: battery state
sets, complete digit/weekday/month fonts, weather day/night and temperature
sets, native data roles, single-image slots, rotating hands, AM/PM labels,
backgrounds and firmware-drawn progress/graphs. Each contract exposes its count,
ordering and installation paths where applicable. Physical template sets retain
original file order and dimensions; atlas glyph order is declared separately.
The schema overview includes native role counts/indices even before a field is
added. Focused `nativeData` schema lookup supplies meanings and dimensions.
Active configured/recovered counts take precedence over catalog defaults.
Unknown firmware meanings remain explicit; preview mappings are labeled as such.

For battery state sets, a generated `dynamic_assets`
requirement cannot be verified with a standalone icon or one static replacement:
every expected frame needs generated artwork, frames must vary, and 0/50/100%
preview evidence is required. Inspecting these previews still requires visual
judgment; special firmware states need an on-watch check.

The AI test command also covers checklist persistence, missing/forged/stale
evidence, generated-font substitutions, source resolution, premature completion,
parallel image execution and cancellation. No paid image-generation benchmark
is run by these tests.

Run `npm run test:watchface-automation-tools` to exercise geometry, contrast,
color sampling, SVG rendering and recoloring through the production Electron
service, IPC broker and editor. This uses a temporary project and user-data
directory. It verifies reusable PNG assets, pixel colors, transparency and
unchanged editor history; mocked tool hosts alone cannot catch missing routes.

Existing saved chats load normally, but detailed evidence is available only
for turns made with the upgraded loop. Restart CorosLink after rebuilding the
Electron process to load the new agent behavior.

Checklist extraction accepts turn-local `sourceId` references to exact excerpts
from the latest actual user message. The app supplies and persists the original
quotation, avoiding paraphrase/typo failures. Verbatim quotations from earlier
user messages remain supported; invented IDs and conflicting quotations are
rejected. Source IDs do not mark a requirement complete or weaken verification.

Image generation uses the persistent design-reference selection, even when a later
attachment is a troubleshooting screenshot. The attachment-purpose selector and
“Use as design reference” button persist with chat history. Explicit
`referenceAssetIds` override generation inputs (an empty list opts out). Actual
references and a bounded prompt excerpt are recorded with each generation for
diagnosis. `review_generated_assets` requires a separate model round after new
pixels arrive and a concrete comparison against a generation reference. Pending
or rejected artwork cannot be cropped or installed through `apply_commands`.
Crops retain the reference but require their own review; existing template artwork is unaffected.
This gate enforces the review workflow, not automatic visual similarity: the
model can still judge a poor match incorrectly, and final preview checks remain
necessary. Rejections do not count as assets awaiting placement.

Glyph crop quality now reports final ink bounds/padding, original-cut stroke
continuity, clamped regions, aspect-ratio distortion and upscaling. `glyph` metadata
names the character and sibling set. Non-space blank glyphs, cuts across ink and
out-of-source requests block acceptance; spacing glyphs may intentionally be blank.
Crops require a separate review after their pixels are returned, and glyph
acceptance requires identity, unclipped and baseline/spacing checks. Metrics assist
visual judgment; they do not perform OCR or prove a typeface match.

Dynamic verification now covers weather condition sets and supported native state
roles as well as batteries. Contracts declare complete indices and actual preview
selector samples. Evidence records the renderer's scenario, display mode and
selected complication; stale, unrelated, hidden-layer and wrong-mode samples do
not count. Incompatible state selectors are explicit limitations. The preview now
honors the selectable-complication view override and reports the effective slot.
These checks establish editor state selection, not verified firmware semantics.


## Persistent review and recovery

Asset decisions now live in chat memory independently of the short event journal:
asset ID, original comparison references, accepted/rejected/pending status,
comparison, crop metrics and glyph checks. Continuations restore those decisions;
a rejected content-addressed image cannot become accepted by re-registering or
re-cropping identical pixels. Legacy review events are recovered where available;
unreviewed legacy generated assets require inspection and review. Pending assets
restored after interruption require `inspect_asset` before acceptance.

`generate_image.brief` separates static background content from excluded live
components. Font roles use a small `font-sample` (up to four characters) before
`font-set`. The accepted sample is forwarded as a generation reference. Rejected
or failed atlases require groups of at most four glyphs or individual glyphs;
a failed group requires individual glyphs. These attempts survive continuation.
Accepted samples are study assets and need not be installed. Background approval
requires an explicit pixel review for excluded live artwork. These gates guide
model decisions; they do not perform OCR or automatically measure similarity.

Generated-font verification uses the actual component contracts. The default
scope is all visible typography; a narrower request supplies explicit contract
IDs. The initial requested inventory persists so hiding a label cannot satisfy
it. Checks cover separate clock/metric roles, native digit/unit/symbol/decimal
indices, weekday/month labels, live AM/PM, and static text/punctuation. Generated
static replacements identify the original `componentId` in their evidence.
AM/PM now supports `ampmIndicator.rasterFont` in both preview and export; replacing
config PNGs alone does not change Studio's generated AM/PM label copies.

Dynamic asset reviews require uniform frame canvases, complete ordered sets,
no single static fallback, fresh geometry and state previews, and an explicit
background-conflict comparison. Font mismatch or a failed crop remains pending
for recovery. Hard blockers require a category plus schema/document evidence;
on continuation blockers reopen for reassessment while retaining their explanation.

### Neon regression fixture

Run the existing Electron E2E harness with `--neon-reference <reference.png>`,
`--neon-background <previous-background.png>` and `--rejected-font <atlas.png>`.
It uses a separate temporary profile, port and project, without opening or saving
an existing project. It persists the real rejected atlas decision, checks it on
reload, imports the reference, and tests battery states at 416 and 800 pixels.
Four static rings stay unchanged; a geometric clearance mask removes the baked
battery circle under the state set. It saves previews, an editable isolated project
and a JSON report in the printed temporary directory. State and AM/PM artwork in
this fixture are deterministic test images, not a new model-generated face.

Code tests prove persistence, routing, completeness gates, state selection and
export behavior. Visual inspection must separately assess the reference, candidate
assets and previews. Neither those tests nor editor renders verify firmware state
meanings, on-watch timing or physical-screen legibility.


## Regional visual and dynamic evidence

Requirements now retain `visualTargets`: named full-face regions, display mode,
reference asset/region, appearance (typography, ring or artwork), and the exact
layer and state-set design path when dynamic. Targets survive continuation and
cannot be silently replaced by a nearby component. Legacy requirements can be
supplemented once with targets. A visual requirement cannot complete from a
preview alone; a dynamic-asset requirement cannot complete without a live target.

`compare_design_reference` retrieves actual retained preview pixels and the
persistent selected reference. It returns adjacent crops with aspect ratios and
relative sizes preserved. The model must receive these images before assessing
them in a later round. Reference assessments require native and master sizes,
current revision and the target display mode. The comparison is not a similarity
score: `visualFindings` separately describe proportions, weight, slant, spacing,
placement and remaining differences. Approximations remain unfinished. Targets
and findings persist; preview pixels and verification authority are turn-local.
The panel labels completion as an AI assessment rather than unconditional
“Verified”, and shows remaining differences and live ring targets.

Live comparisons require the contract's state scenarios, a frozen date/time,
unchanged unrelated readings and a consistent complication. Fresh geometry must
place the declared state-set layer at the intended region and comparable size.
Pixel checks compare every sampled pair; at least 2% of the target pixels must
change by 24/255 in a visible color channel. Ring targets sample only normalized
radius 0.65–1, excluding central numbers and icons. These thresholds reject the
observed static-ring/live-icon failure; they do not establish correct firmware
mapping, font similarity, glow quality, or the absence of every possible overlay.
They assume a roughly circular/elliptical ring tightly bounded by its target.
An unusually thin ring or very small state difference may require inspection
and a different representation, rather than claiming success from those pixels.

The neon fixture now saves `ring-comparison-416.png` and
`ring-comparison-800.png` (reference, 0%, 50%, 100%) and measured change fractions.
It also rejects geometry for a small icon in the intended ring's center. The
Electron pixel suite explicitly tests a static ring surrounding a live icon,
duplicate state renders, real ring changes and preserved typography proportions.

## Codex CLI engine

The Studio AI panel uses **Codex CLI** as its only enabled engine. The composer
shows a fixed engine label, and older saved engine preferences are ignored.
The Electron request handler also forces Codex CLI for older callers.
It uses the locally installed official `codex` executable,
its sign-in and default model settings. It runs the CLI’s native app-server
harness; shell/file tools belong to Codex. A private, authenticated loopback MCP
server exposes the same Watchmaker tools, including requirements, asset reviews,
reference comparisons and editor commands. No external-automation setting or
user Codex config file is changed. The connection and token are removed when the
request ends. Shell status appears in the chat activity list; Stop interrupts
and terminates the CLI process and closes its connection.

The built-in engine's 40–120-round progress budget does not apply to CLI mode.
An MCP handoff is part of Codex's native turn, and shell analysis is not captured
by Watchmaker's asset/edit counters. Codex controls its run; Stop, connection
timeouts, asset review gates and evidence requirements still apply. The chat
regression suite checks more than 120 MCP handoffs, cancellation beyond that
point, and refusal to claim success with unfinished requirements.

The panel includes a dismissible notice about shell access, local file
reads, work-folder/temporary-file writes, network access, and the absence of editor
Undo for shell changes. Codex runs with `workspace-write`, network access enabled,
and no unattended approval escalation; there is no unsandboxed fallback. The
workspace is a fresh temporary folder, not the CorosLink repository or project
storage. Reference/preview images are copied into it for shell analysis. Import
prepared PNGs through the editor tools; CLI imports require asset review and are
not automatically treated as image-generated provenance. Unimported temporary
files are removed after the request. Existing Codex settings still govern the
CLI’s model and other available capabilities; its use remains scoped to the
Watchmaker request. The warning is not a promise of complete filesystem isolation.

Chat continuity uses the saved Watchmaker conversation and design memory, with an
ephemeral native CLI thread per user request. A missing or incompatible CLI gives
an error rather than silently using another engine. Install the official CLI and
run `codex login` separately if needed. Watchmaker’s `generate_image` tool still
uses CorosLink’s ChatGPT connection; CLI sign-in alone does not sign in that tool.

Validation: `npm run test:watchface-codex-cli` exercises an actual private MCP
server with a scripted CLI process, native progress events, PNG/file handoff,
tool failure propagation, continuation, missing executable and cancellation.
`node scripts/test-watchface-codex-cli.mjs --live` additionally runs a harmless
shell command and a fixture MCP probe using the installed CLI (consumes a small
model request). It does not connect to the live editor. The existing isolated
Electron E2E harness accepts `--cli-ui` to inspect the fixed engine label and warning without
sending a request or changing a face. This integration does not itself establish
better visual fidelity or on-watch correctness.

CLI discovery checks each candidate with `--version` and `app-server --help`
before selecting it. Executable npm wrappers with missing vendor binaries,
incompatible CLIs and timed-out probes are skipped. Probes and launches use the
same PATH, including an npm installation's sibling Node executable, so GUI and
terminal environments behave consistently. Detection is cancellable; failures
are reported without terminal color escapes. This was verified with the broken
home-directory npm wrapper ahead of the working NVM installation in PATH.
