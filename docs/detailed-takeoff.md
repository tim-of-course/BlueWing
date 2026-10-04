# Calculated-material implementation

Current scope approved October 3, 2026. Implementation is on `refactor/calculated-material-model` with useful Git checkpoints.

## Calculation contract

Traces and calibration describe measurements. Project assembly definitions supply rules and defaults. Applications resolve group and per-trace overrides plus contextual openings, header details, levels, and placements. They generate calculated members and surfaces once; the 3D view, installed quantities, cut schedules, and exports consume those same records. Waste and package rounding affect purchasing afterward.

Every material object in 3D must contribute to quantities. Reported cut lengths come from member endpoints; reported areas come from surface polygons and layer counts. There are no reference-only material surfaces or deductions that shrink reported area while leaving the surface unchanged. Simplified rectangular section envelopes retain entered dimensions; they do not represent fabricated metal profiles or connection engineering.

Formula estimates remain available and explicitly unmodeled. Calculation validity and model coverage are separate. Replacing an estimate assignment with a modeled assembly replaces its contribution rather than adding another takeoff of the same scope.

## Scope

- Live project wall and ceiling definitions, group applications, sparse local overrides, and reset. Imported global definitions remain independent project copies.
- Positioned wall framing with exact flat/sloped/stepped stud lengths, openings, multi-component headers, finishes, backing, and explicit end/junction conditions.
- Positioned 2x2/2x4 ACT mains, 4 ft tees, 2 ft tees, wall angle, and tile surfaces clipped to the measured boundary. Grid origin, direction, elevation, sections, and stock are explicit inputs.
- Unified calculated material sources for desktop/CLI quantities, piece schedules, exports, and 3D; downstream stock, waste, and packages.
- Source-linked snippets and review dependencies, quantity preview, atomic edits, Undo/Redo, and save/reopen.
- A clean development format reset: project format 4 and global library version 2 only. Earlier takeoffs are disposable. No old-project migration, compatibility adapters, or automatic upgrade backups.

The original blueprint PDFs remain reusable. The private Bingham Elementary School set belongs in ignored `tmp/reference-plans/`; it is never committed.

## Initial refactor verification

At checkpoint `28b9b3b`, lightweight checks and the platform suite had passed, while memory pressure interrupted browser verification and held native checks. The table records that checkpoint; the Three.js follow-up below records the later completed checks. Only the integrating agent runs heavy checks, through the README resource guard with one browser worker. A resource refusal is an unrun check, not a pass.

| Check                                                     | Result at the initial checkpoint                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, lint, formatting                              | Pass: `bun run check`                                                                                                                                                                   |
| Core calculated materials and assemblies                  | Pass: 157 tests across 23 files after source/review fixes                                                                                                                               |
| Platform persistence                                      | Pass: 10 tests through guarded `bun run test:platform`                                                                                                                                  |
| Python workflow syntax                                    | Pass: `py_compile` for both updated desktop workflow scripts                                                                                                                            |
| Development browser workflows                             | Partial: Chromium 19 passed; one stale assembly-name selector timed out and is now corrected. Guard stopped the resumed run with exit 75 before WebKit completed; focused rerun pending |
| Web build and production browser workflows                | Not run; pending resource recovery                                                                                                                                                      |
| Native builds, smoke, assembly and detailed CLI workflows | Not run; pending resource recovery                                                                                                                                                      |
| Packaged desktop and representative real-plan inspection  | Pending                                                                                                                                                                                 |

Checkpoint `f7d5f2e` records the initial calculated-material refactor; `99679ff` fixes shared-wall references and diagnostic ownership, with regressions. The resource guard remains enabled. An initial browser launch was refused, then resources recovered and allowed the Chromium run, then warning pressure returned and stopped the job. No leftover Bluewing app or test browser was running at the initial refusal. Heavy checks resume only after resources recover.

The passing core suite includes independent framing and header cuts, slope and opening deductions, multi-layer surface area, actual ACT border/concave/rotated layouts, rendered-geometry/report source equality, purchasing without extra meshes, live definition and override/reset behavior, shared-group copying and deletion, multiple unresolved sources, and shared-junction review invalidation. The passing platform suite covers current-format persistence, rollback, unsupported-file rejection without upgrades, and explicit backups.

Native workflow coverage in `tests/desktop/assemblies.py` and `tests/desktop/detailed.py` includes:

- Formula quantities, per-trace overrides, stock/package rounding, required pieces, independent project/global definitions, stale library writes, starter restoration, and two-project reuse.
- A 6 m wall with 13 studs at 0.5 m stations, cuts of 2.95 m from explicit end allowances, a 2 m opening, two 2.3 m header components, and geometric finish deductions.
- Piece and surface source IDs shared between construction inspection and ordinary quantity outputs; reported cuts checked against actual endpoints.
- Project definition edits updating inherited wall settings, sparse local overrides preserving their value, reset, and Undo/Redo.
- Corner-aligned 8 × 8 ft ACT layouts: one 8 ft main, six 4 ft tees, four 8 ft angles, 64 ft² of tile, and eight 2 ft tees for 2x2 only. Replacing the same assignment removes its previous estimate/layout contribution. Adding 10% tee waste orders seven tees while the model still contains six.
- Preview without persistence, malformed PDF rollback, snippets and PNG coordinate mapping, filtered 3D exports, CSV/JSON source agreement, review invalidation, explicit backup, and restart equality.

The optional `BLUEWING_TEST_DETAILED_PLAN` run imports the private 164-page set, renders first/middle/last sheets, and compares a reopened render. Run it only when resources permit. Local evidence is under ignored `tmp/assembly-workflow/`, `tmp/detailed-workflow/`, and `test-results/`.

## Three.js viewer follow-up

The Canvas 2D painter has been replaced by a shared Three.js/WebGL 2 renderer. Opaque members and finishes use the GPU depth buffer, including edge lines and source picking. Rectangular sections and surface thickness come from the calculated records; the renderer adds no material. Concave finishes are triangulated in their own plane. Solid, framing, and X-ray finish-outline modes affect visibility only.

Members use one instanced mesh and one instanced edge draw. Finish triangles and edges are merged. The interactive viewer renders when its state changes, preserves its GPU buffers while navigating, and fits selections from physical bounds. It uses native display density subject to the GPU's limits. CLI and Wingman share a separate snapshot renderer; screenshots copy or refresh the drawing buffer immediately instead of enabling persistent framebuffer storage. Closing viewers/projects disposes their resources. The former 4,000-object display limit is removed; the separate 50,000-object generation budget remains.

New controls include orbit, pan, zoom, six standard views, fit selection, reset, and display mode. CLI exports accept the same camera target, span, zoom, angles, and mode, with matching Wingman swaps. The renderer loads only when a 3D view or export is requested.

Verification of this follow-up is separate from the historical results above:

- TypeScript, lint, and formatting passed with `bun run check`.
- Core tests passed: 156 tests across 23 files, including calculated material/report agreement, physical bounds, fitted camera targets, and all 6,000 members reaching a scene.
- GPU regressions passed: all 4 cases in `construction-rendering.dev.spec.ts` on both Chromium and WebKit, 8 passes total. They cover stud/tee occlusion and picking from both sides, matching live/export pixels, concave finishes, display modes, 6,000 instanced members with bounded draw calls and GPU resource cleanup, high-density output, and screenshot capture after idle frames.
- Detailed/Wingman development workflows passed: 16 tests across Chromium and WebKit, including presets, fitting, panning, camera restoration, rejected camera requests, screenshot attachments, and Solid diagnostics.
- The separate assembly development checks now pass too. The initial rerun passed 5 of 6 cases and exposed a startup race in the Chromium ceiling-selection case: the click occurred about 103 ms before the lazy Three.js module loaded. The viewer now retains its loading status through the first successful render, and the workflow waits for that status before clicking. The affected case then passed three consecutive runs in each browser. The previously corrected assembly-name selectors also passed.
- The production build passed. Detailed/Wingman production workflows passed: 10 tests across Chromium and WebKit.
- After the first-frame readiness fix, the production assets were rebuilt and all 12 assembly/detailed production cases passed across both browsers. This also completes the separate assembly production coverage.
- `bun run native:build` passed. Fresh native binaries with the production web assets passed `tests/desktop/detailed.py` and `tests/desktop/wingman.py`, covering real CLI material reports, exports, live assemblies, overrides/reset, save/reopen, Wingman publication, messages, attachments, and wait renewal.
- The real CLI reopened the 1.6 MB Bingham A7-0 office-section project and exported the traced plan plus isometric/opposite/top framing-grid views and an opaque ceiling view. The scene contains 222 calculated members and 109 surfaces; framing mode shows 222 objects and solid mode shows all 331. Each object appears exactly once in the quantity sources, and every member cut matches its endpoints. The isometric framing/grid and solid images were visually inspected. Files and command transcripts are in ignored `output/threejs-blueprint-demo/`. The takeoff's existing height assumptions and unresolved header details remain; this is renderer evidence, not a finished job estimate.

The initial GPU runs were refused or stopped at warning pressure. Checkpoint `02a96c8` changes warning pressure to a logged warning, retaining the critical stop, memory-pool thresholds, shared job lock, and one browser worker. All 11 guard tests passed, including warning startup/runtime completion, critical cancellation, and competing-job refusal. Type checking and scoped lint/format checks passed. The macOS reading is now explicitly labeled as a non-compressed memory pool, which includes active pages and is not unused RAM.

Measured process-tree footprint for the focused GPU suite peaked at 757.4 MiB in Chromium and 1,088.0 MiB in WebKit. These successful runs stayed at normal memory pressure; injected guard tests verified continuation at warning pressure without deliberately stressing the machine. Measurements include compressed allocations and are not a whole-machine RAM total. Evidence is in ignored `tmp/memory-profile/three-renderer-warning-allowed.json` and `three-renderer-webkit.json`.

All browser/build/native commands above retained the resource guard. The optional full 164-page import was skipped; the smaller real-plan excerpt was used instead. The release installer and Windows native runtime were not rebuilt or exercised for this follow-up.

## Limits requiring project judgment

- Heights, sections, gauges, openings, header components, allowances, and connections come from project requirements. Successful arithmetic does not establish engineering adequacy or a complete building takeoff.
- Drywall, FRP, and sheathing use accurate area by product/face/layer. Individual board layout, seams, and optimized cuts are outside this scope.
- ACT layouts use nominal member centerlines with the finished underside as the ceiling elevation datum. Hangers, connector tabs, seismic accessories, fixture supports, and offcut reuse are not inferred. Tile purchasing uses area, not optimized tile-piece reuse.
- Bent/stepped track joints remain explicitly unresolved. Multiple jambs and shared junction members require offsets and ownership.
- Formula estimates for additional trades remain unmodeled until the necessary placement is supplied by an appropriate generator.
- Generation stops at 50,000 pieces/surfaces and marks results incomplete. The Three.js viewer displays all generated objects matching its filters; schedules retain all generated records.
- Native PDF transfer/storage is bounded, but PDF.js still holds a complete PDF buffer. Large imports are not constant-memory operations.

Recovery for this development change is through the branch and Git checkpoints. `project.backup` remains a user-requested copy of a current project, not a migration mechanism.

Before the Three.js follow-up, warning pressure interrupted the earlier assembly checks. The completed checks and the first-frame readiness fix are recorded above. Process inspection found no running Android emulator, Bluewing app, or leftover test browser before verification. No unrelated app was force-quit.
